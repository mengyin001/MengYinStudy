import { describe, expect, it } from 'vitest';
import type { DeckView } from './library';
import type { UserCollection } from '@/services/types';
import {
  buildCollectionView,
  collectionsContainingDeck,
  normalizeDeckKeys,
} from './collections';

function view(
  key: string,
  input: { total: number; seen: number; attempts: number; ratio: number; due?: number; lastAt?: number },
): DeckView {
  return {
    deck: { key, id: key, pluginId: 'p', title: key, tags: [], questions: [] },
    entries: [],
    attempts: input.attempts,
    seen: input.seen,
    ratio: input.ratio,
    dueCount: input.due ?? 0,
    mistakeCount: 0,
    lastAt: input.lastAt ?? 0,
    total: input.total,
  };
}

function collection(input: Partial<UserCollection> = {}): UserCollection {
  return {
    id: 'col_1',
    name: 'DSE 溫習',
    description: null,
    deckKeys: ['a', 'b'],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...input,
  };
}

describe('collection helpers', () => {
  it('keeps unique, usable deck keys', () => {
    expect(normalizeDeckKeys([' a ', 'b', 'a', '', 3, 'c'.repeat(201), 'd'])).toEqual(['a', 'b', 'd']);
  });

  it('joins present decks and reports missing keys', () => {
    const views = new Map([
      ['a', view('a', { total: 10, seen: 4, attempts: 6, ratio: 0.5, due: 2, lastAt: 20 })],
      ['c', view('c', { total: 5, seen: 1, attempts: 1, ratio: 1, lastAt: 10 })],
    ]);
    const result = buildCollectionView(collection(), views);
    expect(result.decks.map((item) => item.deck.key)).toEqual(['a']);
    expect(result.missing).toEqual(['b']);
    expect(result.questionCount).toBe(10);
    expect(result.studied).toBe(4);
    expect(result.dueCount).toBe(2);
    expect(result.accuracy).toBeCloseTo(0.5);
    expect(result.ratio).toBeCloseTo(0.4);
    expect(result.lastAt).toBe(20);
    expect(result.crest).toBe('溫習');
  });

  it('keeps the learner order even when the map has other decks', () => {
    const views = new Map([
      ['b', view('b', { total: 2, seen: 0, attempts: 0, ratio: 0 })],
      ['a', view('a', { total: 3, seen: 1, attempts: 1, ratio: 0.2 })],
    ]);
    const result = buildCollectionView(collection({ deckKeys: ['b', 'a'] }), views);
    expect(result.decks.map((item) => item.deck.key)).toEqual(['b', 'a']);
    expect(result.questionCount).toBe(5);
    expect(result.studied).toBe(1);
    expect(result.accuracy).toBeCloseTo(0.2);
  });

  it('handles an empty collection', () => {
    const result = buildCollectionView(collection({ deckKeys: [] }), new Map());
    expect(result.decks).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.questionCount).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.accuracy).toBe(0);
  });

  it('finds every collection containing a deck', () => {
    const one = collection({ id: 'one', deckKeys: ['a'] });
    const two = collection({ id: 'two', deckKeys: ['a', 'b'] });
    const three = collection({ id: 'three', deckKeys: ['b'] });
    expect(collectionsContainingDeck([one, two, three], 'a').map((item) => item.id)).toEqual([
      'one',
      'two',
    ]);
  });
});
