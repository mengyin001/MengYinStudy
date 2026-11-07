import { describe, expect, it } from 'vitest';
import { AiError, createOpenAiChatModel, parseJsonLoose, type OpenAiChatConfig } from './chat';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function config(overrides: Partial<OpenAiChatConfig> = {}): OpenAiChatConfig {
  return {
    provider: 'glm',
    providerLabel: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: 'test-key',
    model: 'glm-5.3-flash',
    temperature: 0.4,
    maxTokens: 1024,
    timeoutMs: 5_000,
    jsonMode: true,
    ...overrides,
  };
}

describe('OpenAI-compatible chat model', () => {
  it('posts the official chat shape and parses text and usage', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({
        model: 'glm-5.3-flash',
        choices: [{ message: { content: 'hola' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
      });
    }) as typeof fetch;

    const model = createOpenAiChatModel(config({ fetchImpl }));
    const result = await model.complete([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('hola');
    expect(result.usage).toEqual({ promptTokens: 5, completionTokens: 7, totalTokens: 12 });
    expect(calls[0]?.url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'glm-5.3-flash',
      stream: true,
      temperature: 0.4,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('accepts a full chat completions URL as the configured base URL', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as typeof fetch;

    const model = createOpenAiChatModel(
      config({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions/',
        fetchImpl,
      }),
    );
    await model.complete([{ role: 'user', content: 'hi' }]);
    expect(calls[0]).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
  });

  it('retries once without response_format when a provider rejects it', async () => {
    let calls = 0;
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (calls === 1) return jsonResponse({ error: { message: 'response_format unsupported' } }, 400);
      return jsonResponse({ choices: [{ message: { content: '{"questions":[]}' } }] });
    }) as typeof fetch;

    const model = createOpenAiChatModel(config({ fetchImpl }));
    const result = await model.complete([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('{"questions":[]}');
    expect(calls).toBe(2);
    expect(bodies[0]?.response_format).toBeDefined();
    expect(bodies[1]?.response_format).toBeUndefined();
  });

  it('omits temperature and JSON mode for a DeepSeek reasoning model', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as typeof fetch;

    const model = createOpenAiChatModel(
      config({
        provider: 'deepseek',
        providerLabel: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-reasoner',
        fetchImpl,
      }),
    );
    await model.complete([{ role: 'user', content: 'hi' }]);
    expect(body.temperature).toBeUndefined();
    expect(body.response_format).toBeUndefined();
  });

  it('sends DeepSeek thinking switches when configured', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as typeof fetch;

    const model = createOpenAiChatModel(
      config({
        provider: 'deepseek',
        providerLabel: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-flash',
        thinking: 'enabled',
        reasoningEffort: 'low',
        fetchImpl,
      }),
    );
    await model.complete([{ role: 'user', content: 'hi' }]);
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('low');
  });

  it('retries a rate-limited request with backoff and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({ error: { message: 'busy' } }, 429);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as typeof fetch;

    const model = createOpenAiChatModel(
      config({ fetchImpl, retryAttempts: 5, retryDelayMs: 1 }),
    );
    const result = await model.complete([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('ok');
    expect(calls).toBe(3);
  });

  it('stops after the configured number of retryable failures', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ error: { message: 'busy' } }, 429);
    }) as typeof fetch;

    const model = createOpenAiChatModel(
      config({ fetchImpl, retryAttempts: 3, retryDelayMs: 1 }),
    );
    await expect(model.complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'rate',
      status: 429,
    });
    expect(calls).toBe(3);
  });

  it('maps provider failures to stable error codes', async () => {
    const auth = createOpenAiChatModel(
      config({
        fetchImpl: (async () => jsonResponse({ error: { message: 'bad key' } }, 401)) as typeof fetch,
      }),
    );
    await expect(auth.complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });

    const rate = createOpenAiChatModel(
      config({
        fetchImpl: (async () => jsonResponse({ error: { message: 'slow down' } }, 429)) as typeof fetch,
      }),
    );
    await expect(rate.complete([{ role: 'user', content: 'hi' }], { retry: false })).rejects.toMatchObject(
      { code: 'rate', status: 429 },
    );
  });

  it('reports a cut-off reply as truncation', async () => {
    const model = createOpenAiChatModel(
      config({
        fetchImpl: (async () =>
          jsonResponse({
            choices: [{ message: { content: '' }, finish_reason: 'length' }],
          })) as typeof fetch,
      }),
    );
    await expect(model.complete([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(AiError);
    await expect(model.complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'truncated',
    });
  });
  it('assembles a streamed reply and its usage', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        sseChunk({
          model: 'glm-4.7-flash',
          choices: [{ delta: { content: '{"questions":' } }],
        }),
        sseChunk({
          choices: [{ delta: { content: '[]}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
        'data: [DONE]\n\n',
      ])) as typeof fetch;

    const model = createOpenAiChatModel(config({ fetchImpl }));
    const result = await model.complete([{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('{"questions":[]}');
    expect(result.model).toBe('glm-4.7-flash');
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    expect(result.finishReason).toBe('stop');
  });

  it('does not time out while streamed chunks keep arriving', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      sseChunk({ choices: [{ delta: { content: 'o' } }] }),
      sseChunk({ choices: [{ delta: { content: 'k' }, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let index = 0;
        const send = () => {
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(chunks[index]));
          index += 1;
          setTimeout(send, 50);
        };
        setTimeout(send, 50);
      },
    });
    const fetchImpl = (async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;

    // Each gap is 50 ms and the whole reply takes 150 ms, so a fixed 120 ms
    // timer would abort it; the inactivity timer resets on every chunk.
    const model = createOpenAiChatModel(config({ fetchImpl, timeoutMs: 120 }));
    await expect(model.complete([{ role: 'user', content: 'hi' }])).resolves.toMatchObject({
      text: 'ok',
    });
  });

  it('times out only after a silent stream', async () => {
    const body = new ReadableStream<Uint8Array>({ start() {} });
    const fetchImpl = (async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
    const model = createOpenAiChatModel(config({ fetchImpl, timeoutMs: 40 }));

    await expect(model.complete([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

describe('parseJsonLoose', () => {
  it('accepts fences and trailing prose', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"questions":[]} thanks')).toEqual({ questions: [] });
  });

  it('repairs literal newlines and tabs inside strings', () => {
    const text = '{"questions":[{"prompt":"first line\nsecond line","explanation":"a\tb"}]}';
    expect(parseJsonLoose(text)).toEqual({
      questions: [{ prompt: 'first line\nsecond line', explanation: 'a\tb' }],
    });
  });

  it('repairs a trailing comma after a literal newline', () => {
    const text = '{"questions":[{"prompt":"line one\nline two"},]}';
    expect(parseJsonLoose(text)).toEqual({ questions: [{ prompt: 'line one\nline two' }] });
  });

  it('throws a format error when there is no JSON', () => {
    expect(() => parseJsonLoose('not json at all')).toThrow(/JSON/);
  });
});
