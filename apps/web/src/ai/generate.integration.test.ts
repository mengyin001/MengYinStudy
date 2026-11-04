import { beforeEach, describe, expect, it, vi } from 'vitest';
import { examMinutesForQuestions } from '@mengyin/core';
import type { AiMaterial, GenerationRequest } from './types';

const { chatMock } = vi.hoisted(() => ({ chatMock: vi.fn() }));

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return {
    ...actual,
    chatComplete: (...args: unknown[]) => chatMock(...args),
  };
});

const { generateQuestions } = await import('./generate');
const { AiError } = await import('./client');
const { DEFAULT_AI_CONFIG } = await import('./config');

const material: AiMaterial = {
  id: 'm1',
  name: 'week3.txt',
  size: 1200,
  kind: 'text',
  chars: 1200,
  truncated: false,
  addedAt: 1,
  text: 'A stack is last in, first out. A queue is first in, first out. Arrays support reduce. '.repeat(12),
};

const request: GenerationRequest = {
  topic: 'Stacks',
  count: 3,
  difficulty: 'mixed',
  language: 'en',
  types: ['single', 'boolean', 'code'],
};

const single = {
  type: 'single',
  prompt: 'Which structure is last in, first out?',
  options: [
    { id: 'a', text: 'Queue' },
    { id: 'b', text: 'Stack' },
  ],
  answer: { kind: 'single', optionId: 'b' },
  explanation: 'A stack pushes and pops at the same end.',
  tags: ['Stacks'],
  difficulty: 2,
  estimatedSeconds: 70,
};

const boolean = {
  type: 'boolean',
  prompt: 'A queue is first in, first out.',
  answer: { kind: 'boolean', value: true },
  tags: ['Queues'],
  difficulty: 1,
};

const code = {
  type: 'code',
  prompt: 'Fill in the expression that sums input.',
  answer: { kind: 'custom', value: {} },
  explanation: 'reduce folds the array from 0.',
  tags: ['Arrays'],
  difficulty: 2,
  meta: {
    code: {
      language: 'javascript',
      template: 'const total = {{blank}};\nconsole.log(total);',
      solution: 'input.reduce((sum, n) => sum + n, 0)',
      tests: [{ name: 'sample', input: [1, 2], expect: '3' }],
    },
  },
};

function reply(questions: unknown[], warnings: string[] = []) {
  return {
    text: JSON.stringify({ questions, warnings }),
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    finishReason: 'stop',
  };
}

beforeEach(() => {
  chatMock.mockReset();
});

describe('generateQuestions', () => {
  it('validates a mixed batch into a deck and sums usage', async () => {
    chatMock.mockResolvedValue(reply([single, boolean, code]));
    const result = await generateQuestions(DEFAULT_AI_CONFIG, request, [material]);

    expect(chatMock).toHaveBeenCalledTimes(1);
    const [config, messages] = chatMock.mock.calls[0] ?? [];
    expect(config).toBe(DEFAULT_AI_CONFIG);
    expect(messages[0].content).toContain('Non-negotiable rules');

    expect(result.deck.title).toBe('Stacks');
    expect(result.deck.pluginId).toMatch(/^ai\.stacks-/);
    expect(result.deck.key).toBe(`${result.deck.pluginId}::${result.deck.id}`);
    expect(result.deck.questions.map((question) => question.type)).toEqual(['single', 'boolean', 'code']);
    expect(result.deck.questions.map((question) => question.id)).toEqual(['q1', 'q2', 'q3']);
    expect(result.deck.questions[2]?.meta).toBeDefined();
    expect(result.deck.questions[0]?.meta?.estimatedSeconds).toBe(70);
    expect(result.deck.examMinutes).toBe(examMinutesForQuestions(result.deck.questions));
    // 70 + 30 + the code question's 345-second type estimate = 8 minutes.
    expect(result.deck.examMinutes).toBe(8);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    expect(result.warnings).toEqual([]);
  });

  it('drops invalid questions and keeps the valid ones', async () => {
    chatMock.mockResolvedValue(
      reply([
        single,
        { type: 'single', prompt: 'Broken', options: [{ id: 'a', text: 'A' }], answer: { kind: 'single', optionId: 'z' } },
        boolean,
      ]),
    );
    const result = await generateQuestions(DEFAULT_AI_CONFIG, { ...request, count: 2 }, [material]);
    expect(result.deck.questions).toHaveLength(2);
    expect(result.deck.questions.map((question) => question.type)).toEqual(['single', 'boolean']);
    expect(result.warnings.some((warning) => warning.code === 'invalid')).toBe(true);
  });

  it('does not keep questions of types the learner turned off', async () => {
    chatMock.mockResolvedValue(reply([single, code]));
    const result = await generateQuestions(
      DEFAULT_AI_CONFIG,
      { ...request, count: 1, types: ['single', 'boolean'] },
      [material],
    );
    expect(result.deck.questions.map((question) => question.type)).toEqual(['single']);
    expect(result.warnings.some((warning) => warning.code === 'types')).toBe(true);
  });

  it('splits more than six requested questions into separate calls', async () => {
    chatMock
      .mockResolvedValueOnce(reply([single]))
      .mockResolvedValueOnce(
        reply([
          {
            ...single,
            prompt: 'Where does a stack add a new element?',
            options: [
              { id: 'a', text: 'At the top' },
              { id: 'b', text: 'At the bottom' },
            ],
            answer: { kind: 'single', optionId: 'a' },
          },
        ]),
      );
    const result = await generateQuestions(
      DEFAULT_AI_CONFIG,
      { ...request, count: 10, types: ['single'] },
      [material],
    );

    expect(chatMock).toHaveBeenCalledTimes(2);
    const prompts = chatMock.mock.calls.map(([, messages]) => messages[1].content as string);
    expect(prompts[0]).toContain('Write exactly 5 questions');
    expect(prompts[1]).toContain('Write exactly 5 questions');
    expect(result.deck.questions).toHaveLength(2);
  });

  it('uses topic-brief mode when only a description is supplied', async () => {
    chatMock.mockResolvedValue(reply([single]));
    const result = await generateQuestions(
      DEFAULT_AI_CONFIG,
      { ...request, count: 1, types: ['single'], description: 'C++ coding' },
      [],
    );

    expect(chatMock).toHaveBeenCalledTimes(1);
    const user = chatMock.mock.calls[0]?.[1][1].content as string;
    expect(user).toContain('Source mode: topic brief');
    expect(user).toContain('well-established general knowledge');
    expect(user).toContain('<brief name="Learner description"');
    expect(result.deck.title).toBe('Stacks');
  });

  it('treats a short text file as a topic brief, not a source document', async () => {
    chatMock.mockResolvedValue(reply([single]));
    const shortMaterial: AiMaterial = {
      ...material,
      id: 'm-short',
      name: '1.txt',
      size: 10,
      chars: 10,
      text: 'C++ coding',
    };
    await generateQuestions(
      DEFAULT_AI_CONFIG,
      { ...request, count: 2, types: ['single'] },
      [shortMaterial],
    );

    const user = chatMock.mock.calls[0]?.[1][1].content as string;
    expect(user).toContain('Source mode: topic brief');
    expect(user).toContain('<brief name="1.txt"');
    expect(user).not.toContain('<material name=');
  });

  it('keeps only the requested type when exactly one is selected', async () => {
    chatMock.mockResolvedValue(reply([single, boolean]));
    const result = await generateQuestions(
      DEFAULT_AI_CONFIG,
      { ...request, count: 1, types: ['boolean'] },
      [material],
    );
    expect(result.deck.questions.map((question) => question.type)).toEqual(['boolean']);
  });

  it('asks once more when the first reply is not JSON', async () => {
    chatMock
      .mockResolvedValueOnce({ text: 'I cannot do that' })
      .mockResolvedValueOnce(reply([single]));
    const result = await generateQuestions(DEFAULT_AI_CONFIG, { ...request, count: 1 }, [material]);
    expect(chatMock).toHaveBeenCalledTimes(2);
    expect(result.deck.questions).toHaveLength(1);
  });

  it('splits a batch when the model hits its output limit', async () => {
    chatMock
      .mockResolvedValueOnce({ text: '{"questions":[{"type":"single","prompt":"cut', finishReason: 'length' })
      .mockResolvedValueOnce(reply([single]))
      .mockResolvedValueOnce(reply([boolean]));

    const result = await generateQuestions(DEFAULT_AI_CONFIG, { ...request, count: 2 }, [material]);

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(result.deck.questions).toHaveLength(2);
    const prompts = chatMock.mock.calls.map(([, messages]) => messages[1].content as string);
    expect(prompts[0]).toContain('Write exactly 2 questions');
    expect(prompts[1]).toContain('Write exactly 1 question');
    expect(prompts[2]).toContain('Write exactly 1 question');
  });

  it('explains the token limit when even one question is cut off', async () => {
    chatMock.mockResolvedValue({
      text: '{"questions":[',
      finishReason: 'length',
    });

    await expect(
      generateQuestions(DEFAULT_AI_CONFIG, { ...request, count: 1 }, [material]),
    ).rejects.toMatchObject({
      code: 'truncated',
      message: expect.stringContaining('Max reply tokens'),
    });
    expect(chatMock).toHaveBeenCalledTimes(1);
  });

  it('reports a shortfall when the model returns too few questions', async () => {
    chatMock.mockResolvedValue(reply([single]));
    const result = await generateQuestions(DEFAULT_AI_CONFIG, { ...request, count: 3 }, [material]);
    expect(result.deck.questions).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.code === 'shortfall')).toBe(true);
  });

  it('throws when every question fails validation', async () => {
    chatMock.mockResolvedValue(reply([{ type: 'single', prompt: 'Broken', answer: { kind: 'single', optionId: 'x' } }]));
    await expect(generateQuestions(DEFAULT_AI_CONFIG, request, [material])).rejects.toBeInstanceOf(AiError);
  });

  it('refuses to run without material', async () => {
    await expect(generateQuestions(DEFAULT_AI_CONFIG, request, [])).rejects.toMatchObject({
      code: 'empty',
    });
    expect(chatMock).not.toHaveBeenCalled();
  });
});
