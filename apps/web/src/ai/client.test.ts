import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, chatComplete, parseJsonLoose } from './client';
import { apiUrl, DEFAULT_AI_CONFIG, isAiConfigured, normalizeAiConfig } from './config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseJsonLoose', () => {
  it('reads a plain object', () => {
    expect(parseJsonLoose('{"questions":[]}')).toEqual({ questions: [] });
  });

  it('strips markdown fences', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('finds the object inside prose', () => {
    expect(parseJsonLoose('Here you go: {"questions":[{"prompt":"x"}]} — done')).toEqual({
      questions: [{ prompt: 'x' }],
    });
  });

  it('repairs a trailing comma', () => {
    expect(parseJsonLoose('{"a":1,}')).toEqual({ a: 1 });
  });

  it('throws a format error when there is no JSON', () => {
    expect(() => parseJsonLoose('not json at all')).toThrowError(AiError);
  });

  it('marks an unclosed object as truncated rather than malformed', () => {
    let thrown: unknown;
    try {
      parseJsonLoose('{"questions":[{"prompt":"cut');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ code: 'truncated' });
  });
});

describe('config', () => {
  it('joins API paths without duplicate slashes', () => {
    expect(apiUrl('https://api.openai.com/v1/', '/chat/completions')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });

  it('keeps an intentionally empty base URL empty', () => {
    const config = normalizeAiConfig({ ...DEFAULT_AI_CONFIG, baseUrl: '  ' });
    expect(config.baseUrl).toBe('');
    expect(isAiConfigured(config)).toBe(false);
  });

  it('clamps temperature and token limits', () => {
    const config = normalizeAiConfig({ ...DEFAULT_AI_CONFIG, temperature: 9, maxTokens: 99_999 });
    expect(config.temperature).toBe(2);
    expect(config.maxTokens).toBe(32_000);
  });
});

describe('chatComplete', () => {
  const config = { ...DEFAULT_AI_CONFIG, apiKey: 'secret', jsonMode: false, timeoutMs: 5_000 };

  it('returns the message text and usage', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: 'test-model',
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatComplete(config, [{ role: 'user', content: 'hi' }]);
    expect(result.text).toBe('hello');
    expect(result.model).toBe('test-model');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a length finish reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"questions":[' }, finish_reason: 'length' }],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await chatComplete(config, [{ role: 'user', content: 'hi' }]);
    expect(result.finishReason).toBe('length');
  });

  it('maps 401 to an auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }),
      ),
    );
    await expect(chatComplete(config, [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'auth',
      status: 401,
    });
  });

  it('retries without response_format when a provider rejects it', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      if (bodies.length === 1) {
        return new Response('{"error":{"message":"response_format unsupported"}}', { status: 400 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await chatComplete(
      { ...config, jsonMode: true },
      [{ role: 'user', content: 'hi' }],
    );
    expect(result.text).toBe('ok');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('response_format');
    expect(bodies[1]).not.toContain('response_format');
  });

  it('rejects an empty reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '  ' } }] }), { status: 200 })),
    );
    await expect(chatComplete(config, [{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'empty',
    });
  });
});
