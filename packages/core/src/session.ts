import { applyAnswerStreak } from './answerStreak';
import { createId } from './ids';
import { grade as gradeAnswer, isAnswered } from './grading';
import { mulberry32, shuffle, toSeed } from './rng';
import type {
  Answer,
  GradeResult,
  Question,
  QuestionEntry,
  Session,
  SessionItem,
  SessionSummary,
  StudyMode,
} from './types';

/** Grading strategy; the app injects one that also knows plugin question types. */
export type Grader = (question: Question, answer: Answer | null) => GradeResult;

const defaultGrader: Grader = (question, answer) => gradeAnswer(question, answer);

export interface CreateSessionInput {
  mode: StudyMode;
  entries: QuestionEntry[];
  label?: string;
  /** Cap the number of questions. */
  limit?: number;
  shuffle?: boolean;
  seed?: number | string;
  timeLimitMs?: number | null;
  /** Reveal correctness right after each answer (default: everything but exams). */
  reveal?: boolean;
  /** Re-append missed questions to the end of the queue (drill mode). */
  requeueMissed?: boolean;
  now?: number;
}

/** A single question can come back at most this many times in drill mode. */
export const MAX_REQUEUES = 3;
/** Hard cap so a pathological deck cannot grow a session forever. */
const MAX_SESSION_ITEMS = 400;

export function createSession(input: CreateSessionInput): Session {
  const now = input.now ?? Date.now();
  const rng = mulberry32(toSeed(input.seed ?? now));
  let entries = input.shuffle === false ? input.entries.slice() : shuffle(input.entries, rng);
  if (input.limit && input.limit > 0) entries = entries.slice(0, input.limit);

  const items: SessionItem[] = entries.map((entry) => ({
    entry,
    answer: null,
    result: null,
    msSpent: 0,
    flagged: false,
    skipped: false,
  }));

  return {
    id: createId('sess'),
    mode: input.mode,
    label: input.label ?? input.mode,
    items,
    index: 0,
    startedAt: now,
    endedAt: null,
    timeLimitMs: input.timeLimitMs ?? null,
    reveal: input.reveal ?? input.mode !== 'exam',
    requeueMissed: input.requeueMissed ?? input.mode === 'drill',
    finished: false,
    answerStreak: 0,
    bestAnswerStreak: 0,
  };
}

export function currentItem(session: Session): SessionItem | null {
  return session.items[session.index] ?? null;
}

function replaceCurrent(session: Session, patch: Partial<SessionItem>): Session {
  const items = session.items.slice();
  const item = items[session.index];
  if (!item) return session;
  items[session.index] = { ...item, ...patch };
  return { ...session, items };
}

export function submitAnswer(
  session: Session,
  answer: Answer,
  msSpent: number,
  grader: Grader = defaultGrader,
): Session {
  const item = currentItem(session);
  if (!item || item.result) return session;
  const result = grader(item.entry.question, answer);
  const streak = applyAnswerStreak(
    session.mode,
    { current: session.answerStreak, best: session.bestAnswerStreak },
    result.status,
  );
  return replaceCurrent(
    { ...session, answerStreak: streak.current, bestAnswerStreak: streak.best },
    {
      answer,
      result,
      msSpent: item.msSpent + Math.max(0, msSpent),
      skipped: false,
    },
  );
}

export function skipCurrent(session: Session, msSpent: number): Session {
  const item = currentItem(session);
  if (!item || item.result) return session;
  return replaceCurrent(
    { ...session, answerStreak: 0 },
    {
      result: { status: 'incorrect', ratio: 0 },
      msSpent: item.msSpent + Math.max(0, msSpent),
      skipped: true,
      answer: null,
    },
  );
}

export function toggleFlag(session: Session): Session {
  const item = currentItem(session);
  if (!item) return session;
  return replaceCurrent(session, { flagged: !item.flagged });
}

/**
 * Store a draft answer without grading it. Used by exam mode, where answers stay
 * editable until the paper is submitted.
 */
export function setDraftAnswer(session: Session, index: number, answer: Answer | null): Session {
  const items = session.items.slice();
  const item = items[index];
  if (!item || item.result) return session;
  items[index] = { ...item, answer };
  return { ...session, items };
}

/** Add time-on-question without touching the answer (exam navigation). */
export function addTime(session: Session, index: number, ms: number): Session {
  const items = session.items.slice();
  const item = items[index];
  if (!item || ms <= 0) return session;
  items[index] = { ...item, msSpent: item.msSpent + ms };
  return { ...session, items };
}

/**
 * Grade every drafted answer at once and close the session. Unanswered items are
 * marked as skipped; a plugin grader that returns "pending" is also skipped.
 */
export function gradeSession(session: Session, grader: Grader = defaultGrader, now = Date.now()): Session {
  const items = session.items.map((item) => {
    if (!item.answer) {
      return { ...item, result: { status: 'incorrect' as const, ratio: 0 }, skipped: true };
    }
    const result = grader(item.entry.question, item.answer);
    return { ...item, result, skipped: result.status === 'pending' };
  });
  // Exams are marked as one batch, so no answer run exists to celebrate.
  return { ...session, items, endedAt: now, finished: true, answerStreak: 0, bestAnswerStreak: 0 };
}

export function goTo(session: Session, index: number): Session {
  const next = Math.max(0, Math.min(session.items.length - 1, index));
  return { ...session, index: next };
}

export function advance(session: Session, now = Date.now()): Session {
  const current = session.items[session.index];
  let items = session.items;

  if (session.requeueMissed && current?.result && current.result.status !== 'correct' && !current.skipped) {
    const requeued = current.requeued ?? 0;
    if (requeued < MAX_REQUEUES && items.length < MAX_SESSION_ITEMS) {
      items = [
        ...items,
        {
          entry: current.entry,
          answer: null,
          result: null,
          msSpent: 0,
          flagged: current.flagged,
          skipped: false,
          requeued: requeued + 1,
        },
      ];
    }
  }

  if (session.index + 1 >= items.length) {
    return finishSession({ ...session, items }, now);
  }
  return { ...session, items, index: session.index + 1 };
}

export function finishSession(session: Session, now = Date.now()): Session {
  const items = session.items.map((item) =>
    item.result ? item : { ...item, skipped: true, result: { status: 'incorrect', ratio: 0 } as GradeResult },
  );
  return { ...session, items, endedAt: now, finished: true };
}

export interface SessionProgress {
  total: number;
  answered: number;
  correct: number;
  ratio: number;
}

export function progressOf(session: Session): SessionProgress {
  let answered = 0;
  let correct = 0;
  let ratio = 0;
  for (const item of session.items) {
    if (item.answer && isAnswered(item.answer, item.entry.question)) answered += 1;
    if (item.result && item.result.status !== 'pending') {
      ratio += item.result.ratio;
      if (item.result.status === 'correct') correct += 1;
    }
  }
  return {
    total: session.items.length,
    answered,
    correct,
    ratio: session.items.length === 0 ? 0 : ratio / session.items.length,
  };
}

export function summarize(session: Session): SessionSummary {
  let correct = 0;
  let partial = 0;
  let incorrect = 0;
  let skipped = 0;
  let ratio = 0;
  let msSpent = 0;
  const byTag: Record<string, { attempts: number; ratio: number }> = {};
  const deckKeys = new Set<string>();

  for (const item of session.items) {
    const result = item.result;
    msSpent += item.msSpent;
    deckKeys.add(item.entry.deck.key);
    const r = result?.ratio ?? 0;
    ratio += r;
    if (!result || result.status === 'pending') {
      skipped += 1;
    } else if (item.skipped) {
      skipped += 1;
    } else if (result.status === 'correct') {
      correct += 1;
    } else if (result.status === 'partial') {
      partial += 1;
    } else {
      incorrect += 1;
    }
    for (const tag of item.entry.question.tags) {
      if (!result || result.status === 'pending' || item.skipped) continue;
      const bucket = byTag[tag] ?? { attempts: 0, ratio: 0 };
      bucket.attempts += 1;
      bucket.ratio += r;
      byTag[tag] = bucket;
    }
  }

  const total = session.items.length;
  return {
    id: session.id,
    mode: session.mode,
    label: session.label,
    deckKeys: [...deckKeys],
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? Date.now(),
    total,
    correct,
    partial,
    incorrect,
    skipped,
    score: total === 0 ? 0 : Math.round((ratio / total) * 100),
    msSpent,
    bestAnswerStreak: session.mode === 'exam' ? 0 : Math.max(0, session.bestAnswerStreak),
    byTag,
  };
}
