import {
  deckProgress,
  dueEntries,
  entryKey,
  missedEntries,
  type Attempt,
  type CardState,
  type Deck,
  type ProgressState,
  type QuestionEntry,
} from '@mengyin/core';
import type { LoadedPlugin } from '@mengyin/plugin-sdk';
import type { OfficialDeckRef } from '@/services/types';
import type { LocalPluginRecord, PluginIssue } from './pluginHost';

export interface DeckView {
  deck: Deck;
  entries: QuestionEntry[];
  attempts: number;
  seen: number;
  ratio: number;
  dueCount: number;
  mistakeCount: number;
  lastAt: number;
  total: number;
}

export type PluginSource = 'bundled' | 'official' | 'local' | 'cloud';

export interface PluginView {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  source: PluginSource;
  dir: string;
  manifest: LoadedPlugin['manifest'];
  deckCount: number;
  questionCount: number;
  localQuestionTypes: string[];
  issues: PluginIssue[];
}

export function buildEntries(decks: readonly Deck[]): QuestionEntry[] {
  const entries: QuestionEntry[] = [];
  for (const deck of decks) {
    for (const question of deck.questions) {
      entries.push({ deck, question, key: entryKey(deck.key, question.id) });
    }
  }
  return entries;
}

export function entriesForDeck(deck: Deck): QuestionEntry[] {
  return deck.questions.map((question) => ({ deck, question, key: entryKey(deck.key, question.id) }));
}

/**
 * Official decks only enter a learner's library after they add them in the
 * Plaza. The reference list is the source of truth; the catalogue supplies the
 * current questions, so an official update is visible without a second copy.
 */
export function selectOfficialDecks(
  packs: readonly LoadedPlugin[],
  refs: readonly OfficialDeckRef[],
): Deck[] {
  if (refs.length === 0) return [];
  const wanted = new Set(refs.map((ref) => `${ref.packId}::${ref.deckId}`));
  const decks: Deck[] = [];
  for (const pack of packs) {
    for (const deck of pack.decks) {
      if (wanted.has(deck.key)) decks.push(deck);
    }
  }
  return decks;
}

export function deckViews(
  decks: readonly Deck[],
  progress: ProgressState,
  now = Date.now(),
): DeckView[] {
  return decks.map((deck) => {
    const entries = entriesForDeck(deck);
    const stats = deckProgress(entries, progress.attempts);
    const dueCount = dueEntries(entries, progress.cards, now).length;
    const mistakeCount = missedEntries(entries, progress.attempts).length;
    return {
      deck,
      entries,
      attempts: stats.attempts,
      seen: stats.seen,
      ratio: stats.ratio,
      dueCount,
      mistakeCount,
      lastAt: stats.lastAt,
      total: entries.length,
    };
  });
}

export interface TagStat {
  tag: string;
  attempts: number;
  correct: number;
  ratio: number;
  questions: number;
}

export function tagStats(entries: readonly QuestionEntry[], attempts: readonly Attempt[]): TagStat[] {
  const entryOf = new Map(entries.map((entry) => [entry.key, entry]));
  const buckets = new Map<string, TagStat>();
  for (const entry of entries) {
    for (const tag of entry.question.tags) {
      if (!buckets.has(tag)) buckets.set(tag, { tag, attempts: 0, correct: 0, ratio: 0, questions: 0 });
      const bucket = buckets.get(tag);
      if (bucket) bucket.questions += 1;
    }
  }
  for (const attempt of attempts) {
    const entry = entryOf.get(attempt.questionKey);
    if (!entry) continue;
    for (const tag of entry.question.tags) {
      const bucket = buckets.get(tag);
      if (!bucket) continue;
      bucket.attempts += 1;
      bucket.ratio += attempt.ratio;
      if (attempt.status === 'correct') bucket.correct += 1;
    }
  }
  return [...buckets.values()]
    .map((bucket) => ({ ...bucket, ratio: bucket.attempts === 0 ? 0 : bucket.ratio / bucket.attempts }))
    .sort((a, b) => b.questions - a.questions || a.tag.localeCompare(b.tag, 'zh-Hant'));
}

export function allCards(progress: ProgressState): Record<string, CardState> {
  return progress.cards;
}

export function entriesByKey(entries: readonly QuestionEntry[]): Map<string, QuestionEntry> {
  return new Map(entries.map((entry) => [entry.key, entry]));
}

function loadedView(
  plugin: LoadedPlugin,
  source: Extract<PluginSource, 'bundled' | 'official' | 'cloud'>,
  typeOwners: Map<string, string>,
): PluginView {
  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    ...(plugin.manifest.description ? { description: plugin.manifest.description } : {}),
    ...(plugin.manifest.author ? { author: plugin.manifest.author } : {}),
    source,
    dir: plugin.dir,
    manifest: plugin.manifest,
    deckCount: plugin.decks.length,
    questionCount: plugin.decks.reduce((sum, deck) => sum + deck.questions.length, 0),
    localQuestionTypes: [...typeOwners.entries()]
      .filter(([, owner]) => owner === plugin.manifest.id)
      .map(([id]) => id),
    issues: plugin.issues.map((issue) => ({
      ...issue,
      pluginId: plugin.manifest.id,
      pluginName: plugin.manifest.name,
    })),
  };
}

export function pluginViews(
  bundled: readonly LoadedPlugin[],
  local: readonly LocalPluginRecord[],
  localTypeOwners: Map<string, string>,
  official: readonly LoadedPlugin[] = [],
  cloud: readonly LoadedPlugin[] = [],
): PluginView[] {
  const officialIds = new Set(official.map((plugin) => plugin.manifest.id));
  const views: PluginView[] = official.map((plugin) => loadedView(plugin, 'official', localTypeOwners));

  // Cloud decks are private to the account; they sit alongside official and
  // bundled content but carry their own source badge.
  for (const plugin of cloud) {
    views.push(loadedView(plugin, 'cloud', localTypeOwners));
  }

  // A synced pack replaces the bundled snapshot with the same id, so the user
  // never sees the same deck twice.
  for (const plugin of bundled) {
    if (officialIds.has(plugin.manifest.id)) continue;
    views.push(loadedView(plugin, 'bundled', localTypeOwners));
  }

  for (const record of local) {
    views.push({
      id: record.id,
      name: record.manifest.name,
      version: record.manifest.version,
      ...(record.manifest.description ? { description: record.manifest.description } : {}),
      ...(record.manifest.author ? { author: record.manifest.author } : {}),
      source: 'local',
      dir: record.dir,
      manifest: record.manifest,
      deckCount: record.decks.length,
      questionCount: record.decks.reduce((sum, deck) => sum + deck.questions.length, 0),
      localQuestionTypes: [...localTypeOwners.entries()]
        .filter(([, owner]) => owner === record.id)
        .map(([id]) => id),
      issues: [],
    });
  }

  return views.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}
