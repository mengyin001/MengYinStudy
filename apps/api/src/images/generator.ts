/**
 * Image generation. Cloudflare Workers AI is the default provider because its
 * free daily allocation is enough to test the feature; the REST API is
 * supported as well so the same code runs outside Workers.
 *
 * The returned value is a data URL, so a generated question is self-contained
 * and survives export/import and cloud sync without a second storage service.
 */
import {
  AI_DEFAULT_IMAGE_MODEL,
  AI_LIMITS,
  type AiImageModelInfo,
  type AiImageResult,
} from '@mengyin/ai-contract';
import type { Env } from '../env';
import { ApiError } from '../errors';

const MAX_IMAGE_BYTES = 2_500_000;
const IMAGE_TIMEOUT_MS = 90_000;
const MAX_IMAGE_MODELS = 8;
const STYLE_SUFFIX =
  ' Plain white background, flat vector illustration, clean outlines, no text, no labels, no numbers, no people, no watermark.';

const IMAGE_MODEL_LABELS: Record<string, string> = {
  '@cf/black-forest-labs/flux-1-schnell': 'FLUX.1 Schnell',
  '@cf/stabilityai/stable-diffusion-xl-base-1.0': 'SDXL Base',
  '@cf/bytedance/stable-diffusion-xl-lightning': 'SDXL Lightning',
  '@cf/lykon/dreamshaper-8-lcm': 'DreamShaper 8',
  '@cf/leonardo/phoenix-1.0': 'Leonardo Phoenix',
  '@cf/leonardo/lucid-origin': 'Leonardo Lucid Origin',
};

export interface ImageCapability {
  available: boolean;
  model: string | null;
  models: AiImageModelInfo[];
  maxPerRequest: number;
}

export interface ImageGenerator {
  readonly model: string;
  readonly demo: boolean;
  generate(prompt: string, options?: { alt?: string; signal?: AbortSignal }): Promise<AiImageResult>;
}

function providerName(env: Env): string {
  const explicit = (env.IMAGE_PROVIDER ?? '').trim().toLowerCase();
  if (explicit) return explicit;
  if ((env.AI_MOCK ?? '').trim() === '1') return 'demo';
  return 'cloudflare';
}

function modelLabel(id: string): string {
  return IMAGE_MODEL_LABELS[id] ?? id.replace(/^@cf\//, '').replace(/[-_/]+/g, ' ').trim();
}

function configuredModels(env: Env): string[] {
  const listed = (env.IMAGE_MODELS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const explicitDefault = (env.IMAGE_MODEL ?? '').trim();
  const unique = [...new Set(listed)];
  if (explicitDefault) {
    const rest = unique.filter((id) => id !== explicitDefault);
    unique.splice(0, unique.length, explicitDefault, ...rest);
  }
  if (unique.length === 0) unique.push(AI_DEFAULT_IMAGE_MODEL);
  return unique.slice(0, MAX_IMAGE_MODELS);
}

function defaultImageModel(env: Env): string {
  return (env.IMAGE_MODEL ?? '').trim() || configuredModels(env)[0] || AI_DEFAULT_IMAGE_MODEL;
}

/** Resolve a request's image model against the server allowlist. */
export function resolveImageModel(env: Env, requested?: string): string {
  const wanted = (requested ?? '').trim();
  if (!wanted || wanted === 'auto') return defaultImageModel(env);
  if (!configuredModels(env).includes(wanted)) {
    throw new ApiError(
      400,
      'invalid_request',
      `Unknown image model "${wanted}". Choose a model from /api/ai/config.`,
    );
  }
  return wanted;
}

function stepsFor(env: Env): number | undefined {
  if (!env.IMAGE_STEPS) return undefined;
  const value = Number(env.IMAGE_STEPS);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(8, Math.max(1, Math.round(value)));
}

function seedFor(env: Env): number | undefined {
  if (env.IMAGE_SEED) {
    const value = Number(env.IMAGE_SEED);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return undefined;
}

export function imageCapability(env: Env): ImageCapability {
  // One picture per question is the natural ceiling; a deck built over several
  // "Generate more" runs may therefore hold far more. There is no separate
  // per-deck image cap: the account's storage budget is the limit.
  // 0 means "no application-level ceiling"; a deck can keep growing with
  // Generate more, and only the account's storage budget limits it.
  const maxPerRequest = AI_LIMITS.maxImagesPerDeck;
  const provider = providerName(env);
  if (provider === 'none' || provider === 'off') {
    return { available: false, model: null, models: [], maxPerRequest };
  }
  if (provider === 'demo') {
    return {
      available: true,
      model: 'demo-svg',
      models: [{ id: 'demo-svg', label: 'Demo illustration' }],
      maxPerRequest,
    };
  }
  const account = (env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const token = (env.CLOUDFLARE_AI_TOKEN ?? '').trim();
  const available = Boolean(env.AI) || (account.length > 0 && token.length > 0);
  if (!available) return { available: false, model: null, models: [], maxPerRequest };
  return {
    available: true,
    model: defaultImageModel(env),
    models: configuredModels(env).map((id) => ({ id, label: modelLabel(id) })),
    maxPerRequest,
  };
}

function imagePrompt(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (!clean) throw new ApiError(400, 'invalid_request', 'The image prompt is empty.');
  return /no text|no labels/i.test(clean) ? clean : `${clean}${STYLE_SUFFIX}`;
}

function detectMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/png';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToDataUrl(bytes: Uint8Array): string {
  if (bytes.length === 0) throw new ApiError(502, 'image_failed', 'The image provider returned no bytes.');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ApiError(502, 'image_failed', 'The generated image is too large to attach to a question.');
  }
  return `data:${detectMime(bytes)};base64,${bytesToBase64(bytes)}`;
}

function base64ToDataUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('data:image/')) {
    if (trimmed.length > MAX_IMAGE_BYTES * 1.4) {
      throw new ApiError(502, 'image_failed', 'The generated image is too large to attach to a question.');
    }
    return trimmed;
  }
  const bytes = base64ToBytes(trimmed);
  return bytesToDataUrl(bytes);
}

/** Normalise every shape the Workers AI binding and REST endpoint can return. */
export async function normalizeImageOutput(raw: unknown): Promise<string> {
  if (raw instanceof Response) {
    if (!raw.ok) {
      throw new ApiError(502, 'image_failed', `Cloudflare AI image request failed (${raw.status}).`);
    }
    const buffer = await raw.arrayBuffer();
    return bytesToDataUrl(new Uint8Array(buffer));
  }
  if (raw instanceof ReadableStream) {
    const buffer = await new Response(raw).arrayBuffer();
    return bytesToDataUrl(new Uint8Array(buffer));
  }
  if (raw instanceof ArrayBuffer) return bytesToDataUrl(new Uint8Array(raw));
  if (ArrayBuffer.isView(raw)) {
    return bytesToDataUrl(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  }
  if (typeof raw === 'string') return base64ToDataUrl(raw);
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    const image = value.image ?? value.base64 ?? value.result;
    if (typeof image === 'string') return base64ToDataUrl(image);
    if (image instanceof ArrayBuffer) return bytesToDataUrl(new Uint8Array(image));
    if (ArrayBuffer.isView(image)) {
      return bytesToDataUrl(new Uint8Array(image.buffer, image.byteOffset, image.byteLength));
    }
    if (Array.isArray(image) && image.every((item) => typeof item === 'number')) {
      return bytesToDataUrl(new Uint8Array(image));
    }
  }
  throw new ApiError(502, 'image_failed', 'The image provider returned an unrecognised response.');
}

function demoImage(prompt: string): string {
  // A deterministic abstract illustration: enough to exercise the UI and the
  // deck pipeline without spending a single Workers AI neuron.
  let hash = 2166136261;
  for (let index = 0; index < prompt.length; index += 1) {
    hash ^= prompt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  const hue2 = (hue + 47) % 360;
  const circles = Array.from({ length: 5 }, (_, index) => {
    const x = 80 + (Math.abs(hash >> (index * 3)) % 352);
    const y = 80 + (Math.abs(hash >> (index * 5)) % 352);
    const radius = 28 + (Math.abs(hash >> (index * 7)) % 64);
    const fill = index % 2 === 0 ? `hsl(${hue} 62% 72%)` : `hsl(${hue2} 58% 66%)`;
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}" fill-opacity="0.85"/>`;
  }).join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="#fbf7f0"/>` +
    `<path d="M64 400 L192 144 L320 352 L448 112" fill="none" stroke="hsl(${hue} 45% 42%)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>` +
    circles +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function imageInput(env: Env, model: string, prompt: string): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt };
  // FLUX.1 schnell accepts `steps`; other Workers AI image models use their
  // own defaults so an unknown parameter cannot break them.
  if (model === AI_DEFAULT_IMAGE_MODEL || model.startsWith('@cf/black-forest-labs/flux-1')) {
    const steps = stepsFor(env);
    if (steps !== undefined) input.steps = steps;
  }
  const seed = seedFor(env);
  if (seed !== undefined) input.seed = seed;
  return input;
}

async function cloudflareBindingGenerate(
  env: Env,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<AiImageResult> {
  if (!env.AI) throw new ApiError(503, 'images_unavailable', 'The Cloudflare AI binding is not configured.');
  if (signal?.aborted) throw new ApiError(499, 'image_failed', 'The image request was cancelled.');
  const raw = await env.AI.run(model, imageInput(env, model, prompt));
  return { image: await normalizeImageOutput(raw), model };
}

async function cloudflareRestGenerate(
  env: Env,
  model: string,
  prompt: string,
  fetchImpl: typeof fetch,
): Promise<AiImageResult> {
  const account = (env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
  const token = (env.CLOUDFLARE_AI_TOKEN ?? '').trim();
  if (!account || !token) {
    throw new ApiError(503, 'images_unavailable', 'Cloudflare image generation is not configured.');
  }
  const input = imageInput(env, model, prompt);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai/run/${model}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(502, 'image_failed', 'Cloudflare rejected the image API token.');
      }
      if (response.status === 429) {
        throw new ApiError(429, 'rate_limited', 'Cloudflare AI is rate limiting image generation.');
      }
      throw new ApiError(502, 'image_failed', `Cloudflare AI image request failed (${response.status}).`);
    }
    const type = response.headers.get('content-type') ?? '';
    if (type.startsWith('image/')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { image: bytesToDataUrl(bytes), model };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(502, 'image_failed', 'Cloudflare AI returned an unreadable image response.');
    }
    const result =
      payload && typeof payload === 'object' && 'result' in (payload as Record<string, unknown>)
        ? (payload as Record<string, unknown>).result
        : payload;
    return { image: await normalizeImageOutput(result), model };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) {
      throw new ApiError(502, 'image_failed', 'Cloudflare AI did not return an image in time.');
    }
    throw new ApiError(
      502,
      'image_failed',
      `Could not reach Cloudflare AI (${(error instanceof Error ? error.message : String(error)).slice(0, 160)}).`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createImageGenerator(
  env: Env,
  fetchImpl: typeof fetch = fetch,
  requestedModel?: string,
): ImageGenerator | null {
  const provider = providerName(env);
  if (provider === 'none' || provider === 'off') return null;

  if (provider === 'demo') {
    return {
      model: 'demo-svg',
      demo: true,
      async generate(prompt) {
        return { image: demoImage(prompt), model: 'demo-svg' };
      },
    };
  }

  const model = resolveImageModel(env, requestedModel);
  if (env.AI) {
    return {
      model,
      demo: false,
      generate: (prompt, options = {}) =>
        cloudflareBindingGenerate(env, model, imagePrompt(prompt), options.signal),
    };
  }
  if ((env.CLOUDFLARE_ACCOUNT_ID ?? '').trim() && (env.CLOUDFLARE_AI_TOKEN ?? '').trim()) {
    return {
      model,
      demo: false,
      generate: (prompt) => cloudflareRestGenerate(env, model, imagePrompt(prompt), fetchImpl),
    };
  }
  return null;
}
