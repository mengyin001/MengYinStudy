/**
 * Browser transport for the hosted AI question service.
 *
 * The app sends only a bounded material excerpt and the learner's settings.
 * Provider keys, the authoring prompt and model selection stay on the server.
 */
import {
  AI_ROUTES,
  type AiErrorBody,
  type AiImageResult,
  type AiProgress,
  type AiQuestionRequest,
  type AiQuestionResult,
  type AiServiceConfig,
  type AiTestResult,
} from '@mengyin/ai-contract';
import { backend } from '@/services';
import { aiApiUrl } from './config';
import { packMaterialsForApi } from './materials';
import type { AiMaterial, AiSettings, GenerationRequest } from './types';

export class AiApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'AiApiError';
    this.code = code;
    this.status = status;
  }
}

async function requestHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  let token: string | null = null;
  try {
    token = await backend.auth.getAccessToken();
  } catch {
    token = null;
  }
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readApiError(response: Response): Promise<AiApiError> {
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      const parsed = JSON.parse(text) as AiErrorBody;
      if (parsed.error?.message) {
        return new AiApiError(parsed.error.code, parsed.error.message, response.status);
      }
    } catch {
      // fall through to a status-based message
    }
  }
  if (response.status === 401) {
    return new AiApiError('unauthorized', 'Sign in again to use AI generation.', 401);
  }
  if (response.status === 503) {
    return new AiApiError(
      'ai_unconfigured',
      text.slice(0, 300) || 'The AI service is not configured yet.',
      503,
    );
  }
  return new AiApiError(
    response.status >= 500 ? 'server_error' : 'invalid_request',
    text.slice(0, 300) || `The AI service returned HTTP ${response.status}.`,
    response.status,
  );
}

export async function getAiServiceConfig(signal?: AbortSignal): Promise<AiServiceConfig> {
  const response = await fetch(aiApiUrl(AI_ROUTES.config), {
    headers: await requestHeaders({ Accept: 'application/json' }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readApiError(response);
  return (await response.json()) as AiServiceConfig;
}

export async function testAiService(
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<AiTestResult> {
  const response = await fetch(aiApiUrl(AI_ROUTES.test), {
    method: 'POST',
    headers: await requestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({ model: settings.model }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readApiError(response);
  return (await response.json()) as AiTestResult;
}

export async function requestImage(
  prompt: string,
  alt?: string,
  options: { model?: string; signal?: AbortSignal } = {},
): Promise<AiImageResult> {
  const response = await fetch(aiApiUrl(AI_ROUTES.images), {
    method: 'POST',
    headers: await requestHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: JSON.stringify({
      prompt,
      ...(alt ? { alt } : {}),
      ...(options.model && options.model !== 'auto' ? { model: options.model } : {}),
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw await readApiError(response);
  return (await response.json()) as AiImageResult;
}

export interface GenerateApiOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AiProgress) => void;
}

async function readEventStream(
  stream: ReadableStream<Uint8Array>,
  options: GenerateApiOptions,
): Promise<AiQuestionResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state: { result: AiQuestionResult | null; failure: AiApiError | null } = {
    result: null,
    failure: null,
  };
  let buffer = '';

  const handle = (block: string): void => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value.trim();
      else if (field === 'data') data.push(value);
    }
    if (data.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join('\n'));
    } catch {
      throw new AiApiError('provider_error', 'The AI service sent an unreadable stream event.');
    }
    if (event === 'progress') {
      options.onProgress?.(parsed as AiProgress);
    } else if (event === 'result') {
      state.result = parsed as AiQuestionResult;
    } else if (event === 'error') {
      const body = parsed as AiErrorBody;
      state.failure = new AiApiError(
        body.error?.code ?? 'server_error',
        body.error?.message ?? 'The AI service reported an error.',
        200,
      );
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(block);
        if (state.failure) throw state.failure;
        index = buffer.indexOf('\n\n');
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    if (buffer.trim()) {
      handle(buffer);
      if (state.failure) throw state.failure;
    }
  } finally {
    reader.releaseLock();
  }

  if (state.failure) throw state.failure;
  if (!state.result) {
    throw new AiApiError(
      'provider_error',
      'The AI service closed the connection before returning a deck. Try again.',
    );
  }
  return state.result;
}

/**
 * Request a deck. The API streams progress while batches and illustrations are
 * produced, and returns the same payload as the plain JSON endpoint.
 */
export async function generateQuestionsWithApi(
  request: GenerationRequest,
  materials: readonly AiMaterial[],
  settings: AiSettings,
  options: GenerateApiOptions = {},
): Promise<AiQuestionResult> {
  const packed = packMaterialsForApi(materials, request.topic);
  const body: AiQuestionRequest = {
    topic: request.topic,
    count: request.count,
    difficulty: request.difficulty,
    language: request.language,
    types: request.types,
    ...(request.codeLanguage ? { codeLanguage: request.codeLanguage } : {}),
    ...(request.focus ? { focus: request.focus } : {}),
    ...(request.description ? { description: request.description } : {}),
    materials: packed.materials,
    model: settings.model,
    imageMode: settings.imageMode,
    ...(settings.imageModel !== 'auto' ? { imageModel: settings.imageModel } : {}),
  };

  let response: Response;
  try {
    response = await fetch(aiApiUrl(AI_ROUTES.questions), {
      method: 'POST',
      headers: await requestHeaders({
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      }),
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw new AiApiError('cancelled', 'Generation cancelled');
    throw new AiApiError(
      'network',
      `Could not reach the AI service (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  if (!response.ok) throw await readApiError(response);

  const contentType = response.headers.get('content-type') ?? '';
  const result =
    contentType.includes('text/event-stream') && response.body
      ? await readEventStream(response.body, options)
      : ((await response.json()) as AiQuestionResult);

  if (packed.omitted > 0) {
    result.warnings = [
      {
        code: 'materials',
        message: `${packed.omitted} material excerpt${packed.omitted === 1 ? ' was' : 's were'} left out to fit the API request limit. Attach fewer or shorter files for full coverage.`,
      },
      ...result.warnings,
    ];
  }
  return result;
}
