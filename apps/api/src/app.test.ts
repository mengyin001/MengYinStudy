import { describe, expect, it } from 'vitest';
import type { AiQuestionResult } from '@mengyin/ai-contract';
import { createApp } from './app';
import type { Env } from './env';
import type { KvNamespaceLike } from './env';

const env: Env = {
  AI_MOCK: '1',
  AUTH_REQUIRED: 'false',
  IMAGE_PROVIDER: 'demo',
};

const app = createApp();

function request(path: string, init: RequestInit = {}, target = env): Promise<Response> {
  return app.fetch(new Request(`https://app.test${path}`, init), target);
}

function memoryKv(): KvNamespaceLike {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

describe('AI service routes', () => {
  it('reports health without requiring a session', async () => {
    const response = await request('/api/ai/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      service: 'mengyin-ai',
      providersConfigured: 1,
      imagesAvailable: true,
    });
  });

  it('lists providers and the image capability', async () => {
    const response = await request('/api/ai/config');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      providers: { id: string; configured: boolean }[];
      images: {
        available: boolean;
        model: string;
        models: { id: string; label: string }[];
        search?: { available: boolean; provider: string | null };
      };
      authRequired: boolean;
    };
    expect(body.providers.find((provider) => provider.id === 'demo')?.configured).toBe(true);
    expect(body).not.toHaveProperty('defaultProvider');
    expect(body.images).toMatchObject({
      available: true,
      model: 'demo-svg',
      models: [{ id: 'demo-svg', label: 'Demo illustration' }],
    });
    expect(body.images.search).toMatchObject({ available: true, provider: 'wikimedia' });
    expect(body.authRequired).toBe(false);
  });

  it('generates a deck with an attached illustration', async () => {
    const response = await request('/api/ai/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Stacks',
        count: 2,
        types: ['single', 'boolean'],
        imageMode: 'auto',
        model: 'demo',
      }),
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as AiQuestionResult;
    expect(result.deck.questions).toHaveLength(2);
    expect(result.engine.provider).toBe('demo');
    expect(result.images.generated).toBe(1);
    expect(result.deck.questions[1]?.media).toHaveLength(1);
    const media = result.deck.questions[1]?.media?.[0];
    expect(media?.type).toBe('image');
    if (media?.type === 'image') expect(media.src.startsWith('data:image/svg+xml')).toBe(true);
    // The prompt is server-side only; a deck must not advertise the skill.
    expect(result.deck.description).not.toMatch(/skill/i);
    expect(result.warnings.some((warning) => warning.code === 'model')).toBe(true);
  });

  it('streams progress and the final result as server-sent events', async () => {
    const response = await request('/api/ai/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ topic: 'Queues', count: 2, types: ['single', 'boolean'], model: 'demo' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('event: progress');
    expect(text).toContain('event: result');
    const block = text
      .split('\n\n')
      .find((part) => part.startsWith('event: result'));
    expect(block).toBeDefined();
    const data = block!
      .split('\n')
      .find((line) => line.startsWith('data: '))!
      .slice('data: '.length);
    const result = JSON.parse(data) as AiQuestionResult;
    expect(result.deck.questions).toHaveLength(2);
  });

  it('rejects an image model outside the server allowlist', async () => {
    const response = await request('/api/ai/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Cells',
        count: 1,
        imageMode: 'auto',
        imageModel: 'not-a-model',
        model: 'demo',
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });

  it('generates a single image on demand', async () => {
    const response = await request('/api/ai/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a leaf cross-section', alt: 'leaf' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { image: string; model: string; alt: string };
    expect(body.image.startsWith('data:image/svg+xml')).toBe(true);
    expect(body.model).toBe('demo-svg');
    expect(body.alt).toBe('leaf');
  });

  it('tests the selected provider', async () => {
    const response = await request('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'demo' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, provider: 'demo' });
  });

  it('rejects malformed requests and unknown API paths', async () => {
    const bad = await request('/api/ai/questions', { method: 'POST', body: '{' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'invalid_request' } });

    const missing = await request('/api/ai/nope');
    expect(missing.status).toBe(404);
  });
});

describe('access control and quotas', () => {
  it('requires a bearer token when auth is enabled', async () => {
    const protectedEnv: Env = {
      ...env,
      AUTH_REQUIRED: 'true',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'publishable',
    };
    const response = await request('/api/ai/config', {}, protectedEnv);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('accepts an injected verified user', async () => {
    const authed = createApp({ authenticate: async () => ({ userId: 'user-1', token: null }) });
    const response = await authed.fetch(
      new Request('https://app.test/api/ai/config'),
      { ...env, AUTH_REQUIRED: 'true' },
    );
    expect(response.status).toBe(200);
  });

  it('enforces the optional daily question quota', async () => {
    const authed = createApp({ authenticate: async () => ({ userId: 'user-1', token: null }) });
    const quotaEnv: Env = {
      ...env,
      AUTH_REQUIRED: 'true',
      AI_QUOTA: memoryKv(),
      AI_DAILY_QUESTIONS: '1',
    };
    const response = await authed.fetch(
      new Request('https://app.test/api/ai/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'Limits', count: 2, model: 'demo' }),
      }),
      quotaEnv,
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: 'quota_exceeded' } });
  });

  it('adds CORS headers only for allowed origins', async () => {
    const allowed = await request(
      '/api/ai/health',
      { headers: { Origin: 'https://example.com' } },
      { ...env, ALLOWED_ORIGINS: 'https://example.com' },
    );
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://example.com');

    const denied = await request(
      '/api/ai/health',
      { headers: { Origin: 'https://evil.example' } },
      { ...env, ALLOWED_ORIGINS: 'https://example.com' },
    );
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('keeps the SSE connection alive while the provider is silent', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const model = {
      provider: 'glm',
      providerLabel: 'GLM',
      model: 'test',
      async complete() {
        await gate;
        return {
          text: JSON.stringify({
            questions: [
              {
                type: 'boolean',
                prompt: 'This is a test.',
                answer: { kind: 'boolean', value: true },
                estimatedSeconds: 10,
              },
            ],
          }),
          finishReason: 'stop',
        };
      },
    };
    const silent = createApp({ createChat: () => model, keepAliveMs: 10 });
    const response = await silent.fetch(
      new Request('https://app.test/api/ai/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ topic: 'Tests', count: 1, types: ['boolean'], model: 'glm-4.7-flash' }),
      }),
      { ...env, AI_MOCK: '', GLM_API_KEY: 'test', IMAGE_PROVIDER: 'none' },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 2_000;
    while (!text.includes(': keep-alive') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain(': keep-alive');
    release();
    // Drain so the generation task finishes instead of writing into a closed
    // stream (which would log a spurious service error).
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
    }
  });
});

describe('diagram pipeline', () => {
  const spec = {
    v: 1,
    coords: 'cartesian',
    x: { min: -2, max: 2 },
    y: { min: -1, max: 4 },
    elements: [{ kind: 'plot', expr: 'x^2' }],
  };
  const model = {
    provider: 'glm',
    providerLabel: 'GLM',
    model: 'test',
    async complete() {
      return {
        text: JSON.stringify({
          questions: [
            {
              type: 'single',
              prompt: 'Which curve is shown?',
              options: [
                { id: 'a', text: 'A line' },
                { id: 'b', text: 'A parabola' },
              ],
              answer: { kind: 'single', optionId: 'b' },
              explanation: 'The graph is y = x^2.',
              estimatedSeconds: 30,
              visual: { kind: 'diagram', spec, alt: '拋物線' },
            },
          ],
        }),
        finishReason: 'stop',
      };
    },
  };
  const appWithModel = createApp({ createChat: () => model });
  const modelEnv: Env = { ...env, AI_MOCK: '', GLM_API_KEY: 'test', IMAGE_PROVIDER: 'none' };

  it('attaches a figure without calling an image model', async () => {
    const response = await appWithModel.fetch(
      new Request('https://app.test/api/ai/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Parabolas',
          count: 1,
          types: ['single'],
          imageMode: 'auto',
          model: 'glm-4.7-flash',
        }),
      }),
      modelEnv,
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as AiQuestionResult;
    expect(result.images.diagrams).toBe(1);
    expect(result.images.requested).toBe(0);
    const media = result.deck.questions[0]?.media?.[0];
    expect(media?.type).toBe('figure');
    if (media?.type === 'figure') expect(media.figure.elements).toHaveLength(1);
    expect(media?.alt).toBe('拋物線');
  });
});

describe('scene image pipeline', () => {
  const model = {
    provider: 'glm',
    providerLabel: 'GLM',
    model: 'test',
    async complete() {
      return {
        text: JSON.stringify({
          questions: [
            {
              type: 'single',
              prompt: 'Guess the country shown in this photo.',
              options: [
                { id: 'a', text: 'France' },
                { id: 'b', text: 'Spain' },
              ],
              answer: { kind: 'single', optionId: 'a' },
              explanation: 'The landmark is in France.',
              estimatedSeconds: 30,
              visual: {
                kind: 'photo',
                prompt: 'A landmark beside a river.',
                search: 'Eiffel Tower Paris',
                alt: 'A landmark',
              },
            },
          ],
        }),
        finishReason: 'stop',
      };
    },
  };
  const searcher = {
    provider: 'test',
    async search() {
      return {
        image: 'data:image/jpeg;base64,AAAA',
        title: 'Eiffel Tower',
        credit: 'Jane Doe · Wikimedia Commons · CC BY-SA 4.0',
        sourceUrl: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower.jpg',
        license: 'CC BY-SA 4.0',
      };
    },
  };
  const appWithScene = createApp({
    createChat: () => model,
    createImageSearch: () => searcher,
  });
  const sceneEnv: Env = {
    ...env,
    AI_MOCK: '',
    GLM_API_KEY: 'test',
    IMAGE_PROVIDER: 'none',
    IMAGE_SEARCH: 'wikimedia',
  };

  it('serves a real scene photo through web search when text-to-image is off', async () => {
    const response = await appWithScene.fetch(
      new Request('https://app.test/api/ai/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Countries',
          count: 1,
          types: ['single'],
          imageMode: 'auto',
          model: 'glm-4.7-flash',
        }),
      }),
      sceneEnv,
    );
    expect(response.status).toBe(200);
    const result = (await response.json()) as AiQuestionResult;
    expect(result.images).toMatchObject({ requested: 1, generated: 1, searched: 1, diagrams: 0 });
    const media = result.deck.questions[0]?.media?.[0];
    expect(media?.type).toBe('image');
    if (media?.type === 'image') {
      expect(media.credit).toContain('Wikimedia Commons');
      expect(media.sourceUrl).toContain('commons.wikimedia.org');
    }
  });
});

