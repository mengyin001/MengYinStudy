import type { User } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { createSupabaseAuthService } from './auth';
import type { SupabaseClientLike } from './client';

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'learner@example.com',
  email_confirmed_at: '2026-11-03T00:00:00.000Z',
  created_at: '2026-11-03T00:00:00.000Z',
  last_sign_in_at: '2026-11-03T00:00:00.000Z',
  app_metadata: { provider: 'email' },
  user_metadata: { display_name: 'Mei' },
} as unknown as User;

function serviceWith(getUser: () => Promise<unknown>) {
  const client = {
    auth: { getUser },
  } as unknown as SupabaseClientLike;
  return createSupabaseAuthService(client);
}

describe('validateSession', () => {
  it('returns the server-side user for a live session', async () => {
    const service = serviceWith(async () => ({ data: { user: USER }, error: null }));

    const result = await service.validateSession();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.id).toBe(USER.id);
  });

  it('treats a missing local session as signed out, not as an error', async () => {
    const error = new Error('Auth session missing!');
    error.name = 'AuthSessionMissingError';
    const service = serviceWith(async () => ({ data: { user: null }, error }));

    const result = await service.validateSession();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it('reports a deleted account as unauthorized so the app drops the session', async () => {
    const service = serviceWith(async () => ({
      data: { user: null },
      error: {
        code: 'user_not_found',
        status: 403,
        message: 'User from sub claim in JWT does not exist',
      },
    }));

    const result = await service.validateSession();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unauthorized');
  });

  it('leaves the session alone when the check fails offline', async () => {
    const service = serviceWith(async () => {
      throw new TypeError('Failed to fetch');
    });

    const result = await service.validateSession();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('network');
  });
});

describe('signUp result', () => {
  it('exposes the created user when a confirmation email is required', async () => {
    const client = {
      auth: {
        async signUp() {
          return { data: { user: USER, session: null }, error: null };
        },
      },
    } as unknown as SupabaseClientLike;
    const service = createSupabaseAuthService(client);

    const result = await service.signUp({
      email: 'learner@example.com',
      password: 'password123',
      displayName: 'Mei',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.needsConfirmation).toBe(true);
      expect(result.value.user?.id).toBe(USER.id);
    }
  });
});
