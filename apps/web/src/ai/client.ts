/**
 * Minimal OpenAI-compatible chat client.
 *
 * The learner's key never leaves this device except in the Authorization
 * header sent directly to their chosen endpoint. The app has no proxy and no
 * telemetry. Providers must allow browser CORS requests.
 */
import { apiUrl } from './config';
import type { AiConfig, AiUsage } from './types';

export type AiErrorCode =
  | 'auth'
  | 'rate'
  | 'network'
  | 'cors'
  | 'timeout'
  | 'endpoint'
  | 'server'
  | 'empty'
  | 'format'
  | 'truncated'
  | 'cancelled';

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(code: AiErrorCode, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    this.retryable = options.retryable === true;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  model?: string;
  usage?: AiUsage;
  finishReason?: string;
}

export interface ChatOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object when supported. */
  jsonMode?: boolean;
  /** Adds a retry after a transient failure; default true. */
  retry?: boolean;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

function abortError(): AiError {
  return new AiError('cancelled', 'The request was cancelled');
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // fall through to the raw body
  }
  return text.slice(0, 400);
}

function mapHttpError(status: number, body: string): AiError {
  const detail = body ? ` — ${body}` : '';
  if (status === 401 || status === 403) {
    return new AiError('auth', `Authentication failed (${status}). Check the API key.${detail}`, { status });
  }
  if (status === 404) {
    return new AiError(
      'endpoint',
      `No API at this URL (404). Include the version path, e.g. https://api.openai.com/v1.${detail}`,
      { status },
    );
  }
  if (status === 429) {
    return new AiError('rate', `Rate limited or out of quota (429).${detail}`, { status, retryable: true });
  }
  if (status >= 500) {
    return new AiError('server', `Provider error (${status}).${detail}`, { status, retryable: true });
  }
  return new AiError('server', `Request rejected (${status}).${detail}`, { status });
}

async function postChat(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<ChatResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), config.timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature: options.temperature ?? config.temperature,
      max_tokens: options.maxTokens ?? config.maxTokens,
      stream: false,
    };
    if (options.jsonMode ?? config.jsonMode) body.response_format = { type: 'json_object' };

    let response: Response;
    try {
      response = await fetch(apiUrl(config.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (controller.signal.aborted) {
        throw new AiError('timeout', `No reply within ${Math.round(config.timeoutMs / 1000)} s`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AiError(
        'network',
        `Could not reach the API (${message}). Check the URL, the network, and whether the provider allows browser requests (CORS).`,
        { retryable: true },
      );
    }

    if (!response.ok) {
      const text = await readError(response);
      // Some providers reject response_format even though they accept chat.
      if (body.response_format && (response.status === 400 || response.status === 422)) {
        delete body.response_format;
        return postChat(config, messages, { ...options, jsonMode: false });
      }
      throw mapHttpError(response.status, text);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiError('format', 'The provider returned something that is not JSON');
    }

    const data = payload as {
      model?: string;
      choices?: { message?: { content?: unknown }; text?: unknown; finish_reason?: string; finishReason?: string }[];
      usage?: Record<string, unknown>;
    };
    const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text;
    const finishReason = data.choices?.[0]?.finish_reason ?? data.choices?.[0]?.finishReason;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
              .join('')
          : '';
    if (!text.trim()) throw new AiError('empty', 'The model returned an empty reply');

    const usage = data.usage
      ? {
          promptTokens: Number(data.usage.prompt_tokens ?? data.usage.promptTokens ?? 0),
          completionTokens: Number(data.usage.completion_tokens ?? data.usage.completionTokens ?? 0),
          totalTokens: Number(data.usage.total_tokens ?? data.usage.totalTokens ?? 0),
        }
      : undefined;

    return {
      text,
      ...(typeof data.model === 'string' ? { model: data.model } : {}),
      ...(usage ? { usage } : {}),
      ...(typeof finishReason === 'string' ? { finishReason } : {}),
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function chatComplete(
  config: AiConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const retry = options.retry !== false;
  try {
    return await postChat(config, messages, options);
  } catch (error) {
    if (!(error instanceof AiError) || !error.retryable || !retry) throw error;
    await sleep(1200, options.signal);
    return postChat(config, messages, { ...options, retry: false });
  }
}

/** A one-token chat proves the endpoint, key and model all work. */
export async function testConnection(
  config: AiConfig,
  signal?: AbortSignal,
): Promise<{ model: string }> {
  const result = await chatComplete(
    config,
    [
      { role: 'system', content: 'You are a health check. Reply with the single word OK.' },
      { role: 'user', content: 'Reply now.' },
    ],
    { maxTokens: 8, temperature: 0, jsonMode: false, retry: false, ...(signal ? { signal } : {}) },
  );
  return { model: result.model ?? config.model };
}

/**
 * Pull the first JSON value out of a model reply, tolerating code fences and
 * a sentence before or after the object.
 */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) throw new AiError('format', 'The reply was empty');

  const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(cleaned);
  const candidate = (fenced?.[1] ?? cleaned).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // find a balanced top-level object/array
  }

  const start = (() => {
    const object = candidate.indexOf('{');
    const array = candidate.indexOf('[');
    if (object === -1) return array;
    if (array === -1) return object;
    return Math.min(object, array);
  })();
  if (start === -1) throw new AiError('format', 'No JSON object in the reply');

  const open = candidate[start] ?? '{';
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }
  if (end === -1) throw new AiError('truncated', 'The JSON in the reply is incomplete');

  const slice = candidate.slice(start, end);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      throw new AiError('format', 'The reply is not valid JSON');
    }
  }
}
