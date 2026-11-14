import type { MessageKey } from '@/i18n/messages';

/**
 * The celebration copy changes with the size of the run. Values under ten use
 * the nearest earlier tier, so a 7-answer run still reads as a five-run.
 */
export function streakBurstKey(streak: number): MessageKey {
  if (streak >= 20) return 'streak.burst20';
  if (streak >= 10) return 'streak.burst10';
  if (streak >= 5) return 'streak.burst5';
  return 'streak.burst3';
}

/** Which result sound a finished session earns. */
export type ScoreSoundBand = 'perfect' | 'pass' | 'retry';

/**
 * 100 earns applause, 60–99 an encouraging fanfare, and below 60 a softer
 * low motif that says "keep going" without sounding like a failure.
 */
export function scoreSoundBand(score: number): ScoreSoundBand {
  if (score >= 100) return 'perfect';
  if (score >= 60) return 'pass';
  return 'retry';
}
