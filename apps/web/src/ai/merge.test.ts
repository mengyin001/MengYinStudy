import { describe, expect, it } from 'vitest';
import type { AiQuestionResult } from '@mengyin/ai-contract';
import type { Question } from '@mengyin/core';
import { mergeGeneratedResults } from './merge';

function question(id: string, prompt: string): Question {
  return {
    id,
    type: 'single',
    prompt,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: { kind: 'single', optionId: 'a' },
    tags: ['t'],
    difficulty: 2,
  };
}

function result(prompts: string[], tags: string[]): AiQuestionResult {
  const questions = prompts.map((prompt, index) => question(`q${index + 1}`, prompt));
  return {
    deck: {
      key: 'plugin::deck',
      id: 'deck',
      pluginId: 'plugin',
      title: 'Draft',
      description: 'Generated',
      tags,
      questions,
      examMinutes: 5,
    },
    warnings: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    engine: { provider: 'glm', providerLabel: 'GLM', model: 'test' },
    images: { requested: 1, generated: 1, failed: 0, diagrams: 1 },
  };
}

describe('mergeGeneratedResults', () => {
  it('appends fresh questions, renumbers ids and sums usage and images', () => {
    const merged = mergeGeneratedResults(
      result(['What is a stack?', 'What is LIFO?'], ['a']),
      result(['What is LIFO?', 'What is a queue?'], ['b']),
    );
    expect(merged.deck.questions.map((item) => item.prompt)).toEqual([
      'What is a stack?',
      'What is LIFO?',
      'What is a queue?',
    ]);
    expect(merged.deck.questions.map((item) => item.id)).toEqual(['q1', 'q2', 'q3']);
    expect(merged.deck.tags).toEqual(['a', 'b']);
    expect(merged.usage).toEqual({ promptTokens: 20, completionTokens: 10, totalTokens: 30 });
    expect(merged.images).toEqual({ requested: 2, generated: 2, failed: 0, diagrams: 2 });
    expect(merged.warnings).toEqual([
      expect.objectContaining({ code: 'duplicates' }),
    ]);
  });

  it('keeps the current draft identity and engine of the newest run', () => {
    const merged = mergeGeneratedResults(result(['One?'], ['a']), result(['Two?'], ['b']));
    expect(merged.deck.key).toBe('plugin::deck');
    expect(merged.deck.title).toBe('Draft');
    expect(merged.engine.model).toBe('test');
    expect(merged.warnings).toEqual([]);
  });
});
