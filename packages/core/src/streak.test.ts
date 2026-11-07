import { describe, expect, it } from 'vitest';
import { STREAK_TIERS, STREAK_UNLOCK_DAYS, streakStatus, streakTierFor } from './streak';

describe('streakStatus', () => {
  it('is dark before three consecutive days', () => {
    for (const days of [0, 1, 2]) {
      const status = streakStatus(days);
      expect(status.lit).toBe(false);
      expect(status.tier).toBeNull();
      expect(status.daysToLight).toBe(STREAK_UNLOCK_DAYS - days);
    }
  });

  it('lights on the third day', () => {
    const status = streakStatus(3);
    expect(status.lit).toBe(true);
    expect(status.tier?.id).toBe('spark');
    expect(status.tier?.color).toBe('#f59e0b');
  });

  it('changes colour every three days', () => {
    expect(streakTierFor(5)?.id).toBe('spark');
    expect(streakTierFor(6)?.id).toBe('ember');
    expect(streakTierFor(8)?.id).toBe('ember');
    expect(streakTierFor(9)?.id).toBe('coral');
    expect(streakTierFor(29)?.id).toBe('jade');
    expect(streakTierFor(30)?.id).toBe('aurora');
  });

  it('stops at the thirty-day maximum', () => {
    const status = streakStatus(45);
    expect(status.current).toBe(30);
    expect(status.tier?.id).toBe('aurora');
    expect(status.next).toBeNull();
    expect(status.daysToNext).toBe(0);
    expect(status.progress).toBe(1);
    expect(STREAK_TIERS).toHaveLength(10);
  });

  it('reports the next colour and progress inside the band', () => {
    const status = streakStatus(7);
    expect(status.next?.id).toBe('coral');
    expect(status.daysToNext).toBe(2);
    expect(status.bandProgress).toBeCloseTo(1 / 3);
  });

  it('ignores invalid input', () => {
    expect(streakStatus(Number.NaN).current).toBe(0);
    expect(streakStatus(-4).current).toBe(0);
    expect(streakStatus(4.9).current).toBe(4);
  });
});
