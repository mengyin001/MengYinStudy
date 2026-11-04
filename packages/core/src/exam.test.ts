import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTION_SECONDS,
  MIN_QUESTION_SECONDS,
  examMinutesForDeck,
  examMinutesForEntries,
  examMinutesForQuestions,
  estimateQuestionSeconds,
} from './exam';
import type { Deck, Question, QuestionEntry } from './types';

function question(
  id: string,
  type: Question['type'],
  difficulty = 1,
  estimatedSeconds?: number,
): Question {
  return {
    id,
    type,
    prompt: `Question ${id}`,
    answer: { kind: 'boolean', value: true },
    tags: [],
    difficulty,
    ...(estimatedSeconds === undefined ? {} : { meta: { estimatedSeconds } }),
  };
}

function deck(questions: Question[], examMinutes?: number): Deck {
  return {
    key: 'test::deck',
    id: 'deck',
    pluginId: 'test',
    title: 'Test',
    tags: [],
    questions,
    ...(examMinutes === undefined ? {} : { examMinutes }),
  };
}

function entry(source: Deck, index: number): QuestionEntry {
  const item = source.questions[index];
  if (!item) throw new Error('missing question');
  return { deck: source, question: item, key: `${source.key}#${item.id}` };
}

describe('exam length estimation', () => {
  it('estimates from question type instead of a fixed per-paper default', () => {
    const five = [
      question('q1', 'single'),
      question('q2', 'multi'),
      question('q3', 'boolean'),
      question('q4', 'fill'),
      question('q5', 'short'),
    ];
    // 60 + 90 + 30 + 45 + 150 = 375 seconds, rounded up to 7 minutes.
    expect(examMinutesForQuestions(five)).toBe(7);
    expect(examMinutesForQuestions(five.slice(0, 2))).toBe(3);
    expect(examMinutesForQuestions([])).toBe(1);
  });

  it('weights longer or harder questions', () => {
    const easy = question('easy', 'single', 1);
    const hard = question('hard', 'single', 5);
    expect(estimateQuestionSeconds(hard)).toBeGreaterThan(estimateQuestionSeconds(easy));
  });

  it('falls back safely for plugin type ids that collide with object keys', () => {
    expect(estimateQuestionSeconds(question('custom', 'custom-type'))).toBe(90);
    expect(estimateQuestionSeconds(question('proto', '__proto__'))).toBe(90);
    expect(Number.isFinite(examMinutesForQuestions([question('c', 'constructor')]))).toBe(true);
  });

  it('uses a model-supplied per-question estimate first', () => {
    const timed = question('timed', 'single', 5, 42);
    expect(estimateQuestionSeconds(timed)).toBe(42);
  });

  it('clamps model estimates so a bad number cannot break the timer', () => {
    expect(estimateQuestionSeconds(question('tiny', 'single', 1, 1))).toBe(MIN_QUESTION_SECONDS);
    expect(estimateQuestionSeconds(question('huge', 'single', 1, 90_000))).toBe(MAX_QUESTION_SECONDS);
  });

  it('prefers the length a deck declares', () => {
    const declared = deck([question('q1', 'single')], 12);
    expect(examMinutesForDeck(declared)).toBe(12);
    expect(examMinutesForDeck(deck([question('q1', 'single')], 0))).toBe(1);
  });

  it('scales a limited exam to a proportional slice of the paper', () => {
    const questions = Array.from({ length: 10 }, (_, index) => question(`q${index}`, 'single'));
    const paper = deck(questions, 30);
    const entries = questions.map((_, index) => entry(paper, index));
    expect(examMinutesForEntries(entries)).toBe(30);
    expect(examMinutesForEntries(entries, 4)).toBe(12);
    expect(examMinutesForEntries(entries.slice(0, 5))).toBe(15);
  });

  it('estimates across decks when a session mixes them', () => {
    const first = deck([question('a', 'single')]);
    const second: Deck = {
      ...deck([question('b', 'single')]),
      key: 'test::other',
      id: 'other',
    };
    expect(examMinutesForEntries([entry(first, 0), entry(second, 0)])).toBe(2);
  });
});
