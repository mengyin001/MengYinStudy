/**
 * Presentation helpers for learner-created collections.
 *
 * A collection stores deck keys, not copies. These helpers join those keys to
 * the current `DeckView`s so the UI can show progress, keep missing references
 * visible, and preserve the learner's order.
 */
import type { UserCollection } from '@/services/types';
import type { DeckView } from './library';
import { initialsFor, toneFor, type PlazaTone } from './plaza';

export interface CollectionView {
  collection: UserCollection;
  /** Decks that are currently in the library, in the collection's order. */
  decks: DeckView[];
  /** Keys that no longer resolve to a library deck. */
  missing: string[];
  crest: string;
  tone: PlazaTone;
  questionCount: number;
  studied: number;
  dueCount: number;
  /** Attempt-weighted accuracy across the collection's decks. */
  accuracy: number;
  /** Studied / all questions, 0–1. */
  ratio: number;
  lastAt: number;
}

/** Keep only usable, unique deck keys; callers can pass cached or form data. */
export function normalizeDeckKeys(keys: readonly unknown[]): string[] {
  const result: string[] = [];
  for (const value of keys) {
    if (typeof value !== 'string') continue;
    const key = value.trim();
    if (!key || key.length > 200) continue;
    if (!result.includes(key)) result.push(key);
    if (result.length >= 500) break;
  }
  return result;
}

export function buildCollectionView(
  collection: UserCollection,
  viewByKey: ReadonlyMap<string, DeckView>,
): CollectionView {
  const decks: DeckView[] = [];
  const missing: string[] = [];
  let questionCount = 0;
  let studied = 0;
  let dueCount = 0;
  let attempts = 0;
  let weightedRatio = 0;
  let lastAt = 0;
  const seenKeys = new Set<string>();

  for (const key of collection.deckKeys) {
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const view = viewByKey.get(key);
    if (!view) {
      missing.push(key);
      continue;
    }
    decks.push(view);
    questionCount += view.total;
    studied += view.seen;
    dueCount += view.dueCount;
    attempts += view.attempts;
    weightedRatio += view.ratio * view.attempts;
    lastAt = Math.max(lastAt, view.lastAt);
  }

  return {
    collection,
    decks,
    missing,
    crest: initialsFor(collection.name),
    tone: toneFor(collection.id),
    questionCount,
    studied,
    dueCount,
    accuracy: attempts === 0 ? 0 : weightedRatio / attempts,
    ratio: questionCount === 0 ? 0 : studied / questionCount,
    lastAt,
  };
}

export function collectionsContainingDeck(
  collections: readonly UserCollection[],
  deckKey: string,
): UserCollection[] {
  return collections.filter((collection) => collection.deckKeys.includes(deckKey));
}
