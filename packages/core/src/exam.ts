import type { Deck, Question, QuestionEntry } from './types';

/**
 * Exam length is a property of the paper, not of the app.
 *
 * A deck may declare its own total (`Deck.examMinutes`): the official
 * catalogue does, and generated decks get one from the model's per-question
 * time estimates. When no declaration exists the length is estimated from the
 * questions, so a five-question quiz is never given the same countdown as a
 * forty-question paper.
 */

/** Baseline seconds for a prepared learner before difficulty weighting. */
export const EXAM_BASE_SECONDS: Record<string, number> = {
  single: 60,
  multi: 90,
  boolean: 30,
  fill: 45,
  short: 150,
  code: 300,
};

export const DEFAULT_QUESTION_SECONDS = 90;
export const MIN_EXAM_MINUTES = 1;
export const MAX_EXAM_MINUTES = 600;
/** The model may set a per-question budget, but it stays inside sane bounds. */
export const MIN_QUESTION_SECONDS = 15;
export const MAX_QUESTION_SECONDS = 900;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampMinutes(value: number): number {
  return clamp(Math.round(value), MIN_EXAM_MINUTES, MAX_EXAM_MINUTES);
}

/**
 * Seconds this question should take. A model-supplied `meta.estimatedSeconds`
 * wins; otherwise the question type and difficulty give a deterministic
 * estimate. The value is clamped so a malformed deck cannot create a
 * thousand-hour exam or a zero-second question.
 */
export function estimateQuestionSeconds(question: Question): number {
  const claimed = question.meta?.estimatedSeconds;
  if (typeof claimed === 'number' && Number.isFinite(claimed) && claimed > 0) {
    return clamp(Math.round(claimed), MIN_QUESTION_SECONDS, MAX_QUESTION_SECONDS);
  }

  const mapped = EXAM_BASE_SECONDS[question.type];
  // Plugin types are arbitrary strings; never let `__proto__`/`constructor`
  // resolve to an object and turn the timer into NaN.
  const base =
    typeof mapped === 'number' && Number.isFinite(mapped) ? mapped : DEFAULT_QUESTION_SECONDS;
  const difficulty = Number.isFinite(question.difficulty)
    ? clamp(question.difficulty, 1, 5)
    : 2;
  // Difficulty 1 → 1.0×, difficulty 5 → 1.6×.
  const multiplier = 0.85 + difficulty * 0.15;
  return clamp(
    Math.round(base * multiplier),
    MIN_QUESTION_SECONDS,
    MAX_QUESTION_SECONDS,
  );
}

/** Estimated whole-paper length for a set of questions, in minutes. */
export function examMinutesForQuestions(questions: readonly Question[]): number {
  if (questions.length === 0) return MIN_EXAM_MINUTES;
  const seconds = questions.reduce((total, question) => total + estimateQuestionSeconds(question), 0);
  return clampMinutes(Math.ceil(seconds / 60));
}

/** The deck's own exam length, or an estimate when it has not declared one. */
export function examMinutesForDeck(deck: Deck): number {
  const declared = deck.examMinutes;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    return clampMinutes(declared);
  }
  return examMinutesForQuestions(deck.questions);
}

/**
 * Exam length for the entries a session is about to use.
 *
 * `limit` mirrors `createSession`'s cap (for example Dashboard's "Test 20
 * questions"): a subset of a long paper gets a proportional slice of the
 * deck's time rather than the full paper's countdown.
 */
export function examMinutesForEntries(
  entries: readonly QuestionEntry[],
  limit?: number,
): number {
  if (entries.length === 0) return MIN_EXAM_MINUTES;
  const wanted =
    typeof limit === 'number' && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), entries.length)
      : entries.length;

  const first = entries[0];
  const sameDeck = first ? entries.every((entry) => entry.deck.key === first.deck.key) : false;
  let whole: number;
  if (sameDeck && first) {
    const declared = examMinutesForDeck(first.deck);
    const fullSize = Math.max(1, first.deck.questions.length);
    // A session may use only part of a deck (for example a mistakes-only
    // subset); the paper's length scales with the share it actually covers.
    whole =
      entries.length >= fullSize
        ? declared
        : clampMinutes(Math.ceil(declared * (entries.length / fullSize)));
  } else {
    whole = examMinutesForQuestions(entries.map((entry) => entry.question));
  }

  if (wanted >= entries.length) return whole;
  return clampMinutes(Math.ceil(whole * (wanted / entries.length)));
}

/** Convenience for session creation, which stores milliseconds. */
export function examTimeLimitMsForEntries(
  entries: readonly QuestionEntry[],
  limit?: number,
): number {
  return examMinutesForEntries(entries, limit) * 60_000;
}
