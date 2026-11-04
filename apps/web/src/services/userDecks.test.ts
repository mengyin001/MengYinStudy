import { describe, expect, it } from 'vitest';
import { createSupabaseUserDeckService, mapUserDeckRow } from './supabase/userDecks';
import type { SupabaseClientLike } from './supabase/client';

const question = {
  id: 'q1',
  type: 'single',
  prompt: 'Which number is even?',
  options: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
  answer: { kind: 'single', optionId: 'b' },
  tags: ['Numbers'],
  difficulty: 1,
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    client_key: 'ai.numbers::basics',
    plugin_id: 'ai.numbers',
    deck_id: 'basics',
    title: 'Numbers',
    description: null,
    tags: ['Numbers'],
    questions: [question],
    exam_minutes: null,
    entry_source: null,
    created_at: '2026-11-03T00:00:00.000Z',
    updated_at: '2026-11-03T01:00:00.000Z',
    ...overrides,
  };
}

describe('user deck mapping', () => {
  it('maps a private row to a deck and keeps its stable key', () => {
    const mapped = mapUserDeckRow(row());
    expect(mapped.clientKey).toBe('ai.numbers::basics');
    expect(mapped.title).toBe('Numbers');
    expect(mapped.questions[0]?.answer).toEqual({ kind: 'single', optionId: 'b' });
  });

  it('keeps a deck-set exam length and treats a missing one as null', () => {
    expect(mapUserDeckRow(row()).examMinutes).toBeNull();
    expect(mapUserDeckRow(row({ exam_minutes: 18 })).examMinutes).toBe(18);
  });

  it('rejects invalid question JSON', () => {
    expect(() => mapUserDeckRow(row({ questions: [{ id: 'broken' }] }))).toThrowError(
      /Cloud deck .* is invalid/,
    );
  });

  it('rejects a client key that does not match the ids', () => {
    expect(() => mapUserDeckRow(row({ client_key: 'other::basics' }))).toThrowError(
      /client key does not match/,
    );
  });

  it('lists decks on a database that has not run the exam_minutes migration', async () => {
    const client = {
      from: () => ({
        select: (columns: string) => ({
          order: async () =>
            columns.includes('exam_minutes')
              ? {
                  data: null,
                  error: {
                    code: '42703',
                    message: 'column "exam_minutes" of relation "user_decks" does not exist',
                  },
                }
              : { data: [row()], error: null },
        }),
      }),
    } as unknown as SupabaseClientLike;

    const decks = await createSupabaseUserDeckService(client).list();
    expect(decks).toHaveLength(1);
    expect(decks[0]?.clientKey).toBe('ai.numbers::basics');
    expect(decks[0]?.examMinutes).toBeNull();
  });
});
