import { clamp } from './ids';
import type { CardState, GradeStatus } from './types';

export const MIN_EASE = 1.3;
export const MAX_EASE = 2.8;
export const DEFAULT_EASE = 2.5;
export const DAY_MS = 86_400_000;
export const LEARNING_MINUTES = 10;

export function newCard(now: number): CardState {
  return {
    reps: 0,
    lapses: 0,
    ease: DEFAULT_EASE,
    intervalDays: 0,
    dueAt: now,
    lastAt: 0,
    lastGrade: 0,
  };
}

export function isDue(card: CardState | undefined, now: number): boolean {
  return !card || card.dueAt <= now;
}

/** Map a graded answer to an SM-2 quality score (0–5). */
export function qualityFromStatus(status: GradeStatus, msSpent = 0): number {
  switch (status) {
    case 'correct':
      // A correct answer that took over a minute is recalled, but shakily.
      return msSpent > 90_000 ? 4 : 5;
    case 'partial':
      return 3;
    case 'incorrect':
      return 1;
    default:
      return 0;
  }
}

/**
 * SM-2 with a short learning step. Missed cards come back in 10 minutes,
 * mastered cards grow roughly 1 → 3 → 3·ease → … days.
 */
export function reviewCard(card: CardState | undefined, quality: number, now: number): CardState {
  const next: CardState = card ? { ...card } : newCard(now);
  const q = clamp(Math.round(quality), 0, 5);
  next.lastAt = now;
  next.lastGrade = q;

  if (q < 3) {
    next.lapses += 1;
    next.reps = 0;
    next.ease = clamp(next.ease - 0.2, MIN_EASE, MAX_EASE);
    next.intervalDays = LEARNING_MINUTES / 1440;
    next.dueAt = now + LEARNING_MINUTES * 60_000;
    return next;
  }

  next.reps += 1;
  if (next.reps === 1) {
    next.intervalDays = 1;
  } else if (next.reps === 2) {
    next.intervalDays = 3;
  } else {
    next.intervalDays = Math.min(365, Math.round(next.intervalDays * next.ease));
  }
  next.ease = clamp(next.ease + (0.1 - (5 - q) * 0.08), MIN_EASE, MAX_EASE);
  next.dueAt = now + next.intervalDays * DAY_MS;
  return next;
}
