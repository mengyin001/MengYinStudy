import type { Deck } from '@mengyin/core';

/**
 * True for a deck the AI generator wrote.
 *
 * The generator gives its decks a plugin id of `ai.<topic>-<stamp>` (see
 * `makeIds` in apps/api/src/generation/generate.ts) and an id of
 * `generated-<stamp>`. Checking the id keeps the marker working for decks that
 * were saved before any explicit flag existed, and it survives cloud sync
 * because `plugin_id` is already stored.
 */
export function isAiDeck(deck: Pick<Deck, 'pluginId' | 'id'>): boolean {
  return deck.pluginId.startsWith('ai.') || deck.id.startsWith('generated-');
}
