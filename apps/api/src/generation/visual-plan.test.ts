import { describe, expect, it } from 'vitest';
import type { Question } from '@mengyin/core';
import type { ChatModel } from '../providers/chat';
import { AiError } from '../providers/chat';
import {
  VISUALS_PER_CALL,
  buildPlanMessages,
  parseVisualPlanReply,
  planVisuals,
  type VisualContext,
  type VisualRequest,
} from './visual-plan';

function question(id: string, prompt: string): Question {
  return {
    id,
    type: 'single',
    prompt,
    options: [
      { id: 'a', text: 'A plant in the dark' },
      { id: 'b', text: 'A plant in sunlight' },
    ],
    answer: { kind: 'single', optionId: 'b' },
    explanation: 'Only the lit plant can photosynthesise.',
    tags: ['biology'],
    difficulty: 2,
  };
}

const spec = {
  v: 1,
  coords: 'plain',
  elements: [
    { kind: 'label', x: 20, y: 20, text: 'Dark' },
    { kind: 'line', x1: 20, y1: 30, x2: 80, y2: 30, arrow: true },
  ],
};

const context: VisualContext = {
  topic: 'Photosynthesis',
  language: 'en',
  mode: 'on',
  photosAvailable: true,
  webImagesAvailable: false,
};

function modelOf(complete: ChatModel['complete'], provider = 'glm'): ChatModel {
  return { provider, providerLabel: 'GLM', model: 'test', complete };
}

describe('plan prompt', () => {
  it('shows the finished question, its answer and the requested kind', () => {
    const messages = buildPlanMessages(
      [{ question: question('q1', 'Which plant makes food at night?'), want: 'choose' }],
      context,
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Visual spec (diagram)');
    const user = messages.find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('Which plant makes food at night?');
    expect(user).toContain('"answer":"b"');
    expect(user).toContain('"want":"choose"');
    expect(user).toContain('Question language: English');
  });

  it('marks a photo rewrite and carries the author hint', () => {
    const user =
      buildPlanMessages(
        [{ question: question('q1', 'Which plant?'), want: 'photo', hint: 'A generic plant.' }],
        { ...context, mode: 'auto' },
      ).find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('"want":"photo"');
    expect(user).toContain('A generic plant.');
  });

  it('forbids photos when the server has no image provider', () => {
    const user =
      buildPlanMessages([{ question: question('q1', 'x'), want: 'choose' }], {
        ...context,
        photosAvailable: false,
      }).find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('every visual you return must be a diagram');
  });
});

describe('parseVisualPlanReply', () => {
  const ids = new Set(['q1', 'q2']);

  it('reads a diagram and a photo from one reply', () => {
    const plans = parseVisualPlanReply(
      JSON.stringify({
        images: [
          { id: 'q1', kind: 'diagram', spec, alt: '兩盆植物' },
          { id: 'q2', kind: 'photo', prompt: 'Two pots, the left one dark.' },
        ],
      }),
      ids,
    );
    expect(plans.get('q1')?.kind).toBe('diagram');
    expect(plans.get('q2')?.kind).toBe('photo');
    const first = plans.get('q1');
    expect(first && first.kind !== 'none' ? first.alt : undefined).toBe('兩盆植物');
  });

  it('keeps an explicit skip distinct from an invalid entry', () => {
    const plans = parseVisualPlanReply(
      JSON.stringify({
        images: [
          { id: 'q1', skip: true },
          { id: 'q2', kind: 'diagram', spec: { v: 1, elements: [] } },
        ],
      }),
      ids,
    );
    expect(plans.get('q1')).toBeNull();
    expect(plans.has('q2')).toBe(false);
  });

  it('accepts an id map, a bare array and fenced JSON', () => {
    expect(
      parseVisualPlanReply(JSON.stringify({ images: { q1: { kind: 'photo', prompt: 'A leaf.' } } }), ids).get('q1')
        ?.kind,
    ).toBe('photo');
    expect(parseVisualPlanReply(JSON.stringify([{ id: 'q2', kind: 'photo', prompt: 'A sun.' }]), ids).get('q2')?.kind).toBe(
      'photo',
    );
    const fenced = ['```json', JSON.stringify({ images: [{ id: 'q9', prompt: 'nope' }] }), '```'].join('\n');
    expect(parseVisualPlanReply(fenced, ids).size).toBe(0);
  });
});

describe('planVisuals', () => {
  const requests: VisualRequest[] = Array.from({ length: VISUALS_PER_CALL * 2 + 1 }, (_, index) => ({
    question: question(`q${index + 1}`, `Question ${index + 1}`),
    want: 'choose' as const,
  }));

  it('batches the questions and merges the plans', async () => {
    let calls = 0;
    const model = modelOf(async (messages) => {
      calls += 1;
      const user = messages.find((message) => message.role === 'user')?.content ?? '';
      const ids = [...user.matchAll(/"id":"(q\d+)"/g)].map((match) => match[1]!);
      return {
        text: JSON.stringify({
          images: ids.map((id) => ({ id, kind: 'diagram', spec })),
        }),
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const plan = await planVisuals(model, requests, context);
    expect(calls).toBe(3);
    expect(plan.plans.size).toBe(requests.length);
    expect(plan.plans.get('q11')?.kind).toBe('diagram');
    expect(plan.usage.totalTokens).toBe(45);
    expect(plan.failures).toEqual([]);
  });

  it('reports a failed call instead of failing the deck', async () => {
    const model = modelOf(async () => {
      throw new AiError('rate', 'The provider is busy');
    });
    const plan = await planVisuals(model, requests, context);
    expect(plan.plans.size).toBe(0);
    expect(plan.failures).toHaveLength(3);
    expect(plan.failures[0]).toContain('The provider is busy');
  });

  it('keeps successful plans when a later call fails', async () => {
    let calls = 0;
    const model = modelOf(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: JSON.stringify({ images: [{ id: 'q1', kind: 'photo', prompt: 'first' }] }),
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      throw new AiError('server', 'The provider failed (500)');
    });
    const plan = await planVisuals(model, requests, context);
    expect(plan.plans.get('q1')?.kind).toBe('photo');
    expect(plan.failures).toHaveLength(2);
    expect(plan.usage.totalTokens).toBe(2);
  });

  it('propagates cancellation', async () => {
    const model = modelOf(async () => {
      throw new AiError('cancelled', 'Generation was cancelled');
    });
    await expect(planVisuals(model, requests, context)).rejects.toBeInstanceOf(AiError);
  });

  it('does no work without questions', async () => {
    const model = modelOf(async () => {
      throw new Error('should not be called');
    });
    const plan = await planVisuals(model, [], context);
    expect(plan.plans.size).toBe(0);
    expect(plan.usage.totalTokens).toBe(0);
  });
});
