/**
 * OpenAI-compatible chat transport for the official GLM and DeepSeek APIs.
 *
 * Provider keys stay inside the Worker. Errors are reduced to a code and a
 * short message so a key can never appear in a response or a log line.
 */
import type { AiUsage } from '@mengyin/ai-contract';

export type AiErrorCode =
  | 'auth'
  | 'rate'
  | 'network'
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
  /** Retry transient failures; default true (up to five attempts). */
  retry?: boolean;
  /**
   * Force a non-streaming JSON reply. The key test uses this because a provider
   * that holds an SSE connection open would otherwise look like a hang.
   */
  stream?: boolean;
}

export interface ChatModel {
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: string;
  complete(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}

export interface OpenAiChatConfig {
  provider: string;
  providerLabel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
  /** `enabled` / `disabled` for providers that expose a thinking switch. */
  thinking?: 'enabled' | 'disabled';
  /** DeepSeek's reasoning effort, when thinking is enabled. */
  reasoningEffort?: 'low' | 'high' | 'max';
  /** Total attempts for a retryable failure (rate limit, 5xx, network). */
  retryAttempts?: number;
  /** Base backoff in milliseconds; doubles on each attempt, capped at 8 s. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

function apiUrl(baseUrl: string, path: string): string {
  // Accept both a base URL and a full endpoint pasted from the provider docs,
  // e.g. https://open.bigmodel.cn/api/paas/v4/chat/completions.
  const base = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '');
  return `${base}/${path.replace(/^\/+/, '')}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiError('cancelled', 'The request was cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AiError('cancelled', 'The request was cancelled'));
      },
      { once: true },
    );
  });
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string } | string;
      message?: string;
      msg?: string;
    };
    if (typeof parsed.error === 'string') return parsed.error.slice(0, 300);
    if (parsed.error?.message) return String(parsed.error.message).slice(0, 300);
    if (typeof parsed.message === 'string') return parsed.message.slice(0, 300);
    if (typeof parsed.msg === 'string') return parsed.msg.slice(0, 300);
  } catch {
    // fall through to the raw body
  }
  return text.slice(0, 300);
}

function mapHttpError(status: number, body: string): AiError {
  const detail = body ? ` — ${body}` : '';
  if (status === 401 || status === 403) {
    return new AiError('auth', `Provider authentication failed (${status}). Check the server key.${detail}`, {
      status,
    });
  }
  if (status === 404) {
    return new AiError('endpoint', `The provider has no chat endpoint at this URL (404).${detail}`, { status });
  }
  if (status === 429) {
    return new AiError('rate', `The provider is rate limiting or out of quota (429).${detail}`, {
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AiError('server', `The provider failed (${status}).${detail}`, { status, retryable: true });
  }
  return new AiError('server', `The provider rejected the request (${status}).${detail}`, { status });
}

function supportsJsonMode(provider: string, model: string): boolean {
  // DeepSeek's thinking models used to reject response_format; retrying
  // without it is harmless, so only disable it for known-reasoning models.
  if (provider === 'deepseek' && /reasoner|thinking/i.test(model)) return false;
  return true;
}

function supportsTemperature(provider: string, model: string): boolean {
  if (provider === 'deepseek' && /reasoner|thinking/i.test(model)) return false;
  return true;
}

interface StreamState {
  text: string;
  reasoning: string;
  model?: string;
  usage?: AiUsage;
  finishReason?: string;
}

function usageFrom(raw: unknown): AiUsage | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const usage = raw as Record<string, unknown>;
  return {
    promptTokens: Number(usage.prompt_tokens ?? usage.promptTokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? usage.completionTokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? usage.totalTokens ?? 0),
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('');
  }
  return '';
}

/** Consume one `data:` block from an OpenAI-compatible SSE stream. */
function consumeStreamBlock(block: string, state: StreamState): 'done' | 'data' | 'none' {
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return 'none';
  const raw = data.join('\n').trim();
  if (raw === '[DONE]') return 'done';
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // A provider may interleave a non-JSON notice. Ignore it rather than
    // discarding the tokens already received.
    return 'none';
  }
  const dataObject = (payload ?? {}) as {
    model?: unknown;
    error?: { message?: unknown } | string;
    choices?: {
      delta?: { content?: unknown; reasoning_content?: unknown };
      message?: { content?: unknown; reasoning_content?: unknown };
      text?: unknown;
      finish_reason?: unknown;
      finishReason?: unknown;
    }[];
    usage?: unknown;
  };
  if (dataObject.error) {
    const message =
      typeof dataObject.error === 'string'
        ? dataObject.error
        : String(dataObject.error.message ?? 'The provider reported an error.');
    throw new AiError('server', message.slice(0, 300));
  }
  if (typeof dataObject.model === 'string') state.model = dataObject.model;
  const usage = usageFrom(dataObject.usage);
  if (usage) state.usage = usage;
  const choices = Array.isArray(dataObject.choices) ? dataObject.choices : [];
  for (const choice of choices) {
    const delta = choice?.delta ?? choice?.message ?? {};
    state.text += textFromContent(delta.content ?? choice?.text);
    if (typeof delta.reasoning_content === 'string') state.reasoning += delta.reasoning_content;
    const finish = choice?.finish_reason ?? choice?.finishReason;
    if (typeof finish === 'string') state.finishReason = finish;
  }
  return 'data';
}

/**
 * Read an SSE completion while an inactivity timer watches the connection.
 * Every network chunk resets the timer: a provider that keeps producing tokens
 * may run longer than the timeout, while a silent connection still fails.
 */
async function readStream(
  body: ReadableStream<Uint8Array>,
  onActivity: () => void,
  signal?: AbortSignal,
): Promise<StreamState> {
  const state: StreamState = { text: '', reasoning: '' };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (consumeStreamBlock(block, state) === 'done') return state;
        index = buffer.indexOf('\n\n');
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    if (buffer.trim()) consumeStreamBlock(buffer, state);
    return state;
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function resultFromState(state: StreamState): ChatResult {
  if (!state.text.trim()) {
    if (state.finishReason === 'length') {
      throw new AiError('truncated', 'The provider stopped at its output limit before writing a reply');
    }
    if (state.reasoning.trim()) {
      throw new AiError(
        'empty',
        'The provider only returned reasoning, not a final answer. Lower the thinking budget or choose a non-thinking model.',
      );
    }
    throw new AiError('empty', 'The provider returned an empty reply');
  }
  return {
    text: state.text,
    ...(state.model ? { model: state.model } : {}),
    ...(state.usage ? { usage: state.usage } : {}),
    ...(state.finishReason ? { finishReason: state.finishReason } : {}),
  };
}

function resultFromJson(payload: unknown): ChatResult {
  const data = payload as {
    model?: string;
    choices?: {
      message?: { content?: unknown; reasoning_content?: unknown };
      text?: unknown;
      finish_reason?: string;
      finishReason?: string;
    }[];
    usage?: Record<string, unknown>;
  };
  const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text;
  const finishReason = data.choices?.[0]?.finish_reason ?? data.choices?.[0]?.finishReason;
  const text = textFromContent(content);
  if (!text.trim()) {
    if (finishReason === 'length') {
      throw new AiError('truncated', 'The provider stopped at its output limit before writing a reply');
    }
    const reasoning = data.choices?.[0]?.message?.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      throw new AiError(
        'empty',
        'The provider only returned reasoning, not a final answer. Lower the thinking budget or choose a non-thinking model.',
      );
    }
    throw new AiError('empty', 'The provider returned an empty reply');
  }
  const usage = usageFrom(data.usage);
  return {
    text,
    ...(typeof data.model === 'string' ? { model: data.model } : {}),
    ...(usage ? { usage } : {}),
    ...(typeof finishReason === 'string' ? { finishReason } : {}),
  };
}

async function postChat(
  config: OpenAiChatConfig,
  messages: ChatMessage[],
  options: ChatOptions,
  allowFallback: boolean,
  stream = true,
): Promise<ChatResult> {
  const timeoutController = new AbortController();
  let inactivity: ReturnType<typeof setTimeout> | undefined;
  let headersReceived = false;
  const arm = () => {
    if (inactivity) clearTimeout(inactivity);
    inactivity = setTimeout(
      () => timeoutController.abort(new DOMException('Timeout', 'TimeoutError')),
      config.timeoutMs,
    );
  };
  const onAbort = () => {
    if (inactivity) clearTimeout(inactivity);
    timeoutController.abort();
  };
  arm();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

    const useJson = (options.jsonMode ?? config.jsonMode) && supportsJsonMode(config.provider, config.model);
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: options.maxTokens ?? config.maxTokens,
      stream,
    };
    if (supportsTemperature(config.provider, config.model)) {
      body.temperature = options.temperature ?? config.temperature;
    }
    if (useJson) body.response_format = { type: 'json_object' };
    if (config.thinking) body.thinking = { type: config.thinking };
    if (config.thinking === 'enabled' && config.reasoningEffort) {
      body.reasoning_effort = config.reasoningEffort;
    }

    let response: Response;
    try {
      response = await (config.fetchImpl ?? fetch)(apiUrl(config.baseUrl, '/chat/completions'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw new AiError('cancelled', 'The request was cancelled');
      if (timeoutController.signal.aborted) {
        throw new AiError('timeout', `The provider did not reply within ${Math.round(config.timeoutMs / 1000)} s`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AiError('network', `Could not reach the provider (${message.slice(0, 200)})`, {
        retryable: true,
      });
    }

    headersReceived = true;
    arm();

    if (!response.ok) {
      const text = await readError(response);
      // Some models reject response_format, thinking or streaming; retry once
      // with the smallest OpenAI-compatible body rather than failing the batch.
      if (allowFallback && (response.status === 400 || response.status === 422)) {
        const stripped: OpenAiChatConfig = { ...config, jsonMode: false };
        delete stripped.thinking;
        delete stripped.reasoningEffort;
        return postChat(stripped, messages, { ...options, jsonMode: false }, false, false);
      }
      throw mapHttpError(response.status, text);
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (stream && response.body && contentType.includes('text/event-stream')) {
      const state = await readStream(response.body, arm, timeoutController.signal);
      if (timeoutController.signal.aborted) {
        if (options.signal?.aborted) throw new AiError('cancelled', 'The request was cancelled');
        throw new AiError(
          'timeout',
          `The provider sent no data for ${Math.round(config.timeoutMs / 1000)} s`,
        );
      }
      return resultFromState(state);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AiError('format', 'The provider returned something that is not JSON');
    }
    return resultFromJson(payload);
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (options.signal?.aborted) throw new AiError('cancelled', 'The request was cancelled');
    if (timeoutController.signal.aborted) {
      const seconds = Math.round(config.timeoutMs / 1000);
      throw new AiError(
        'timeout',
        headersReceived
          ? `The provider sent no data for ${seconds} s`
          : `The provider did not reply within ${seconds} s`,
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AiError('network', `Could not reach the provider (${message.slice(0, 200)})`, {
      retryable: true,
    });
  } finally {
    if (inactivity) clearTimeout(inactivity);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/** A chat model that talks to one provider endpoint with one server-held key. */
export function createOpenAiChatModel(config: OpenAiChatConfig): ChatModel {
  return {
    provider: config.provider,
    providerLabel: config.providerLabel,
    model: config.model,
    async complete(messages, options = {}) {
      const retry = options.retry !== false;
      const attempts = retry
        ? Math.max(1, Math.min(10, Math.round(config.retryAttempts ?? 5)))
        : 1;
      const baseDelay = Math.max(0, config.retryDelayMs ?? 800);
      let lastError: unknown;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await postChat(config, messages, options, true, options.stream !== false);
        } catch (error) {
          lastError = error;
          const retryable = error instanceof AiError && error.retryable;
          if (!retryable || attempt >= attempts - 1) throw error;
          // 0.8 s, 1.6 s, 3.2 s, 6.4 s (capped at 8 s). A split sub-batch gets
          // the same full retry budget as the first call.
          await sleep(Math.min(8_000, baseDelay * 2 ** attempt), options.signal);
        }
      }
      throw lastError;
    },
  };
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

  return parseJsonSlice(candidate.slice(start, end));
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, '$1');
}

/**
 * JSON does not allow literal control characters inside strings, but models
 * often write an explanation with real line breaks. Escape only those bytes
 * so a nearly-correct reply can be used without another provider call.
 */
function escapeControlCharacters(text: string): string {
  let output = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!char) break;
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }
    const code = char.charCodeAt(0);
    if (code >= 0x20) {
      output += char;
      continue;
    }
    if (char === '\n') output += '\\n';
    else if (char === '\r') output += '\\r';
    else if (char === '\t') output += '\\t';
    else if (char === '\b') output += '\\b';
    else if (char === '\f') output += '\\f';
    else output += `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return output;
}

function parseJsonSlice(slice: string): unknown {
  const withoutTrailingCommas = stripTrailingCommas(slice);
  const escaped = escapeControlCharacters(slice);
  const candidates = [slice, withoutTrailingCommas, escaped, stripTrailingCommas(escaped)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next repair.
    }
  }
  throw new AiError('format', 'The reply is not valid JSON');
}
