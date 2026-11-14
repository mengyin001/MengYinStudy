import type { Attempt, GradeStatus, StudyMode } from './types';

/**
 * Consecutive-correct-answer tracking.
 *
 * This is deliberately separate from the daily study streak in `streak.ts`:
 * the daily flame counts days practised, while this counts correct answers in
 * a row inside one session. Exams never take part — their answers are graded
 * together at submission, so a "streak" would be an artefact of marking, not
 * of answering.
 */

export interface AnswerStreakState {
  current: number;
  best: number;
}

/**
 * Streak lengths that earn the larger celebration (confetti plus the fanfare):
 * the first run of three, then five, then every fifth answer from ten upwards.
 * Two correct answers already earn the short chime; this only picks the louder
 * moments so a long session does not become a fireworks show.
 */
export function isAnswerStreakMilestone(streak: number): boolean {
  if (!Number.isFinite(streak) || streak < 3) return false;
  const value = Math.trunc(streak);
  return value === 3 || value === 5 || (value >= 10 && value % 5 === 0);
}

/**
 * Fold one graded answer into the running streak. A partial answer and a
 * skipped question both break the run, because neither is a clean success.
 */
export function applyAnswerStreak(
  mode: StudyMode,
  state: AnswerStreakState,
  status: GradeStatus,
): AnswerStreakState {
  if (mode === 'exam') return state;
  if (status === 'correct') {
    const current = Math.max(0, state.current) + 1;
    return { current, best: Math.max(Math.max(0, state.best), current) };
  }
  if (status === 'incorrect' || status === 'partial') {
    return { current: 0, best: Math.max(0, state.best) };
  }
  // A pending answer has not been graded yet; it neither builds nor breaks.
  return state;
}

/**
 * Longest run of consecutive correct answers in the recorded history.
 *
 * A run is confined to one session: finishing one session and starting the
 * next with a correct answer is not a continuation. Exam attempts are ignored
 * entirely, and the list is expected oldest first (the order progress uses).
 */
export function computeAnswerStreak(attempts: readonly Attempt[]): number {
  let current = 0;
  let best = 0;
  let sessionId: string | null = null;

  for (const attempt of attempts) {
    if (attempt.mode === 'exam') {
      current = 0;
      sessionId = null;
      continue;
    }
    if (attempt.sessionId !== sessionId) {
      current = 0;
      sessionId = attempt.sessionId;
    }
    if (attempt.status === 'correct' && !attempt.skipped) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }

  return best;
}
