import { describe, expect, it } from 'vitest';
import type { LoadedPlugin } from '@mengyin/plugin-sdk';
import type { OfficialDeckRef } from '@/services/types';
import { selectOfficialDecks } from './library';

const packs = [
  {
    manifest: { id: 'pack.a' },
    decks: [
      { key: 'pack.a::d1', title: 'One' },
      { key: 'pack.a::d2', title: 'Two' },
    ],
  },
  {
    manifest: { id: 'pack.b' },
    decks: [{ key: 'pack.b::d1', title: 'Three' }],
  },
] as unknown as LoadedPlugin[];

function ref(packId: string, deckId: string): OfficialDeckRef {
  return { packId, deckId, addedAt: '2026-11-04T00:00:00.000Z' };
}

describe('official library selection', () => {
  it('returns only decks the learner added', () => {
    const decks = selectOfficialDecks(packs, [ref('pack.a', 'd2'), ref('pack.b', 'd1')]);
    expect(decks.map((deck) => deck.key)).toEqual(['pack.a::d2', 'pack.b::d1']);
  });

  it('ignores references to decks no longer in the catalogue', () => {
    expect(selectOfficialDecks(packs, [ref('pack.a', 'gone')])).toEqual([]);
  });

  it('does not expose the whole catalogue by default', () => {
    expect(selectOfficialDecks(packs, [])).toEqual([]);
  });
});
