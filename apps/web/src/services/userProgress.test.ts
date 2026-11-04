import { describe, expect, it } from 'vitest';
import { mapProgressRow } from './supabase/userProgress';

describe('cloud progress mapping', () => {
  it('keeps the raw JSON and timestamp', () => {
    const mapped = mapProgressRow({
      progress: { version: 1, attempts: [{ id: 'a' }] },
      updated_at: '2026-11-04T00:00:00.000Z',
    });
    expect(mapped.progress).toEqual({ version: 1, attempts: [{ id: 'a' }] });
    expect(mapped.updatedAt).toBe('2026-11-04T00:00:00.000Z');
  });

  it('rejects a row without a payload', () => {
    expect(() => mapProgressRow({ updated_at: null })).toThrowError(/missing its payload/);
  });
});
