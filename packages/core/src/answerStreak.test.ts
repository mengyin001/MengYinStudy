import { describe, expect, it } from 'vitest';
import { applyAnswerStreak, computeAnswerStreak, isAnswerStreakMilestone } from './answerStreak';
import type { Attempt, StudyMode } from './types';

function attempt(
  sessionId: string,
  status: Attempt['status'],
  mode: StudyMode = 'practice',
  overrides: Partial<Attempt> = {},
): Attempt {
  return {
    id: `${sessionId}-${status}-${overrides.at ?? 0}`,
    questionKey: 'deck::q',
    questionId: 'q',
    deckKey: 'deck',
    pluginId: 'demo',
    sessionId,
    mode,
    at: overrides.at ?? 0,
    msSpent: 100,
    status,
    ratio: status === 'correct' ? 1 : 0,
    skipped: false,
    ...overrides,
  };
}

describe('applyAnswerStreak', () => {
  it('counts correct answers and remembers the best run', () => {
    let state = applyAnswerStreak('practice', { current: 0, best: 0 }, 'correct');
    expect(state).toEqual({ current: 1, best: 1 });
    state = applyAnswerStreak('practice', state, 'correct');
    expect(state).toEqual({ current: 2, best: 2 });
  });

  it('breaks the run on a partial, wrong or pending answer', () => {
    const built = { current: 4, best: 6 };
    expect(applyAnswerStreak('practice', built, 'incorrect')).toEqual({ current: 0, best: 6 });
    expect(applyAnswerStreak('practice', built, 'partial')).toEqual({ current: 0, best: 6 });
    expect(applyAnswerStreak('practice', built, 'pending')).toEqual(built);
  });

  it('never counts exam answers', () => {
    const state = { current: 3, best: 5 };
    expect(applyAnswerStreak('exam', state, 'correct')).toBe(state);
  });
});

describe('isAnswerStreakMilestone', () => {
  it('celebrates 3, 5 and every fifth answer from ten', () => {
    expect(isAnswerStreakMilestone(2)).toBe(false);
    expect(isAnswerStreakMilestone(3)).toBe(true);
    expect(isAnswerStreakMilestone(4)).toBe(false);
    expect(isAnswerStreakMilestone(5)).toBe(true);
    expect(isAnswerStreakMilestone(9)).toBe(false);
    expect(isAnswerStreakMilestone(10)).toBe(true);
    expect(isAnswerStreakMilestone(15)).toBe(true);
    expect(isAnswerStreakMilestone(20)).toBe(true);
  });
});

describe('computeAnswerStreak', () => {
  it('finds the longest correct run in one session', () => {
    const attempts = [
      attempt('s1', 'correct', 'practice', { at: 1 }),
      attempt('s1', 'correct', 'practice', { at: 2 }),
      attempt('s1', 'incorrect', 'practice', { at: 3 }),
      attempt('s1', 'correct', 'practice', { at: 4 }),
      attempt('s2', 'correct', 'practice', { at: 5 }),
      attempt('s2', 'correct', 'review', { at: 6 }),
      attempt('s2', 'partial', 'review', { at: 7 }),
    ];
    expect(computeAnswerStreak(attempts)).toBe(2);
  });

  it('does not join the last answer of one session to the first of the next', () => {
    const attempts = [
      attempt('s1', 'correct', 'practice', { at: 1 }),
      attempt('s1', 'correct', 'practice', { at: 2 }),
      attempt('s2', 'correct', 'practice', { at: 3 }),
      attempt('s2', 'correct', 'practice', { at: 4 }),
      attempt('s3', 'correct', 'practice', { at: 5 }),
    ];
    expect(computeAnswerStreak(attempts)).toBe(2);
  });

  it('ignores exam attempts, including a batch of correct answers', () => {
    const attempts = [
      attempt('exam-1', 'correct', 'exam', { at: 1 }),
      attempt('exam-1', 'correct', 'exam', { at: 1 }),
      attempt('exam-1', 'correct', 'exam', { at: 1 }),
      attempt('s1', 'correct', 'practice', { at: 2 }),
      attempt('s1', 'incorrect', 'practice', { at: 3 }),
    ];
    expect(computeAnswerStreak(attempts)).toBe(1);
  });
});
