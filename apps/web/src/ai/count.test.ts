import { describe, expect, it } from 'vitest';
import { questionCountCeiling } from './count';

const base = {
  hydrated: true,
  enforced: true,
  paid: false,
  byo: false,
  remaining: 20,
  monthly: 200,
};

describe('question count ceiling', () => {
  it('uses the questions left on the free plan', () => {
    expect(questionCountCeiling(base)).toBe(20);
    expect(questionCountCeiling({ ...base, remaining: 7 })).toBe(7);
  });

  it('keeps at least one question when the free allowance is spent', () => {
    expect(questionCountCeiling({ ...base, remaining: 0 })).toBe(1);
  });

  it('falls back to the monthly allowance when the remaining count is unknown', () => {
    expect(questionCountCeiling({ ...base, remaining: null })).toBe(200);
    expect(questionCountCeiling({ ...base, remaining: undefined, monthly: 50 })).toBe(50);
  });

  it('has no ceiling on a paid plan', () => {
    expect(questionCountCeiling({ ...base, paid: true })).toBeUndefined();
  });

  it('has no ceiling when the learner brings their own key', () => {
    // The bug this guards: a free account with zero server questions left used
    // to clamp its own-key run to one question.
    expect(questionCountCeiling({ ...base, byo: true, remaining: 0 })).toBeUndefined();
    expect(questionCountCeiling({ ...base, byo: true, paid: false })).toBeUndefined();
  });

  it('has no ceiling when billing is not enforced', () => {
    expect(questionCountCeiling({ ...base, enforced: false })).toBeUndefined();
  });

  it('waits for hydration before applying the free-plan ceiling', () => {
    // Settings (including the saved own key) arrive after the first render.
    // Clamping before then is what made a saved own key still look capped.
    expect(questionCountCeiling({ ...base, hydrated: false, remaining: 0 })).toBeUndefined();
  });
});
