import { describe, expect, it } from 'vitest';
import type { Question } from '@mengyin/core';
import type { ResolvedProvider } from '../providers/registry';
import { verifyIllustration, visionModelFor } from './verify';

const provider: ResolvedProvider = {
  id: 'deepseek',
  label: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'test-key',
  model: 'deepseek-flash',
  models: ['deepseek-flash'],
  temperature: 0.4,
  maxTokens: 1024,
  timeoutMs: 30_000,
  jsonMode: true,
  demo: false,
};

const question: Question = {
  id: 'q1',
  type: 'single',
  prompt: 'Which book is closed?',
  options: [
    { id: 'a', text: 'The left book' },
    { id: 'b', text: 'The right book' },
  ],
  answer: { kind: 'single', optionId: 'b' },
  tags: ['reading'],
  difficulty: 2,
};

const image = 'data:image/png;base64,AAAA';

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('visionModelFor', () => {
  it('reads the provider-specific model and honours the off switch', () => {
    expect(visionModelFor({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, 'deepseek')).toBe('deepseek-vl');
    expect(visionModelFor({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, 'glm')).toBeNull();
    expect(
      visionModelFor({ DEEPSEEK_VISION_MODEL: 'deepseek-vl', AI_VERIFY_IMAGES: 'off' }, 'deepseek'),
    ).toBeNull();
  });
});

describe('verifyIllustration', () => {
  it('skips the call when no vision model is configured', async () => {
    let called = false;
    const result = await verifyIllustration({}, provider, question, image, async () => {
      called = true;
      return reply({});
    });
    expect(result).toEqual({ checked: false, ok: true });
    expect(called).toBe(false);
  });

  it('reports a mismatch with the model reason', async () => {
    const result = await verifyIllustration({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, provider, question, image, async () =>
      reply({
        choices: [{ message: { content: '{"matches":false,"reason":"shows an open book"}' } }],
      }),
    );
    expect(result).toEqual({ checked: true, ok: false, reason: 'shows an open book' });
  });

  it('accepts a matching image', async () => {
    const result = await verifyIllustration({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, provider, question, image, async () => {
      const body = JSON.stringify({
        choices: [{ message: { content: '{"matches": true}' } }],
      });
      return new Response(body, { status: 200 });
    });
    expect(result).toEqual({ checked: true, ok: true });
  });

  it('uses a clue-aware prompt when the picture is the thing to identify', async () => {
    let body = '';
    const result = await verifyIllustration(
      { DEEPSEEK_VISION_MODEL: 'deepseek-vl' },
      provider,
      question,
      image,
      async (_input, init) => {
        body = String(init?.body ?? '');
        return reply({ choices: [{ message: { content: '{"matches":true}' } }] });
      },
      { clue: true },
    );
    expect(result).toEqual({ checked: true, ok: true });
    expect(body).toContain('picture is the clue');
  });

  it('never throws when the provider fails', async () => {
    const result = await verifyIllustration({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, provider, question, image, async () => {
      throw new Error('network down');
    });
    expect(result).toEqual({ checked: false, ok: true });
    await expect(
      verifyIllustration({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, provider, question, image, async () =>
        reply({ error: 'busy' }, 429),
      ),
    ).resolves.toEqual({ checked: false, ok: true });
  });

  it('treats an unreadable reply as not checked', async () => {
    const result = await verifyIllustration({ DEEPSEEK_VISION_MODEL: 'deepseek-vl' }, provider, question, image, async () =>
      reply({ choices: [{ message: { content: 'looks fine to me' } }] }),
    );
    expect(result).toEqual({ checked: false, ok: true });
  });
});
