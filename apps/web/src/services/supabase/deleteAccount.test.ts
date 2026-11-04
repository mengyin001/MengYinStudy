import { describe, expect, it } from 'vitest';
import { createSupabaseAuthService } from './auth';
import type { SupabaseClientLike } from './client';

interface Harness {
  service: ReturnType<typeof createSupabaseAuthService>;
  rpcCalls: string[];
  signOutCalls: unknown[];
}

function harness(error: unknown = null): Harness {
  const rpcCalls: string[] = [];
  const signOutCalls: unknown[] = [];
  const client = {
    async rpc(name: string) {
      rpcCalls.push(name);
      return { data: null, error };
    },
    auth: {
      async signOut(options?: unknown) {
        signOutCalls.push(options);
        return { error: null };
      },
    },
  } as unknown as SupabaseClientLike;
  return { service: createSupabaseAuthService(client), rpcCalls, signOutCalls };
}

describe('deleteAccount', () => {
  it('calls the narrow RPC, then drops the local session', async () => {
    const { service, rpcCalls, signOutCalls } = harness();

    const result = await service.deleteAccount();

    expect(result.ok).toBe(true);
    expect(rpcCalls).toEqual(['delete_account']);
    // `local` scope: the auth user is already gone, so there is nothing to
    // revoke on the server and the call must not need the network.
    expect(signOutCalls).toEqual([{ scope: 'local' }]);
  });

  it('reports a missing migration instead of pretending the account is gone', async () => {
    const { service, signOutCalls } = harness({
      code: 'PGRST202',
      message: 'Could not find the function public.delete_account',
    });

    const result = await service.deleteAccount();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not-ready');
    // A failed deletion keeps the learner signed in so they can retry.
    expect(signOutCalls).toHaveLength(0);
  });

  it('maps a refused deletion to a permission error', async () => {
    const { service } = harness({ code: '42501', message: 'permission denied for function' });

    const result = await service.deleteAccount();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('forbidden');
  });
});
