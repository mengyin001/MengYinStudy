import {
  AI_LIMITS,
  type AiErrorBody,
  type AiHealth,
  type AiImageResult,
  type AiProgress,
  type AiQuestionResult,
  type AiServiceConfig,
  type AiTestResult,
} from '@mengyin/ai-contract';
import type { Env } from './env';
import { badRequest, imagesUnavailable, isApiError, notFound, payloadTooLarge } from './errors';
import { AiError, createOpenAiChatModel, type ChatModel } from './providers/chat';
import { createDemoChatModel } from './providers/demo';
import { providerCatalog, resolveProviderForModel, type ResolvedProvider } from './providers/registry';
import { createImageGenerator, imageCapability, resolveImageModel, type ImageGenerator } from './images/generator';
import { illustrateDeck } from './images/illustrate';
import { attestImageDataUrl, imageVerifyKey } from './images/attest';
import { verifyIllustration, visionModelFor } from './images/verify';
import { createImageSearcher, imageSearchCapability, type ImageSearcher } from './images/search';
import { generateQuestions } from './generation/generate';
import { questionIsVisualClue } from './generation/visual';
import { AI_SERVICE_VERSION } from './version';
import { corsHeaders } from './http/cors';
import { authenticate, authRequired, type AuthContext } from './http/auth';
import { consumeQuota } from './http/quota';
import { parseImageRequest, parseQuestionRequest } from './http/validation';
import {
  cancelGeneration,
  chargeDeckImages,
  chargeStandaloneImage,
  refundStandaloneImage,
  resolveGenerationPolicy,
  settleGeneration,
  type GenerationPolicy,
} from './billing/policy';
import {
  billingConfig,
  billingMe,
  cancelSubscription,
  getRefundQuote,
  handleWebhook,
  startCheckout,
  startPortal,
  startRefund,
} from './billing/routes';

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface AppDeps {
  fetch?: typeof fetch;
  now?: () => number;
  authenticate?: (request: Request, env: Env) => Promise<AuthContext>;
  createChat?: (provider: ResolvedProvider) => ChatModel;
  createImages?: (env: Env, model?: string) => ImageGenerator | null;
  createImageSearch?: (env: Env) => ImageSearcher | null;
  /** SSE keep-alive interval; exposed for tests, defaults to 15 s. */
  keepAliveMs?: number;
}

interface RequestContext {
  env: Env;
  request: Request;
  requestId: string;
  cors: Record<string, string>;
  deps: Required<
    Pick<AppDeps, 'fetch' | 'now' | 'authenticate' | 'createChat' | 'createImages' | 'createImageSearch'>
  > & {
    keepAliveMs: number;
  };
}

function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  }
  return Math.random().toString(36).slice(2, 18);
}

function baseHeaders(context: RequestContext): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': context.requestId,
    ...context.cors,
  };
}

function json(context: RequestContext, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...baseHeaders(context),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function errorBody(error: unknown, context: RequestContext): { status: number; body: AiErrorBody } {
  if (isApiError(error)) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, requestId: context.requestId } },
    };
  }
  if (error instanceof AiError) {
    if (error.code === 'rate') {
      return {
        status: 429,
        body: {
          error: { code: 'provider_rate', message: error.message, requestId: context.requestId },
        },
      };
    }
    if (error.code === 'timeout') {
      return {
        status: 504,
        body: {
          error: { code: 'provider_timeout', message: error.message, requestId: context.requestId },
        },
      };
    }
    if (error.code === 'auth') {
      return {
        status: 502,
        body: {
          error: { code: 'provider_auth', message: error.message, requestId: context.requestId },
        },
      };
    }
    return {
      status: 502,
      body: {
        error: { code: 'provider_error', message: error.message, requestId: context.requestId },
      },
    };
  }
  console.error(`[${context.requestId}] unhandled AI service error`, error instanceof Error ? error.message : String(error));
  return {
    status: 500,
    body: {
      error: {
        code: 'server_error',
        message: 'Something went wrong on the AI service.',
        requestId: context.requestId,
      },
    },
  };
}

async function readText(request: Request): Promise<string> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > AI_LIMITS.maxRequestBytes) {
    throw payloadTooLarge(
      `The request body is larger than ${AI_LIMITS.maxRequestBytes.toLocaleString()} bytes.`,
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > AI_LIMITS.maxRequestBytes) {
    throw payloadTooLarge(
      `The request body is larger than ${AI_LIMITS.maxRequestBytes.toLocaleString()} bytes.`,
    );
  }
  return raw;
}

async function readJson(request: Request): Promise<unknown> {
  const raw = await readText(request);
  if (!raw.trim()) throw badRequest('The request body is empty.');
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

async function readOptionalJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await readText(request);
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw badRequest('The request body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (isApiError(error)) throw error;
    throw badRequest('The request body is not valid JSON.');
  }
}

function serviceConfig(env: Env): AiServiceConfig {
  const catalog = providerCatalog(env);
  const images = { ...imageCapability(env), search: imageSearchCapability(env) };
  return {
    // The image capability reports both sources so the UI can explain why a
    // scene visual may still work when text-to-image is disabled.
    providers: catalog.providers,
    images,
    limits: { ...AI_LIMITS, maxImagesPerDeck: images.maxPerRequest },
    authRequired: authRequired(env),
    imageVerifyKey: imageVerifyKey(env),
  };
}

async function requireAuth(context: RequestContext): Promise<AuthContext> {
  return context.deps.authenticate(context.request, context.env);
}

function engineOf(provider: ResolvedProvider) {
  return { provider: provider.id, providerLabel: provider.label, model: provider.model };
}

interface PreparedGeneration {
  normalized: ReturnType<typeof parseQuestionRequest>;
  provider: ResolvedProvider;
  model: ChatModel;
  policy: GenerationPolicy;
}

async function prepareGeneration(context: RequestContext, auth: AuthContext): Promise<PreparedGeneration> {
  const { env } = context;
  const normalized = parseQuestionRequest(await readJson(context.request));
  const provider = resolveProviderForModel(env, normalized.model);
  await consumeQuota(env, auth.userId, 'questions', normalized.count, context.deps.now);
  const materialChars = normalized.materials.reduce((total, material) => total + material.text.length, 0);
  const policy = await resolveGenerationPolicy(
    env,
    auth,
    {
      model: provider.model,
      count: normalized.count,
      materialChars,
      imageMode: normalized.imageMode,
    },
    context.requestId,
  );
  // A free account has no AI photos, but it still gets rendered figures, so an
  // image model is only validated when the plan can actually use one.
  if (policy.photosAllowed && normalized.imageMode !== 'off') {
    resolveImageModel(env, normalized.imageModel);
  }
  return { normalized, provider, model: context.deps.createChat(provider), policy };
}

async function runGeneration(
  context: RequestContext,
  auth: AuthContext,
  prepared: PreparedGeneration,
  sendProgress?: (progress: AiProgress) => Promise<void>,
): Promise<AiQuestionResult> {
  const { env } = context;
  const { normalized, provider, model } = prepared;
  // Resolve the image capability first so the generation pass can skip the
  // illustration-planning call when this server has no image provider at all.
  const catalog = imageCapability(env);
  const searchCapability = imageSearchCapability(env);
  // Rendered figures are free on every plan. AI photos and web-search photos
  // are the only visuals the plan can block, so the generator is told about
  // them separately from the image mode (which still enables diagrams).
  const photosAvailable = prepared.policy.photosAllowed && catalog.available;
  const webImagesAvailable = prepared.policy.photosAllowed && searchCapability.available;

  const generated = await generateQuestions(
    model,
    {
      topic: normalized.topic,
      count: normalized.count,
      difficulty: normalized.difficulty,
      language: normalized.language,
      types: normalized.types,
      codeLanguage: normalized.codeLanguage,
      ...(normalized.focus ? { focus: normalized.focus } : {}),
      ...(normalized.description ? { description: normalized.description } : {}),
      imageMode: prepared.policy.imageMode,
    },
    normalized.materials,
    {
      signal: context.request.signal,
      imagesAvailable: photosAvailable,
      webImagesAvailable,
      ...(sendProgress
        ? {
            onProgress: (progress) => {
              void sendProgress({
                stage: progress.stage,
                batch: progress.batch,
                batches: progress.batches,
                message: progress.message,
              }).catch(() => undefined);
            },
          }
        : {}),
    },
  );

  const requestedImageMax = normalized.imageMax ?? generated.imageRequests.length;
  const imageMax =
    catalog.maxPerRequest > 0
      ? Math.min(requestedImageMax, catalog.maxPerRequest)
      : requestedImageMax;
  const selectedImages = generated.imageRequests.slice(0, Math.max(0, imageMax));
  const warnings = [...generated.warnings];
  if (prepared.policy.imagesBlocked) {
    warnings.unshift({
      code: 'plan',
      message:
        'The free plan does not include AI photos, so this deck was generated without new photos. Figures drawn by the app are still included.',
    });
  }
  let generatedImages = 0;
  let searchedImages = 0;
  let failedImages = 0;

  if (selectedImages.length > 0) {
    const generator = context.deps.createImages(env, normalized.imageModel);
    const searcher = context.deps.createImageSearch(env);
    if (!generator && !searcher) {
      warnings.push({
        code: 'images',
        message:
          'Illustrations were requested, but neither image generation nor web image search is configured on this server. The questions were still generated.',
      });
    } else {
      let allowed = true;
      try {
        await consumeQuota(env, auth.userId, 'images', selectedImages.length, context.deps.now);
      } catch (error) {
        allowed = false;
        warnings.push({
          code: 'quota',
          message:
            error instanceof Error
              ? error.message
              : 'The daily image limit is used up; questions were generated without new illustrations.',
        });
      }
      if (allowed) {
        const illustrated = await illustrateDeck(generated.deck, selectedImages, generator, {
          max: selectedImages.length,
          signal: context.request.signal,
          search: searcher,
          attest: (image) => attestImageDataUrl(env, image),
          ...(sendProgress
            ? {
                onProgress: (done, total) => {
                  void sendProgress({
                    stage: 'illustrating',
                    batch: done,
                    batches: total,
                    message: `illustration ${done}/${total}`,
                  }).catch(() => undefined);
                },
              }
            : {}),
        });
        generatedImages = illustrated.generated;
        searchedImages = illustrated.searched;
        failedImages = illustrated.failed;
        warnings.push(...illustrated.warnings);

        // A multimodal provider checks that each finished photo actually shows
        // the question and does not reveal the answer. Dropping a bad picture
        // is better than teaching a wrong one; a provider failure is ignored.
        if (illustrated.generated > 0 && visionModelFor(env, provider.id)) {
          const byId = new Map(generated.deck.questions.map((question) => [question.id, question]));
          const queue = [...selectedImages];
          const worker = async (): Promise<void> => {
            for (;;) {
              const request = queue.shift();
              if (!request) return;
              const question = byId.get(request.questionId);
              if (!question) continue;
              const media = [...(question.media ?? [])].reverse().find((item) => item.type === 'image');
              if (!media || media.type !== 'image') continue;
              const check = await verifyIllustration(env, provider, question, media.src, context.deps.fetch, {
                clue: questionIsVisualClue(question),
              });
              if (!check.checked || check.ok) continue;
              question.media = (question.media ?? []).filter((item) => item !== media);
              generatedImages -= 1;
              if (media.credit) searchedImages -= 1;
              failedImages += 1;
              warnings.push({
                code: 'image',
                message: `Question ${question.id} has no illustration: the vision check rejected it${
                  check.reason ? ` (${check.reason})` : ''
                }.`,
              });
            }
          };
          await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
        }
      }
    }
  }

  // AI photos generated for the deck consume the monthly image allowance just
  // like standalone images; web-search reference photos do not. Charge after
  // the vision check so a rejected picture is not billed.
  const aiImages = Math.max(0, generatedImages - searchedImages);
  if (aiImages > 0) {
    await chargeDeckImages(context.env, auth, prepared.policy, aiImages).catch((error: unknown) => {
      warnings.push({
        code: 'image',
        message: `${aiImages} AI image${aiImages === 1 ? '' : 's'} could not be added to the monthly image count: ${
          error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)
        }`,
      });
    });
  }

  // The reservation covered the requested count; give back the difference so a
  // shortfall is never charged. A settlement failure must not lose the deck the
  // learner already paid for, so it is logged rather than thrown.
  await settleGeneration(context.env, auth, prepared.policy, generated.deck.questions.length).catch(
    (error: unknown) => {
      console.error(
        `[${context.requestId}] point settlement failed`,
        error instanceof Error ? error.message : String(error),
      );
    },
  );

  return {
    deck: generated.deck,
    warnings,
    usage: generated.usage,
    engine: engineOf(provider),
    images: {
      requested: generated.imageRequests.length,
      generated: generatedImages,
      searched: searchedImages,
      failed: failedImages,
      diagrams: generated.diagramCount,
    },
  };
}
function streamResponse(
  context: RequestContext,
  work: (send: (event: string, data: unknown) => Promise<void>) => Promise<void>,
  ctx?: ExecutionContextLike,
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;

  const send = async (event: string, data: unknown): Promise<void> => {
    if (closed) return;
    await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // A provider may think for minutes before the next stage. A comment line is
  // ignored by the SSE parser but keeps the connection alive through proxies
  // (and shows the learner that the browser is still attached).
  const keepAlive = setInterval(() => {
    if (closed) return;
    void writer.write(encoder.encode(': keep-alive\n\n')).catch(() => undefined);
  }, context.deps.keepAliveMs);

  const task = (async () => {
    try {
      await work(send);
    } catch (error) {
      const failure = errorBody(error, context);
      try {
        await send('error', failure.body);
      } catch {
        // The client went away; nothing left to tell it.
      }
    } finally {
      closed = true;
      clearInterval(keepAlive);
      try {
        await writer.close();
      } catch {
        // Already closed by the client.
      }
    }
  })();

  ctx?.waitUntil(task);
  void task.catch(() => undefined);

  return new Response(readable, {
    status: 200,
    headers: {
      ...baseHeaders(context),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function methodNotAllowed(context: RequestContext, allow: string): Response {
  const response = json(
    context,
    { error: { code: 'not_found', message: 'Method not allowed.', requestId: context.requestId } },
    405,
  );
  response.headers.set('Allow', allow);
  return response;
}

async function route(context: RequestContext, ctx?: ExecutionContextLike): Promise<Response> {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders(context) });
  }

  if (pathname === '/api/ai/health') {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(context, 'GET');
    const catalog = providerCatalog(env);
    const images = imageCapability(env);
    const health: AiHealth = {
      ok: true,
      service: 'mengyin-ai',
      version: AI_SERVICE_VERSION,
      providersConfigured: catalog.providers.filter((provider) => provider.configured).length,
      imagesAvailable: images.available,
      time: new Date(context.deps.now()).toISOString(),
    };
    const response = json(context, health);
    if (method === 'HEAD') return new Response(null, { status: 200, headers: response.headers });
    return response;
  }

  if (pathname === '/api/ai/config') {
    if (method !== 'GET') return methodNotAllowed(context, 'GET');
    await requireAuth(context);
    return json(context, serviceConfig(env));
  }

  if (pathname === '/api/ai/test') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    await requireAuth(context);
    const body = await readOptionalJson(request);
    const provider = resolveProviderForModel(
      env,
      typeof body.model === 'string' ? body.model : '',
    );
    const chat = context.deps.createChat(provider);
    const started = context.deps.now();
    const reply = await chat.complete(
      [
        { role: 'system', content: 'You are a health check. Reply with the single word OK.' },
        { role: 'user', content: 'Reply now.' },
      ],
      { maxTokens: 8, temperature: 0, jsonMode: false, retry: false },
    );
    const result: AiTestResult = {
      ok: true,
      provider: provider.id,
      providerLabel: provider.label,
      model: reply.model ?? provider.model,
      latencyMs: Math.max(0, context.deps.now() - started),
    };
    return json(context, result);
  }

  if (pathname === '/api/ai/questions') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    const auth = await requireAuth(context);
    const wantsStream = (request.headers.get('Accept') ?? '')
      .toLowerCase()
      .includes('text/event-stream');
    if (!wantsStream) {
      const prepared = await prepareGeneration(context, auth);
      try {
        const result = await runGeneration(context, auth, prepared);
        return json(context, result);
      } catch (error) {
        await cancelGeneration(env, auth, prepared.policy, 'generation-failed').catch(() => undefined);
        throw error;
      }
    }

    // Validate everything that can fail before committing to a 200 stream;
    // a missing key or an unconfigured provider should still be a JSON error.
    const prepared = await prepareGeneration(context, auth);

    return streamResponse(
      context,
      async (send) => {
        try {
          await send('progress', {
            stage: 'preparing',
            batch: 0,
            batches: 0,
            message: 'preparing the request',
          } satisfies AiProgress);
          const result = await runGeneration(context, auth, prepared, (progress) =>
            send('progress', progress),
          );
          await send('result', result);
        } catch (error) {
          // A streamed run reserves points up front; a failure at any stage
          // must put them back before the error event reaches the browser.
          await cancelGeneration(env, auth, prepared.policy, 'generation-failed').catch(
            () => undefined,
          );
          throw error;
        }
      },
      ctx,
    );
  }

  if (pathname === '/api/ai/images') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    const auth = await requireAuth(context);
    const body = parseImageRequest(await readJson(request));
    const generator = context.deps.createImages(env, body.model);
    if (!generator) {
      throw imagesUnavailable('Image generation is not configured on this server.');
    }
    await consumeQuota(env, auth.userId, 'images', 1, context.deps.now);
    const policy = await chargeStandaloneImage(env, auth, context.requestId);
    let result: AiImageResult;
    try {
      result = await generator.generate(body.prompt, {
        ...(body.alt ? { alt: body.alt } : {}),
        signal: request.signal,
      });
    } catch (error) {
      await refundStandaloneImage(env, auth, policy, 'image-failed').catch(() => undefined);
      throw error;
    }
    const attestation = await attestImageDataUrl(env, result.image);
    return json(context, {
      image: result.image,
      model: result.model,
      ...(body.alt ? { alt: body.alt } : {}),
      ...(attestation ?? {}),
    });
  }

  // -- Billing --------------------------------------------------------------

  if (pathname === '/api/billing/config') {
    if (method !== 'GET') return methodNotAllowed(context, 'GET');
    return json(context, billingConfig(env));
  }

  if (pathname === '/api/billing/me') {
    if (method !== 'GET') return methodNotAllowed(context, 'GET');
    const auth = await requireAuth(context);
    return json(context, await billingMe(env, auth));
  }

  if (pathname === '/api/billing/checkout') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    const auth = await requireAuth(context);
    const body = await readOptionalJson(request);
    return json(
      context,
      await startCheckout(env, auth, body, new URL(request.url).origin),
    );
  }

  if (pathname === '/api/billing/portal') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    const auth = await requireAuth(context);
    await readOptionalJson(request);
    return json(context, await startPortal(env, auth, new URL(request.url).origin));
  }

  if (pathname === '/api/billing/cancel') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    const auth = await requireAuth(context);
    await readOptionalJson(request);
    return json(context, await cancelSubscription(env, auth));
  }

  if (pathname === '/api/billing/refund') {
    if (method !== 'GET' && method !== 'POST') return methodNotAllowed(context, 'GET, POST');
    const auth = await requireAuth(context);
    if (method === 'GET') {
      return json(context, await getRefundQuote(env, auth, context.deps.now()));
    }
    await readOptionalJson(request);
    return json(context, await startRefund(env, auth, context.deps.now()));
  }

  if (pathname === '/api/billing/webhook') {
    if (method !== 'POST') return methodNotAllowed(context, 'POST');
    const raw = await readText(request);
    const signature = request.headers.get('Stripe-Signature') ?? '';
    return json(context, await handleWebhook(env, raw, signature, context.deps.now()));
  }

  if (pathname.startsWith('/api/')) {
    throw notFound();
  }

  if (env.ASSETS) return env.ASSETS.fetch(request);
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export function createApp(deps: AppDeps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const resolved: RequestContext['deps'] = {
    fetch: fetchImpl,
    now,
    authenticate: deps.authenticate ?? ((request, env) => authenticate(request, env, fetchImpl, now)),
    createChat:
      deps.createChat ??
      ((provider) =>
        provider.demo
          ? createDemoChatModel()
          : createOpenAiChatModel({
              provider: provider.id,
              providerLabel: provider.label,
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              model: provider.model,
              temperature: provider.temperature,
              maxTokens: provider.maxTokens,
              timeoutMs: provider.timeoutMs,
              jsonMode: provider.jsonMode,
              ...(provider.thinking ? { thinking: provider.thinking } : {}),
              ...(provider.reasoningEffort ? { reasoningEffort: provider.reasoningEffort } : {}),
              fetchImpl,
            })),
    createImages:
      deps.createImages ?? ((env, model) => createImageGenerator(env, fetchImpl, model)),
    createImageSearch: deps.createImageSearch ?? ((env) => createImageSearcher(env, fetchImpl)),
    keepAliveMs: Math.max(1, Math.round(deps.keepAliveMs ?? 15_000)),
  };

  return {
    async fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response> {
      const context: RequestContext = {
        env,
        request,
        requestId: newRequestId(),
        cors: corsHeaders(request, env),
        deps: resolved,
      };
      try {
        return await route(context, ctx);
      } catch (error) {
        const failure = errorBody(error, context);
        return json(context, failure.body, failure.status);
      }
    },
  };
}
