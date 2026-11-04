import type { Attempt, CardState, SessionSummary } from './types';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontScale = 'cozy' | 'normal' | 'large';
/** Interface language. Questions stay in whatever language the deck uses. */
export type Locale = 'en' | 'zh-Hant';

export interface Settings {
  theme: ThemeMode;
  locale: Locale;
  fontScale: FontScale;
  /** Auto-advance after a correct answer in practice mode. */
  autoNext: boolean;
  autoNextMs: number;
  /** Target number of questions per day. */
  dailyTarget: number;
  shuffleOptions: boolean;
  showTimer: boolean;
  /** Reveal the answer immediately in practice mode. */
  revealInPractice: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  locale: 'en',
  fontScale: 'normal',
  autoNext: false,
  autoNextMs: 900,
  dailyTarget: 30,
  shuffleOptions: true,
  showTimer: true,
  revealInPractice: true,
};

/**
 * Per-question modification times used when two devices are merged.
 *
 * A missing flag/note alone cannot say whether it was never set or was removed,
 * so both are stamped. The stamp survives the deletion.
 */
export interface ProgressMeta {
  flags: Record<string, number>;
  notes: Record<string, number>;
}

export interface ProgressState {
  version: 1;
  attempts: Attempt[];
  cards: Record<string, CardState>;
  flags: Record<string, boolean>;
  notes: Record<string, string>;
  sessions: SessionSummary[];
  settings: Settings;
  /**
   * Reset/restore generation. A device with a higher epoch replaces the other
   * device's learning record instead of merging it; this is how a deliberate
   * reset propagates. Normal edits keep the same epoch and merge.
   */
  epoch: number;
  meta: ProgressMeta;
  createdAt: number;
  updatedAt: number;
}

export const MAX_ATTEMPTS = 8000;
export const MAX_SESSIONS = 200;

function stampMap(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

export function emptyProgress(now = Date.now()): ProgressState {
  return {
    version: 1,
    attempts: [],
    cards: {},
    flags: {},
    notes: {},
    sessions: [],
    settings: { ...DEFAULT_SETTINGS },
    epoch: 0,
    meta: { flags: {}, notes: {} },
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeProgress(input: unknown, now = Date.now()): ProgressState {
  const base = emptyProgress(now);
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<ProgressState>;
  return {
    ...base,
    version: 1,
    attempts: Array.isArray(raw.attempts) ? raw.attempts.slice(-MAX_ATTEMPTS) : [],
    cards: raw.cards && typeof raw.cards === 'object' ? raw.cards : {},
    flags: raw.flags && typeof raw.flags === 'object' ? raw.flags : {},
    notes: raw.notes && typeof raw.notes === 'object' ? raw.notes : {},
    sessions: Array.isArray(raw.sessions) ? raw.sessions.slice(-MAX_SESSIONS) : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    epoch:
      typeof raw.epoch === 'number' && Number.isFinite(raw.epoch) && raw.epoch >= 0
        ? Math.trunc(raw.epoch)
        : 0,
    meta: {
      flags: stampMap(raw.meta?.flags),
      notes: stampMap(raw.meta?.notes),
    },
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: now,
  };
}

export interface AttemptInput {
  attempt: Attempt;
  card?: CardState;
}

export function recordAttempt(progress: ProgressState, input: AttemptInput, now = Date.now()): ProgressState {
  const attempts = [...progress.attempts, input.attempt];
  if (attempts.length > MAX_ATTEMPTS) attempts.splice(0, attempts.length - MAX_ATTEMPTS);
  const cards = input.card ? { ...progress.cards, [input.attempt.questionKey]: input.card } : progress.cards;
  return { ...progress, attempts, cards, updatedAt: now };
}

export function addSession(progress: ProgressState, summary: SessionSummary, now = Date.now()): ProgressState {
  const sessions = [...progress.sessions, summary];
  if (sessions.length > MAX_SESSIONS) sessions.splice(0, sessions.length - MAX_SESSIONS);
  return { ...progress, sessions, updatedAt: now };
}

export function toggleQuestionFlag(
  progress: ProgressState,
  questionKey: string,
  now = Date.now(),
): ProgressState {
  const flags = { ...progress.flags };
  if (flags[questionKey]) delete flags[questionKey];
  else flags[questionKey] = true;
  return {
    ...progress,
    flags,
    meta: { ...progress.meta, flags: { ...progress.meta.flags, [questionKey]: now } },
    updatedAt: now,
  };
}

export function setNote(
  progress: ProgressState,
  questionKey: string,
  note: string,
  now = Date.now(),
): ProgressState {
  const notes = { ...progress.notes };
  const trimmed = note.trim();
  if (trimmed) notes[questionKey] = trimmed;
  else delete notes[questionKey];
  return {
    ...progress,
    notes,
    meta: { ...progress.meta, notes: { ...progress.meta.notes, [questionKey]: now } },
    updatedAt: now,
  };
}
