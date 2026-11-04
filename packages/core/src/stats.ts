import { dayKey, startOfDay } from './ids';
import type { Attempt, CardState } from './types';

export interface DayBucket {
  date: string;
  attempts: number;
  correct: number;
  ratio: number;
  ms: number;
}

export interface TagBucket {
  tag: string;
  attempts: number;
  correct: number;
  ratio: number;
}

export interface DeckBucket {
  attempts: number;
  correct: number;
  ratio: number;
  ms: number;
  lastAt: number;
}

export interface Stats {
  total: number;
  correct: number;
  ratio: number;
  ms: number;
  days: DayBucket[];
  decks: Record<string, DeckBucket>;
  byMode: Record<string, number>;
}

export function computeStats(attempts: readonly Attempt[], days = 14, now = Date.now()): Stats {
  const buckets = new Map<string, DayBucket>();
  const decks: Record<string, DeckBucket> = {};
  const byMode: Record<string, number> = {};
  let correct = 0;
  let ratio = 0;
  let ms = 0;

  for (const attempt of attempts) {
    const key = dayKey(attempt.at);
    const bucket = buckets.get(key) ?? { date: key, attempts: 0, correct: 0, ratio: 0, ms: 0 };
    bucket.attempts += 1;
    bucket.ratio += attempt.ratio;
    bucket.ms += attempt.msSpent;
    if (attempt.status === 'correct') bucket.correct += 1;
    buckets.set(key, bucket);

    if (attempt.status === 'correct') correct += 1;
    ratio += attempt.ratio;
    ms += attempt.msSpent;
    byMode[attempt.mode] = (byMode[attempt.mode] ?? 0) + 1;

    const deck = decks[attempt.deckKey] ?? { attempts: 0, correct: 0, ratio: 0, ms: 0, lastAt: 0 };
    deck.attempts += 1;
    deck.ratio += attempt.ratio;
    deck.ms += attempt.msSpent;
    deck.lastAt = Math.max(deck.lastAt, attempt.at);
    if (attempt.status === 'correct') deck.correct += 1;
    decks[attempt.deckKey] = deck;
  }

  // Tag breakdown needs question metadata, which lives in the deck files;
  // callers pass tag lookups separately (see tagsFromEntries).
  // Oldest first, so charts read left → right.
  const dayList: DayBucket[] = [];
  const start = startOfDay(now) - (days - 1) * 86_400_000;
  for (let i = 0; i < days; i += 1) {
    const ts = start + i * 86_400_000;
    const key = dayKey(ts);
    const bucket = buckets.get(key);
    if (bucket) bucket.ratio = bucket.attempts === 0 ? 0 : bucket.ratio / bucket.attempts;
    dayList.push(bucket ?? { date: key, attempts: 0, correct: 0, ratio: 0, ms: 0 });
  }

  return {
    total: attempts.length,
    correct,
    ratio: attempts.length === 0 ? 0 : ratio / attempts.length,
    ms,
    days: dayList,
    decks,
    byMode,
  };
}

export function tagBreakdown(
  attempts: readonly Attempt[],
  tagOf: (questionKey: string) => string[],
): TagBucket[] {
  const tags = new Map<string, TagBucket>();
  for (const attempt of attempts) {
    for (const tag of tagOf(attempt.questionKey)) {
      const bucket = tags.get(tag) ?? { tag, attempts: 0, correct: 0, ratio: 0 };
      bucket.attempts += 1;
      bucket.ratio += attempt.ratio;
      if (attempt.status === 'correct') bucket.correct += 1;
      tags.set(tag, bucket);
    }
  }
  return [...tags.values()]
    .map((bucket) => ({ ...bucket, ratio: bucket.attempts === 0 ? 0 : bucket.ratio / bucket.attempts }))
    .sort((a, b) => b.attempts - a.attempts);
}

/** Consecutive days with at least one attempt, counting back from today. */
export function computeStreak(attempts: readonly Attempt[], now = Date.now()): { current: number; best: number } {
  if (attempts.length === 0) return { current: 0, best: 0 };
  const days = new Set(attempts.map((a) => dayKey(a.at)));
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  const sorted = [...days].sort();
  for (const key of sorted) {
    const ts = new Date(`${key}T00:00:00`).getTime();
    run = previous !== null && ts - previous === 86_400_000 ? run + 1 : 1;
    previous = ts;
    if (run > best) best = run;
  }
  const today = startOfDay(now);
  let cursor = today;
  if (!days.has(dayKey(cursor))) cursor -= 86_400_000;
  let current = 0;
  while (days.has(dayKey(cursor))) {
    current += 1;
    cursor -= 86_400_000;
  }
  return { current, best: Math.max(best, current) };
}

export function dueCount(cards: Record<string, CardState>, now = Date.now()): number {
  let count = 0;
  for (const key of Object.keys(cards)) {
    const card = cards[key];
    if (card && card.dueAt <= now) count += 1;
  }
  return count;
}
