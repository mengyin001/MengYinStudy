import { describe, expect, it } from 'vitest';
import { DAY_MS, isDue, newCard, qualityFromStatus, reviewCard } from './srs';

const NOW = 1_700_000_000_000;

describe('reviewCard', () => {
  it('schedules the first correct answer one day out', () => {
    const card = reviewCard(undefined, 5, NOW);
    expect(card.reps).toBe(1);
    expect(card.intervalDays).toBe(1);
    expect(card.dueAt).toBe(NOW + DAY_MS);
    expect(isDue(card, NOW)).toBe(false);
  });

  it('grows intervals on consecutive successes', () => {
    let card = reviewCard(undefined, 5, NOW);
    card = reviewCard(card, 5, NOW + DAY_MS);
    expect(card.intervalDays).toBe(3);
    card = reviewCard(card, 5, NOW + 4 * DAY_MS);
    expect(card.intervalDays).toBe(Math.round(3 * card.ease));
  });

  it('returns missed cards after a short learning step', () => {
    let card = reviewCard(undefined, 5, NOW);
    card = reviewCard(card, 1, NOW + DAY_MS);
    expect(card.lapses).toBe(1);
    expect(card.reps).toBe(0);
    expect(card.intervalDays).toBeLessThan(1);
    expect(card.dueAt - (NOW + DAY_MS)).toBe(10 * 60_000);
  });

  it('clamps the ease factor', () => {
    let card = newCard(NOW);
    for (let i = 0; i < 10; i += 1) card = reviewCard(card, 1, NOW);
    expect(card.ease).toBeGreaterThanOrEqual(1.3);
    for (let i = 0; i < 20; i += 1) card = reviewCard(card, 5, NOW);
    expect(card.ease).toBeLessThanOrEqual(2.8);
  });

  it('maps graded statuses to quality', () => {
    expect(qualityFromStatus('correct')).toBe(5);
    expect(qualityFromStatus('correct', 120_000)).toBe(4);
    expect(qualityFromStatus('partial')).toBe(3);
    expect(qualityFromStatus('incorrect')).toBe(1);
  });
});
