import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiQuestionResult } from '@mengyin/ai-contract';
import type { AiMaterial, GenerationRequest } from './types';

vi.mock('@/services', () => ({
  backend: { auth: { getAccessToken: async () => 'test-token' } },
}));

import { AiApiError, generateQuestionsWithApi, testAiService } from './api';

const request: GenerationRequest = {
  topic: 'Stacks',
  count: 2,
  difficulty: 'mixed',
  language: 'en',
  types: ['single'],
};

const material: AiMaterial = {
  id: 'm1',
  name: 'notes.md',
  size: 20,
  kind: 'text',
  chars: 20,
  truncated: false,
  addedAt: 1,
  text: 'A stack is LIFO.',
};

const result: AiQuestionResult = {
  deck: {
    key: 'ai.stacks::d',
    id: 'd',
    pluginId: 'ai.stacks',
    title: 'Stacks',
    tags: ['Stacks'],
    questions: [
      {
        id: 'q1',
        type: 'single',
        prompt: 'Which is LIFO?',
        options: [
          { id: 'a', text: 'Queue' },
          { id: 'b', text: 'Stack' },
        ],
        answer: { kind: 'single', optionId: 'b' },
        tags: ['Stacks'],
        difficulty: 2,
      },
    ],
  },
  warnings: [],
  usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  engine: { provider: 'glm', providerLabel: 'GLM', model: 'glm-4.7-flash' },
  images: { requested: 0, generated: 0, failed: 0, diagrams: 0 },
};

function eventStream(body: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AI API client', () => {
  it('sends the session token and streams progress into the result', async () => {
    const fetchMock = vi.fn(async () =>
      eventStream(
        [
          'event: progress',
          'data: {"stage":"requesting","batch":1,"batches":1,"message":"batch 1/1"}',
          '',
          'event: progress',
          'data: {"stage":"illustrating","batch":1,"batches":1,"message":"illustration 1/1"}',
          '',
          'event: result',
          `data: ${JSON.stringify(result)}`,
          '',
          '',
        ].join('\n'),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const progress: string[] = [];
    const generated = await generateQuestionsWithApi(
      request,
      [material],
      {
        model: 'glm-4.7-flash',
        imageMode: 'auto',
        imageModel: '@cf/black-forest-labs/flux-1-schnell',
      },
      { onProgress: (event) => progress.push(event.stage) },
    );

    expect(generated.deck.title).toBe('Stacks');
    expect(progress).toEqual(['requesting', 'illustrating']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ai/questions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      topic: 'Stacks',
      count: 2,
      model: 'glm-4.7-flash',
      imageMode: 'auto',
      imageModel: '@cf/black-forest-labs/flux-1-schnell',
      materials: [{ name: 'notes.md', text: 'A stack is LIFO.' }],
    });
  });

  it('throws the server error event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        eventStream('event: error\ndata: {"error":{"code":"provider_rate","message":"slow down"}}\n\n'),
      ),
    );
    await expect(
      generateQuestionsWithApi(request, [], {
        model: 'glm-4.7-flash',
        imageMode: 'auto',
        imageModel: 'auto',
      }),
    ).rejects.toMatchObject({ code: 'provider_rate', message: 'slow down' });
  });

  it('maps a non-2xx response to AiApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Sign in again.' } }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const failure = await generateQuestionsWithApi(request, [], {
      model: 'glm-4.7-flash',
      imageMode: 'auto',
      imageModel: 'auto',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AiApiError);
    expect(failure).toMatchObject({ code: 'unauthorized', status: 401 });
  });

  it('accepts a plain JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const generated = await generateQuestionsWithApi(request, [], {
      model: 'glm-4.7-flash',
      imageMode: 'off',
      imageModel: 'auto',
    });
    expect(generated.deck.questions).toHaveLength(1);
  });

  it('tests the selected provider', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          provider: 'deepseek',
          providerLabel: 'DeepSeek',
          model: 'deepseek-flash',
          latencyMs: 12,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tested = await testAiService({
      model: 'deepseek-flash',
      imageMode: 'auto',
      imageModel: 'auto',
    });
    expect(tested).toMatchObject({ ok: true, provider: 'deepseek', latencyMs: 12 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ model: 'deepseek-flash' });
  });
});
