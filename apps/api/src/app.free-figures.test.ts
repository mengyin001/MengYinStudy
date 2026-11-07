import { describe, expect, it, vi } from 'vitest';
import { planFor } from '@mengyin/core';
import type { AiQuestionResult } from '@mengyin/ai-contract';

vi.mock('./billing/policy', () => ({
  resolveGenerationPolicy: vi.fn(async () => ({
    enforced: true,
    plan: planFor('free'),
    snapshot: null,
    imageMode: 'auto',
    imagesBlocked: true,
    photosAllowed: false,
    estimate: { questions: 0, materials: 0, images: 0, total: 0, perQuestion: 0 },
    requestId: 'req-free-figures',
    reserved: 0,
    reservedQuestions: 1,
    questionLimit: 200,
  })),
  settleGeneration: vi.fn(async () => undefined),
  cancelGeneration: vi.fn(async () => undefined),
  chargeStandaloneImage: vi.fn(),
  chargeDeckImages: vi.fn(async () => 0),
  refundStandaloneImage: vi.fn(),
}));

import { createApp } from './app';
import type { Env } from './env';
import type { ChatModel } from './providers/chat';

const diagramSpec = {
  v: 1,
  coords: 'cartesian',
  x: { min: -2, max: 2 },
  y: { min: -2, max: 4 },
  elements: [
    { kind: 'plot', expr: 'x^2' },
    { kind: 'point', x: 0, y: 0, label: 'O' },
  ],
};

const model: ChatModel = {
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
            options: [{ text: 'A parabola' }, { text: 'A straight line' }],
            answer: { kind: 'single', optionId: 'a' },
            explanation: 'The plotted curve is a parabola.',
            estimatedSeconds: 20,
            visual: { kind: 'diagram', spec: diagramSpec, alt: '拋物線' },
          },
        ],
      }),
      finishReason: 'stop',
    };
  },
};

const env: Env = { AI_MOCK: '1', AUTH_REQUIRED: 'true' };
const app = createApp({
  authenticate: async () => ({ userId: 'user-1', token: 'token-1' }),
  createChat: () => model,
  createImages: () => null,
  createImageSearch: () => null,
});

describe('free plan visuals', () => {
  it('still attaches a rendered figure while AI photos are blocked', async () => {
    const response = await app.fetch(
      new Request('https://app.test/api/ai/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Curves',
          count: 1,
          types: ['single'],
          imageMode: 'auto',
          model: 'demo',
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    const result = (await response.json()) as AiQuestionResult;
    expect(result.images).toMatchObject({ requested: 0, generated: 0, diagrams: 1 });
    expect(result.deck.questions[0]?.media?.[0]?.type).toBe('figure');
    expect(result.warnings.some((warning) => warning.code === 'plan')).toBe(true);
  });
});
