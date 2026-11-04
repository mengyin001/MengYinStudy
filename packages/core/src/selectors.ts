import { isDue } from './srs';
import type { Attempt, CardState, GradeStatus, QuestionEntry } from './types';

export interface MasteryEntry {
  attempts: number;
  ratio: number;
  correct: number;
  lastAt: number;
  lastStatus: GradeStatus;
  streak: number;
}

/** Aggregate attempts per question key (attempts are chronological). */
export function masteryMap(attempts: readonly Attempt[]): Map<string, MasteryEntry> {
  const map = new Map<string, MasteryEntry>();
  for (const attempt of attempts) {
    const entry: MasteryEntry = map.get(attempt.questionKey) ?? {
      attempts: 0,
      ratio: 0,
      correct: 0,
      lastAt: 0,
      lastStatus: 'pending',
      streak: 0,
    };
    entry.attempts += 1;
    entry.ratio += attempt.ratio;
    if (attempt.status === 'correct') {
      entry.correct += 1;
      entry.streak += 1;
    } else if (attempt.status === 'incorrect') {
      entry.streak = 0;
    }
    entry.lastAt = attempt.at;
    entry.lastStatus = attempt.status;
    map.set(attempt.questionKey, entry);
  }
  for (const entry of map.values()) entry.ratio = entry.ratio / entry.attempts;
  return map;
}

export interface Strength {
  /** Language-neutral level; the UI supplies the wording. */
  tone: 'new' | 'weak' | 'learning' | 'solid' | 'mastered';
}

export function strengthOf(entry: MasteryEntry | undefined): Strength {
  if (!entry) return { tone: 'new' };
  if (entry.attempts < 2) return { tone: 'learning' };
  if (entry.ratio >= 0.9 && entry.streak >= 2) return { tone: 'mastered' };
  if (entry.ratio >= 0.75) return { tone: 'solid' };
  if (entry.ratio >= 0.4) return { tone: 'learning' };
  return { tone: 'weak' };
}

/** Questions whose most recent attempt was wrong or partial. */
export function missedEntries(
  entries: readonly QuestionEntry[],
  attempts: readonly Attempt[],
): QuestionEntry[] {
  const latest = new Map<string, Attempt>();
  for (const attempt of attempts) latest.set(attempt.questionKey, attempt);
  return entries.filter((entry) => {
    const attempt = latest.get(entry.key);
    return !!attempt && attempt.status !== 'correct';
  });
}

export function dueEntries(
  entries: readonly QuestionEntry[],
  cards: Record<string, CardState>,
  now = Date.now(),
): QuestionEntry[] {
  return entries.filter((entry) => {
    const card = cards[entry.key];
    const lastAttempt = card?.lastAt;
    // Never-seen questions are due, but don't auto-schedule the whole bank:
    // only cards that entered the SRS system or were attempted.
    return lastAttempt !== undefined ? isDue(card, now) : false;
  });
}

export function flaggedEntries(
  entries: readonly QuestionEntry[],
  flags: Record<string, boolean>,
): QuestionEntry[] {
  return entries.filter((entry) => flags[entry.key] === true);
}

export function questionTagsLookup(entries: readonly QuestionEntry[]): (key: string) => string[] {
  const lookup = new Map<string, string[]>();
  for (const entry of entries) lookup.set(entry.key, entry.question.tags);
  return (key: string) => lookup.get(key) ?? [];
}

export interface DeckProgress {
  attempts: number;
  correct: number;
  ratio: number;
  seen: number;
  total: number;
  lastAt: number;
}

export function deckProgress(entries: readonly QuestionEntry[], attempts: readonly Attempt[]): DeckProgress {
  const keys = new Set(entries.map((entry) => entry.key));
  let total = 0;
  let ratio = 0;
  let correct = 0;
  let lastAt = 0;
  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (!keys.has(attempt.questionKey)) continue;
    total += 1;
    ratio += attempt.ratio;
    if (attempt.status === 'correct') correct += 1;
    lastAt = Math.max(lastAt, attempt.at);
    seen.add(attempt.questionKey);
  }
  return {
    attempts: total,
    correct,
    ratio: total === 0 ? 0 : ratio / total,
    seen: seen.size,
    total: entries.length,
    lastAt,
  };
}
