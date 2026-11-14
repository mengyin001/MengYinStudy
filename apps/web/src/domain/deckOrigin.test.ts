import { describe, expect, it } from 'vitest';
import type { Deck } from '@mengyin/core';
import { isAiDeck } from './deckOrigin';

function deck(overrides: Partial<Deck>): Deck {
  return {
    key: 'k::d',
    id: 'd',
    pluginId: 'k',
    title: 'T',
    tags: [],
    questions: [],
    ...overrides,
  };
}

describe('isAiDeck', () => {
  it('recognises decks the generator wrote', () => {
    expect(isAiDeck(deck({ pluginId: 'ai.binary-search-m3x9', id: 'generated-m3x9' }))).toBe(true);
    expect(isAiDeck(deck({ pluginId: 'starter', id: 'generated-legacy' }))).toBe(true);
  });

  it('leaves official, starter and imported decks unmarked', () => {
    expect(isAiDeck(deck({ pluginId: 'cpp.runoob', id: 'chapter-1' }))).toBe(false);
    expect(isAiDeck(deck({ pluginId: 'starter', id: 'welcome' }))).toBe(false);
    expect(isAiDeck(deck({ pluginId: 'ai-classes', id: 'deck-1' }))).toBe(false);
  });
});
