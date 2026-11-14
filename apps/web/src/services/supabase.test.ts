import type { User } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { mapAuthEvent, mapAuthUser } from './supabase/auth';
import { createSupabaseOfficialService, mapCatalogRows } from './supabase/official';
import { mapProfileRow } from './supabase/profiles';
import type { SupabaseClientLike } from './supabase/client';

const user = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'learner@example.com',
  email_confirmed_at: '2026-11-03T00:00:00.000Z',
  created_at: '2026-11-01T00:00:00.000Z',
  last_sign_in_at: '2026-11-03T01:00:00.000Z',
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: {
    full_name: 'Lin Mei',
    avatar_url: 'https://example.com/a.png',
  },
} as unknown as User;

describe('Supabase auth mapping', () => {
  it('maps user metadata and confirmation state', () => {
    const mapped = mapAuthUser(user);
    expect(mapped.id).toBe(user.id);
    expect(mapped.email).toBe('learner@example.com');
    expect(mapped.emailConfirmed).toBe(true);
    expect(mapped.displayName).toBe('Lin Mei');
    expect(mapped.avatarUrl).toBe('https://example.com/a.png');
    expect(mapped.provider).toBe('google');
  });

  it('prefers display_name over full_name', () => {
    const mapped = mapAuthUser({
      ...user,
      user_metadata: { display_name: 'Mei', full_name: 'Lin Mei' },
    } as unknown as User);
    expect(mapped.displayName).toBe('Mei');
  });

  it('maps only known auth events', () => {
    expect(mapAuthEvent('PASSWORD_RECOVERY')).toBe('password-recovery');
    expect(mapAuthEvent('SIGNED_IN')).toBe('signed-in');
    expect(mapAuthEvent('MFA_CHALLENGE_VERIFIED')).toBeNull();
  });
});

describe('profile mapping', () => {
  it('never trusts an unknown role string', () => {
    expect(
      mapProfileRow({
        id: 'p1',
        display_name: 'A',
        avatar_url: null,
        role: 'admin',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }).role,
    ).toBe('admin');
    expect(
      mapProfileRow({
        id: 'p1',
        display_name: 'A',
        avatar_url: null,
        role: 'owner',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }).role,
    ).toBe('user');
  });
});

describe('official catalogue mapping', () => {
  it('filters unpublished packs and decks and normalises fields', () => {
    const catalog = mapCatalogRows('3', [
      {
        id: 'pack.a',
        name: 'Pack A',
        version: '2',
        description: 'A pack',
        author: 'Author',
        tags: ['x', 'x', ''],
        published: true,
        updated_at: '2026-11-03T00:00:00.000Z',
        decks: [
          {
            id: 'd1',
            title: 'Deck 1',
            title_i18n: { 'zh-Hant': '題庫一' },
            description: null,
            description_i18n: { 'zh-Hant': '第一個題庫。' },
            tags: ['t'],
            questions: [{ id: 'q' }],
            media_base_url: null,
            exam_minutes: 24,
            version: '1',
            published: true,
            updated_at: '2026-11-03T00:00:00.000Z',
          },
          {
            id: 'd2',
            title: 'Hidden',
            description: null,
            tags: [],
            questions: [{ id: 'q' }],
            media_base_url: null,
            version: '1',
            published: false,
            updated_at: '2026-11-03T00:00:00.000Z',
          },
        ],
      },
      {
        id: 'pack.hidden',
        name: 'Hidden pack',
        version: '1',
        tags: [],
        published: false,
        updated_at: '2026-11-03T00:00:00.000Z',
        decks: [],
      },
    ]);
    expect(catalog.version).toBe('3');
    expect(catalog.packs).toHaveLength(1);
    expect(catalog.packs[0]?.tags).toEqual(['x']);
    expect(catalog.packs[0]?.decks.map((deck) => deck.id)).toEqual(['d1']);
    expect(catalog.packs[0]?.decks[0]?.examMinutes).toBe(24);
    expect(catalog.packs[0]?.decks[0]?.titleI18n).toEqual({ 'zh-Hant': '題庫一' });
    expect(catalog.packs[0]?.decks[0]?.descriptionI18n).toEqual({ 'zh-Hant': '第一個題庫。' });
  });

  it('rejects a non-array response', () => {
    expect(() => mapCatalogRows('1', { nope: true })).toThrowError(/not an array/);
  });

  it('falls back to the pre-0.5.1 catalogue when exam_minutes is missing', async () => {
    const packRow = {
      id: 'pack.a',
      name: 'Pack A',
      version: '1',
      tags: [],
      published: true,
      updated_at: '2026-11-03T00:00:00.000Z',
    };
    const deckRow = {
      id: 'd1',
      pack_id: 'pack.a',
      title: 'Deck 1',
      tags: [],
      questions: [{ id: 'q' }],
      media_base_url: null,
      version: '1',
      published: true,
      updated_at: '2026-11-03T00:00:00.000Z',
    };

    const client = {
      from(table: string) {
        let columns = '';
        const payload = () => {
          if (table === 'official_packs') return { data: [packRow], error: null };
          if (columns.includes('exam_minutes')) {
            return {
              data: null,
              error: {
                code: '42703',
                message: 'column "exam_minutes" of relation "official_decks" does not exist',
              },
            };
          }
          return { data: [deckRow], error: null };
        };
        const chain = {
          select(value: string) {
            columns = value;
            return chain;
          },
          eq() {
            return chain;
          },
          order() {
            return chain;
          },
          then(resolve: (value: unknown) => void, reject?: (reason: unknown) => void) {
            return Promise.resolve(payload()).then(resolve, reject);
          },
        };
        return chain;
      },
    } as unknown as SupabaseClientLike;

    const catalog = await createSupabaseOfficialService(client).getCatalog('9');
    expect(catalog.packs[0]?.decks[0]?.id).toBe('d1');
    expect(catalog.packs[0]?.decks[0]?.examMinutes).toBeUndefined();
  });
});
