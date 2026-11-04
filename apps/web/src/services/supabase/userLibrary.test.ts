import { describe, expect, it } from 'vitest';
import { mapOfficialDeckRef } from './userLibrary';

describe('official library mapping', () => {
  it('maps a reference row and keeps its ids', () => {
    const ref = mapOfficialDeckRef({
      pack_id: 'starter.study',
      deck_id: 'study-basics',
      added_at: '2026-11-04T01:00:00.000Z',
    });
    expect(ref).toEqual({
      packId: 'starter.study',
      deckId: 'study-basics',
      addedAt: '2026-11-04T01:00:00.000Z',
    });
  });

  it('rejects a row without ids', () => {
    expect(() => mapOfficialDeckRef({ pack_id: '', deck_id: 'x' })).toThrowError(/missing/);
  });
});
