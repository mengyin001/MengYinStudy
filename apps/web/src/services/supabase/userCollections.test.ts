import { describe, expect, it } from 'vitest';
import { cleanCollectionDeckKeys, mapUserCollectionRow } from './userCollections';

const row = {
  client_id: 'col_abc',
  name: '  DSE 溫習  ',
  description: '  Core subjects  ',
  deck_keys: ['ai.math::algebra', 'ai.math::algebra', ' ai.english::reading ', null],
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
};

describe('user collection mapping', () => {
  it('maps a collection and normalises its keys', () => {
    expect(mapUserCollectionRow(row)).toEqual({
      id: 'col_abc',
      name: 'DSE 溫習',
      description: 'Core subjects',
      deckKeys: ['ai.math::algebra', 'ai.english::reading'],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
    });
  });

  it('rejects rows without a client id or name', () => {
    expect(() => mapUserCollectionRow({ ...row, client_id: '' })).toThrowError(/client id/);
    expect(() => mapUserCollectionRow({ ...row, name: '  ' })).toThrowError(/name/);
  });

  it('bounds and de-duplicates deck keys', () => {
    expect(cleanCollectionDeckKeys(['a', 'a', ' b ', '', 3, 'c'.repeat(201)])).toEqual(['a', 'b']);
  });

  it('treats a missing description as null', () => {
    expect(mapUserCollectionRow({ ...row, description: null }).description).toBeNull();
    expect(mapUserCollectionRow({ ...row, description: '   ' }).description).toBeNull();
  });
});
