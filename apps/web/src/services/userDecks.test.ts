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

interface DeletePlan {
  /** Rows the DELETE by id reports as removed. */
  byId?: number;
  /** Rows the DELETE by client_key reports as removed. */
  byKey?: number;
  /** Whether the row is still readable after a delete that removed nothing. */
  stillVisible?: boolean;
}

function deleteClient(plan: DeletePlan) {
  const removed: string[][] = [];
  const rows = (count: number | undefined) =>
    Array.from({ length: count ?? 0 }, () => ({ id: 'row' }));

  const client = {
    from: () => ({
      select: (_columns: string) => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: 'row', questions: [question] },
            error: null,
          }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({
              data: plan.stillVisible ? [{ id: 'row' }] : [],
              error: null,
            }).then(resolve),
        }),
      }),
      delete: () => ({
        eq: (column: string) => ({
          select: async () => ({
            data: rows(column === 'id' ? plan.byId : plan.byKey),
            error: null,
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClientLike, removed };
}

describe('deleting a cloud deck', () => {
  it('reports success only when a row was actually deleted', async () => {
    const { client, removed } = deleteClient({ byId: 1 });
    await expect(
      createSupabaseUserDeckService(client).remove('row', 'ai.numbers::basics'),
    ).resolves.toBeUndefined();
    expect(removed).toHaveLength(0);
  });

  it('retries by client key when the row id has gone stale', async () => {
    const { client } = deleteClient({ byId: 0, byKey: 1 });
    await expect(
      createSupabaseUserDeckService(client).remove('stale-id', 'ai.numbers::basics'),
    ).resolves.toBeUndefined();
  });

  it('fails loudly when the server keeps the deck', async () => {
    const { client } = deleteClient({ byId: 0, byKey: 0, stillVisible: true });
    await expect(
      createSupabaseUserDeckService(client).remove('row', 'ai.numbers::basics'),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('treats a deck that is already gone as deleted', async () => {
    const { client } = deleteClient({ byId: 0, byKey: 0, stillVisible: false });
    await expect(
      createSupabaseUserDeckService(client).remove('row', 'ai.numbers::basics'),
    ).resolves.toBeUndefined();
  });
});

describe('uploading a deck another writer just created', () => {
  it('falls back to an update when the insert hits the unique key', async () => {
    let selects = 0;
    const updates: string[] = [];
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }),
      },
      storage: {
        from: () => ({
          upload: async () => ({ error: null }),
          remove: async () => ({ error: null }),
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              selects += 1;
              return selects === 1
                ? { data: null, error: null }
                : { data: { id: 'row-2', questions: [] }, error: null };
            },
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "user_decks_user_client_unique"',
              },
            }),
          }),
        }),
        update: () => ({
          eq: (_column: string, id: string) => {
            updates.push(id);
            return {
              select: () => ({
                single: async () => ({ data: row({ id }), error: null }),
              }),
            };
          },
        }),
      }),
    } as unknown as SupabaseClientLike;

    const saved = await createSupabaseUserDeckService(client).upsert({
      clientKey: 'ai.numbers::basics',
      pluginId: 'ai.numbers',
      deckId: 'basics',
      title: 'Numbers',
      tags: ['Numbers'],
      questions: [question] as never,
    });

    expect(updates).toEqual(['row-2']);
    expect(saved.id).toBe('row-2');
  });
});