import { describe, expect, it } from 'vitest';
import { scoreSoundBand, streakBurstKey } from './answerStreak';

describe('scoreSoundBand', () => {
  it('reserves applause for a perfect score', () => {
    expect(scoreSoundBand(100)).toBe('perfect');
    expect(scoreSoundBand(101)).toBe('perfect');
    expect(scoreSoundBand(99)).toBe('pass');
  });

  it('encourages from 60 upwards', () => {
    expect(scoreSoundBand(99)).toBe('pass');
    expect(scoreSoundBand(60)).toBe('pass');
    expect(scoreSoundBand(59)).toBe('retry');
  });

  it('uses the softer motif below 60, including zero', () => {
    expect(scoreSoundBand(59)).toBe('retry');
    expect(scoreSoundBand(0)).toBe('retry');
  });
});

describe('streakBurstKey', () => {
  it('uses the nearest earlier celebration tier', () => {
    expect(streakBurstKey(3)).toBe('streak.burst3');
    expect(streakBurstKey(7)).toBe('streak.burst5');
    expect(streakBurstKey(12)).toBe('streak.burst10');
    expect(streakBurstKey(20)).toBe('streak.burst20');
    expect(streakBurstKey(40)).toBe('streak.burst20');
  });
});
