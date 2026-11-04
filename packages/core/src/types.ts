/**
 * Core domain types. Everything in this file is plain data so it can be
 * produced by plugins (JSON), persisted in IndexedDB, and moved across
 * processes (web <-> desktop) without translation.
 */

/** Built-in question types; plugins may register additional ids. */
export type QuestionTypeId = 'single' | 'multi' | 'boolean' | 'fill' | 'short' | (string & {});

export interface QuestionMedia {
  type: 'image';
  src: string;
  alt?: string;
}

export interface Option {
  id: string;
  text: string;
  /** Optional image(s) shown with the option. */
  media?: QuestionMedia[];
}

export type AnswerKey =
  | { kind: 'single'; optionId: string }
  | { kind: 'multi'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'fill'; accept: string[]; ignoreCase?: boolean; ignoreSpaces?: boolean }
  | { kind: 'short'; model: string; keywords?: string[] }
  /** Graded by a plugin question type; `value` is plugin-defined. */
  | { kind: 'custom'; value: unknown };

export interface QuestionMedia {
  type: 'image';
  src: string;
  alt?: string;
}

export interface Question {
  id: string;
  type: QuestionTypeId;
  prompt: string;
  options?: Option[];
  answer: AnswerKey;
  explanation?: string;
  hint?: string;
  tags: string[];
  /** 1 (easy) – 5 (hard). */
  difficulty: number;
  points?: number;
  source?: string;
  media?: QuestionMedia[];
  /** Free-form data for plugin question types (e.g. a numeric tolerance). */
  meta?: Record<string, unknown>;
}

export interface Deck {
  /** Globally unique: `pluginId::deckId`. */
  key: string;
  id: string;
  pluginId: string;
  title: string;
  description?: string;
  tags: string[];
  questions: Question[];
  /**
   * Whole-paper exam length in minutes, set by the deck author (official
   * catalogue) or by the generator. Missing means the app estimates it from
   * the questions; there is no global fixed length.
   */
  examMinutes?: number;
}

export interface QuestionEntry {
  deck: Deck;
  question: Question;
  /** `deck.key#question.id` — stable key for progress storage. */
  key: string;
}

export type StudyMode = 'practice' | 'exam' | 'review' | 'srs' | 'random' | 'drill';

export type GradeStatus = 'correct' | 'partial' | 'incorrect' | 'pending';

export interface GradeResult {
  status: GradeStatus;
  /** 0..1 — used for partial credit and mastery weighting. */
  ratio: number;
}

export type SelfGrade = 'correct' | 'partial' | 'incorrect';

export type Answer =
  | { kind: 'single'; optionId: string | null }
  | { kind: 'multi'; optionIds: string[] }
  | { kind: 'boolean'; value: boolean | null }
  | { kind: 'fill'; value: string }
  | { kind: 'short'; value: string; selfGrade: SelfGrade | null }
  | { kind: 'custom'; value: unknown };

export interface Attempt {
  id: string;
  questionKey: string;
  questionId: string;
  deckKey: string;
  pluginId: string;
  sessionId: string;
  mode: StudyMode;
  at: number;
  msSpent: number;
  status: Exclude<GradeStatus, 'pending'>;
  ratio: number;
  skipped: boolean;
  /** Human readable snapshot of the submitted answer, for review lists. */
  given?: string;
}

/** SM-2 flavoured scheduling card. */
export interface CardState {
  reps: number;
  lapses: number;
  ease: number;
  /** Fractional days, so learning steps can be minutes. */
  intervalDays: number;
  dueAt: number;
  lastAt: number;
  lastGrade: number;
}

export interface SessionItem {
  entry: QuestionEntry;
  answer: Answer | null;
  result: GradeResult | null;
  msSpent: number;
  flagged: boolean;
  skipped: boolean;
  /** How many times this question has been re-queued (drill mode). */
  requeued?: number;
}

export interface Session {
  id: string;
  mode: StudyMode;
  label: string;
  items: SessionItem[];
  index: number;
  startedAt: number;
  endedAt: number | null;
  timeLimitMs: number | null;
  /** Practice mode reveals the answer right after submitting. */
  reveal: boolean;
  /** Drill mode: wrong answers are appended to the queue until answered correctly. */
  requeueMissed: boolean;
  finished: boolean;
}

export interface SessionSummary {
  id: string;
  mode: StudyMode;
  label: string;
  deckKeys: string[];
  startedAt: number;
  endedAt: number;
  total: number;
  correct: number;
  partial: number;
  incorrect: number;
  skipped: number;
  score: number;
  msSpent: number;
  byTag: Record<string, { attempts: number; ratio: number }>;
}
