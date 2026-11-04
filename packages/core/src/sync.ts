/**
 * Merging two copies of the same learner's progress.
 *
 * The app syncs a whole `ProgressState`, but replacing it wholesale would lose
 * whichever device wrote second. The fields are therefore merged by identity:
 *
 * - attempts and sessions are append-only lists, merged by id;
 * - scheduling cards keep the record with the newest `lastAt` (a later review
 *   is the one that knows the current interval);
 * - flags and notes keep the writer with the newest per-question stamp, which
 *   is why deletions are stamped too;
 * - settings stay local to the device;
 * - a higher `epoch` wins outright, so **Reset progress** really clears every
 *   device instead of being merged back to life.
 *
 * `learningFingerprint` ignores settings and `updatedAt` so appearance changes
 * do not bounce between devices and a downloaded snapshot is not re-uploaded.
 */
import {
  emptyProgress,
  MAX_ATTEMPTS,
  MAX_SESSIONS,
  type ProgressState,
} from './progress';
import type { Attempt, CardState, SessionSummary } from './types';

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(record).sort(([a], [b]) => a.localeCompare(b))) {
    out[key] = value;
  }
  return out;
}

function mergeAttempts(left: readonly Attempt[], right: readonly Attempt[]): Attempt[] {
  const byId = new Map<string, Attempt>();
  for (const attempt of [...left, ...right]) {
    if (!byId.has(attempt.id)) byId.set(attempt.id, attempt);
  }
  return [...byId.values()]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(-MAX_ATTEMPTS);
}

function mergeSessions(left: readonly SessionSummary[], right: readonly SessionSummary[]): SessionSummary[] {
  const byId = new Map<string, SessionSummary>();
  for (const session of [...left, ...right]) {
    if (!byId.has(session.id)) byId.set(session.id, session);
  }
  return [...byId.values()]
    .sort((a, b) => a.endedAt - b.endedAt || a.id.localeCompare(b.id))
    .slice(-MAX_SESSIONS);
}

function newerCard(left: CardState | undefined, right: CardState | undefined): CardState | undefined {
  if (!left) return right;
  if (!right) return left;
  if (left.lastAt !== right.lastAt) return left.lastAt > right.lastAt ? left : right;
  if (left.reps !== right.reps) return left.reps > right.reps ? left : right;
  if (left.dueAt !== right.dueAt) return left.dueAt > right.dueAt ? left : right;
  if (left.lastGrade !== right.lastGrade) return left.lastGrade > right.lastGrade ? left : right;
  return left;
}

function mergeCards(
  left: Record<string, CardState>,
  right: Record<string, CardState>,
): Record<string, CardState> {
  const out: Record<string, CardState> = {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    const card = newerCard(left[key], right[key]);
    if (card) out[key] = card;
  }
  return out;
}

function mergeFlags(left: ProgressState, right: ProgressState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const keys = [...new Set([...Object.keys(left.flags), ...Object.keys(right.flags)])].sort();
  for (const key of keys) {
    const leftSet = left.flags[key] === true;
    const rightSet = right.flags[key] === true;
    const leftAt = left.meta.flags[key] ?? 0;
    const rightAt = right.meta.flags[key] ?? 0;
    if (leftAt !== rightAt) {
      if (leftAt > rightAt ? leftSet : rightSet) out[key] = true;
      continue;
    }
    // Two legacy records have no stamp; a set flag wins. A newer stamp that
    // removed it has already been handled above.
    if (leftSet || rightSet) out[key] = true;
  }
  return out;
}

function mergeNotes(left: ProgressState, right: ProgressState): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = [...new Set([...Object.keys(left.notes), ...Object.keys(right.notes)])].sort();
  for (const key of keys) {
    const leftNote = left.notes[key];
    const rightNote = right.notes[key];
    const leftAt = left.meta.notes[key] ?? 0;
    const rightAt = right.meta.notes[key] ?? 0;
    if (leftAt !== rightAt) {
      const chosen = leftAt > rightAt ? leftNote : rightNote;
      if (chosen) out[key] = chosen;
      continue;
    }
    if (leftNote !== undefined && rightNote !== undefined) {
      // Stable tie-break so both devices converge on the same text.
      out[key] = leftNote >= rightNote ? leftNote : rightNote;
    } else if (leftNote !== undefined) {
      out[key] = leftNote;
    } else if (rightNote !== undefined) {
      out[key] = rightNote;
    }
  }
  return out;
}

function mergeStamps(left: Record<string, number>, right: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) out[key] = Math.max(left[key] ?? 0, right[key] ?? 0);
  return out;
}

/**
 * Merge the same learner's progress from two devices. `settings` and the
 * returned object always come from the local side; pass the local state first.
 */
export function mergeProgress(local: ProgressState, remote: ProgressState): ProgressState {
  const localEpoch = local.epoch ?? 0;
  const remoteEpoch = remote.epoch ?? 0;

  if (localEpoch !== remoteEpoch) {
    const winner = localEpoch > remoteEpoch ? local : remote;
    return {
      ...winner,
      settings: local.settings,
      epoch: Math.max(localEpoch, remoteEpoch),
      meta: {
        flags: sortedRecord(winner.meta.flags),
        notes: sortedRecord(winner.meta.notes),
      },
      attempts: [...winner.attempts],
      sessions: [...winner.sessions],
      cards: sortedRecord(winner.cards),
    };
  }

  return {
    version: 1,
    attempts: mergeAttempts(local.attempts, remote.attempts),
    cards: mergeCards(local.cards, remote.cards),
    flags: mergeFlags(local, remote),
    notes: mergeNotes(local, remote),
    sessions: mergeSessions(local.sessions, remote.sessions),
    settings: local.settings,
    epoch: localEpoch,
    meta: {
      flags: mergeStamps(local.meta.flags, remote.meta.flags),
      notes: mergeStamps(local.meta.notes, remote.meta.notes),
    },
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
  };
}

function entries(record: Record<string, boolean | string>): Array<[string, boolean | string]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

function stamps(record: Record<string, number>): Array<[string, number]> {
  return Object.entries(record).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * A stable description of the learning record. Excludes settings, `createdAt`
 * and `updatedAt`; those never need to sync between devices.
 */
export function learningFingerprint(progress: ProgressState): string {
  return JSON.stringify({
    epoch: progress.epoch ?? 0,
    attempts: progress.attempts.map((attempt) => [
      attempt.id,
      attempt.questionKey,
      attempt.at,
      attempt.status,
      attempt.ratio,
      attempt.skipped,
      attempt.given ?? '',
    ]),
    sessions: progress.sessions.map((session) => [
      session.id,
      session.endedAt,
      session.total,
      session.score,
      session.correct,
      session.incorrect,
      session.skipped,
      session.label,
    ]),
    cards: Object.keys(progress.cards)
      .sort()
      .map((key) => {
        const card = progress.cards[key];
        return card
          ? [key, card.lastAt, card.reps, card.dueAt, card.intervalDays, card.ease, card.lapses, card.lastGrade]
          : [key];
      }),
    flags: entries(progress.flags),
    notes: entries(progress.notes),
    meta: {
      flags: stamps(progress.meta.flags),
      notes: stamps(progress.meta.notes),
    },
  });
}

/** Fingerprint of a brand-new record, used to avoid creating empty cloud rows. */
export const EMPTY_PROGRESS_FINGERPRINT = learningFingerprint(emptyProgress(0));
