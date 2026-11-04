/**
 * Compatibility with the app's previous name, "CityU Review" (0.2.x).
 *
 * Two stored identifiers changed in the rename:
 *
 * - the IndexedDB database (`cityu-review` → `mengyin-study`), handled by
 *   `lib/storage.ts`, which copies the old store once; and
 * - the bundled demo plugin ids (`cityu.demo.*` → `mengyin.demo.*`), handled
 *   here. A question's storage key is `pluginId::deckId#questionId`, so
 *   without the remap every card, attempt, note and flag on those decks would
 *   silently disappear.
 *
 * Decks saved by the learner or by the AI generator keep their own ids and are
 * not touched.
 */
import type { Attempt, ProgressState } from '@mengyin/core';

/** Database names the app wrote before the rename, newest first. */
export const LEGACY_DB_NAMES = ['cityu-review'] as const;

/** Prefix of the plugin ids that were renamed. */
const LEGACY_PLUGIN_PREFIX = 'cityu.demo.';
const PLUGIN_PREFIX = 'mengyin.demo.';

/** Remaps one question key, deck key or plugin id. Everything else is returned as-is. */
export function migrateKey(key: string): string {
  if (!key.startsWith(LEGACY_PLUGIN_PREFIX)) return key;
  return `${PLUGIN_PREFIX}${key.slice(LEGACY_PLUGIN_PREFIX.length)}`;
}

function migrateMap<T>(record: Record<string, T>): Record<string, T> {
  const entries = Object.entries(record);
  if (!entries.some(([key]) => migrateKey(key) !== key)) return record;
  const next: Record<string, T> = {};
  for (const [key, value] of entries) next[migrateKey(key)] = value;
  return next;
}

function migrateAttempt(attempt: Attempt): Attempt {
  const questionKey = migrateKey(attempt.questionKey);
  const deckKey = migrateKey(attempt.deckKey);
  const pluginId = migrateKey(attempt.pluginId);
  if (questionKey === attempt.questionKey && deckKey === attempt.deckKey && pluginId === attempt.pluginId) {
    return attempt;
  }
  return { ...attempt, questionKey, deckKey, pluginId };
}

/**
 * Rewrites a progress blob in place-ish: returns the same object when nothing
 * matched, so callers can skip a write.
 */
export function migrateLegacyProgress(progress: ProgressState): ProgressState {
  const attempts = progress.attempts.map(migrateAttempt);
  const cards = migrateMap(progress.cards);
  const flags = migrateMap(progress.flags);
  const notes = migrateMap(progress.notes);
  const sessions = progress.sessions.map((session) => {
    const deckKeys = session.deckKeys.map(migrateKey);
    return deckKeys.some((key, index) => key !== session.deckKeys[index])
      ? { ...session, deckKeys }
      : session;
  });

  const changed =
    attempts.some((attempt, index) => attempt !== progress.attempts[index]) ||
    cards !== progress.cards ||
    flags !== progress.flags ||
    notes !== progress.notes ||
    sessions.some((session, index) => session !== progress.sessions[index]);
  if (!changed) return progress;

  return { ...progress, attempts, cards, flags, notes, sessions };
}
