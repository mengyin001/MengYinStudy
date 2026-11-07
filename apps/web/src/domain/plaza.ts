/**
 * Presentation data for the Plaza.
 *
 * The catalogue is a list of packs (a teacher's question bank) and decks (the
 * units inside it). The Plaza treats a pack the way a course catalogue treats a
 * course: one crest, one level, one progress line, and a path of decks behind
 * it. Everything here is derived from the already-validated official packs, so
 * no extra backend fields or migrations are needed.
 */
import { examMinutesForDeck, type Deck } from '@mengyin/core';
import type { LoadedPlugin } from '@mengyin/plugin-sdk';

/** A catalogue pack: a loaded plugin plus the catalogue row's update time. */
export type PlazaSourcePack = LoadedPlugin & { updatedAt?: string };

export type PlazaLevel = 'beginner' | 'intermediate' | 'advanced';
export type PlazaSort = 'recommended' | 'newest' | 'questions';
export type PlazaTone = 0 | 1 | 2 | 3;

export interface PlazaDeckView {
  deck: Deck;
  /** Estimated whole-paper time, in minutes. */
  minutes: number;
  /** Mean question difficulty, 1–5. */
  difficulty: number;
}

export interface PlazaPackView {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version: string;
  tags: string[];
  /** Epoch milliseconds; 0 when the catalogue did not provide a date. */
  updatedAt: number;
  /** Two-character course crest, e.g. "學習" or "DM". */
  crest: string;
  tone: PlazaTone;
  decks: PlazaDeckView[];
  deckCount: number;
  questionCount: number;
  /** Sum of each deck's exam/estimated time. */
  minutes: number;
  /** Question-weighted mean difficulty, 1–5. */
  difficulty: number;
  level: PlazaLevel;
}

export interface TagOption {
  tag: string;
  count: number;
}

export interface PlazaFilters {
  query?: string;
  /** Exact tag match; null / omitted means every category. */
  tag?: string | null;
}

/** The subset of `DeckView` the Plaza needs; keeps this module DOM-free. */
export interface DeckProgressLookup {
  attempts: number;
  seen: number;
  total: number;
  ratio: number;
  dueCount: number;
  lastAt: number;
}

export interface PackProgress {
  /** Decks from this pack that are in the learner's library. */
  added: number;
  total: number;
  /** Questions answered at least once across the added decks. */
  studied: number;
  /** Every question in the pack, including decks not added yet. */
  questions: number;
  due: number;
  /** Attempt-weighted accuracy across the added decks. */
  accuracy: number;
  started: boolean;
  /** Every deck is added and every question has been seen. */
  complete: boolean;
  /** The deck a "continue" action should open, or the first deck to add. */
  nextDeck: PlazaDeckView | null;
}

function clampDifficulty(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
  return Math.min(5, Math.max(1, value));
}

/**
 * A compact, deterministic course mark. Parenthetical subtitles are dropped so
 * "學習方法（示範題庫）" reads as "學習" rather than "學習" plus noise.
 */
export function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '·';
  const cleaned =
    trimmed
      .replace(/[（(【[].*?[）)】\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || trimmed;

  const latinWords = cleaned.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  const cjk = [...cleaned].filter((char) => /[\u3400-\u9fff\uf900-\ufaff]/.test(char));

  if (latinWords.length >= 2) {
    return latinWords
      .slice(0, 2)
      .map((word) => [...word][0] ?? '')
      .join('')
      .toUpperCase();
  }
  if (cjk.length > 0) return cjk.slice(0, 2).join('');
  if (latinWords.length === 1) return [...(latinWords[0] ?? '')].slice(0, 2).join('').toUpperCase();

  const letters = [...cleaned].filter((char) => /[\p{L}\p{N}]/u.test(char));
  return letters.slice(0, 2).join('').toUpperCase() || '·';
}

/** A stable muted tone per pack, so a crest does not change between visits. */
export function toneFor(id: string): PlazaTone {
  let hash = 2_166_136_261;
  for (const char of id) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return ((hash >>> 0) % 4) as PlazaTone;
}

export function levelFor(difficulty: number): PlazaLevel {
  if (!Number.isFinite(difficulty)) return 'beginner';
  if (difficulty <= 2.25) return 'beginner';
  if (difficulty <= 3.5) return 'intermediate';
  return 'advanced';
}

export function buildPlazaPacks(packs: readonly PlazaSourcePack[]): PlazaPackView[] {
  return packs.map((pack) => {
    let questionCount = 0;
    let difficultyTotal = 0;

    const decks: PlazaDeckView[] = pack.decks.map((deck) => {
      const questions = deck.questions;
      const difficulty =
        questions.length === 0
          ? 2
          : questions.reduce((sum, question) => sum + clampDifficulty(question.difficulty), 0) /
            questions.length;
      questionCount += questions.length;
      difficultyTotal += difficulty * questions.length;
      return { deck, minutes: examMinutesForDeck(deck), difficulty };
    });

    const difficulty = questionCount === 0 ? 2 : difficultyTotal / questionCount;
    const updatedAt = pack.updatedAt ? Date.parse(pack.updatedAt) : Number.NaN;

    return {
      id: pack.manifest.id,
      name: pack.manifest.name,
      ...(pack.manifest.description ? { description: pack.manifest.description } : {}),
      ...(pack.manifest.author ? { author: pack.manifest.author } : {}),
      version: pack.manifest.version,
      tags: [...pack.manifest.tags],
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
      crest: initialsFor(pack.manifest.name),
      tone: toneFor(pack.manifest.id),
      decks,
      deckCount: decks.length,
      questionCount,
      minutes: decks.reduce((sum, deck) => sum + deck.minutes, 0),
      difficulty,
      level: levelFor(difficulty),
    };
  });
}

/** Tags with one count per pack, ordered by how many packs carry them. */
export function collectTags(packs: readonly PlazaPackView[], limit = 8): TagOption[] {
  const counts = new Map<string, number>();
  for (const pack of packs) {
    for (const tag of new Set(pack.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hant'))
    .slice(0, limit);
}

export function filterPlazaPacks(
  packs: readonly PlazaPackView[],
  filters: PlazaFilters = {},
): PlazaPackView[] {
  const text = (filters.query ?? '').trim().toLowerCase();
  const tag = filters.tag ?? null;
  return packs.filter((pack) => {
    if (tag && !pack.tags.includes(tag)) return false;
    if (!text) return true;
    const haystack = [
      pack.name,
      pack.description ?? '',
      pack.author ?? '',
      pack.tags.join(' '),
      ...pack.decks.flatMap(({ deck }) => [
        deck.title,
        deck.description ?? '',
        deck.tags.join(' '),
      ]),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}

export function sortPlazaPacks(
  packs: readonly PlazaPackView[],
  sort: PlazaSort,
): PlazaPackView[] {
  const copy = [...packs];
  if (sort === 'newest') {
    return copy.sort(
      (a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'zh-Hant'),
    );
  }
  if (sort === 'questions') {
    return copy.sort(
      (a, b) => b.questionCount - a.questionCount || a.name.localeCompare(b.name, 'zh-Hant'),
    );
  }
  return copy;
}

function pickNextDeck(
  pack: PlazaPackView,
  addedDecks: readonly PlazaDeckView[],
  viewByKey: ReadonlyMap<string, DeckProgressLookup>,
): PlazaDeckView | null {
  if (addedDecks.length === 0) return pack.decks[0] ?? null;

  // Resume the most recently studied deck that is not finished. This is the
  // closest equivalent of Duolingo opening the lesson you stopped in.
  const resume = addedDecks
    .map((deck) => ({ deck, view: viewByKey.get(deck.deck.key) }))
    .filter(
      ({ view }) => (view?.attempts ?? 0) > 0 && (view?.seen ?? 0) < (view?.total ?? 0),
    )
    .sort((a, b) => (b.view?.lastAt ?? 0) - (a.view?.lastAt ?? 0))[0];
  if (resume) return resume.deck;

  // Otherwise take the next untouched deck in catalogue order.
  const fresh = addedDecks.find((deck) => (viewByKey.get(deck.deck.key)?.attempts ?? 0) === 0);
  if (fresh) return fresh;

  // Everything has been seen: continue with the most recent deck for a review.
  const recent = [...addedDecks]
    .map((deck) => ({ deck, view: viewByKey.get(deck.deck.key) }))
    .sort((a, b) => (b.view?.lastAt ?? 0) - (a.view?.lastAt ?? 0))[0];
  return recent?.deck ?? addedDecks[0] ?? null;
}

export function packProgress(
  pack: PlazaPackView,
  addedKeys: ReadonlySet<string>,
  viewByKey: ReadonlyMap<string, DeckProgressLookup>,
): PackProgress {
  const addedDecks = pack.decks.filter(({ deck }) => addedKeys.has(deck.key));
  let studied = 0;
  let due = 0;
  let attempts = 0;
  let weightedRatio = 0;
  let started = false;

  for (const { deck } of addedDecks) {
    const view = viewByKey.get(deck.key);
    if (!view) continue;
    studied += view.seen;
    due += view.dueCount;
    attempts += view.attempts;
    weightedRatio += view.ratio * view.attempts;
    if (view.attempts > 0) started = true;
  }

  const added = addedDecks.length;
  const nextDeck = pickNextDeck(pack, addedDecks, viewByKey);
  return {
    added,
    total: pack.deckCount,
    studied,
    questions: pack.questionCount,
    due,
    accuracy: attempts === 0 ? 0 : weightedRatio / attempts,
    started,
    complete: added > 0 && added === pack.deckCount && pack.questionCount > 0 && studied >= pack.questionCount,
    nextDeck,
  };
}
