import { describe, expect, it } from 'vitest';
import { createSupabaseAuthService } from './auth';
import { createProviderDirectory } from './oauthProviders';
import type { SupabaseClientLike } from './client';

const PROJECT = 'https://example.supabase.co';
const APP = 'http://localhost:5173/';
const AUTHORIZE = `${PROJECT}/auth/v1/authorize?provider=google`;

interface Harness {
  service: ReturnType<typeof createSupabaseAuthService>;
  calls: Array<Record<string, unknown>>;
  navigations: string[];
  settingsRequests: number;
}

function harness(
  options: {
    external?: Record<string, unknown>;
    settingsStatus?: number;
    settingsThrows?: boolean;
    url?: string | null;
    redirectTo?: string | null;
  } = {},
): Harness {
  const calls: Array<Record<string, unknown>> = [];
  const navigations: string[] = [];
  let settingsRequests = 0;

  const client = {
    auth: {
      async signInWithOAuth(args: Record<string, unknown>) {
        calls.push(args);
        if (options.url === null) return { data: { url: null }, error: null };
        return { data: { url: options.url ?? AUTHORIZE }, error: null };
      },
    },
  } as unknown as SupabaseClientLike;

  const fetchImpl = (async () => {
    settingsRequests += 1;
    if (options.settingsThrows) throw new TypeError('fetch failed');
    const status = options.settingsStatus ?? 200;
    return new Response(JSON.stringify({ external: options.external ?? {} }), { status });
  }) as unknown as typeof fetch;

  const service = createSupabaseAuthService(client, {
    url: PROJECT,
    key: 'sb_publishable_test',
    fetchImpl,
    navigate: (url) => navigations.push(url),
    redirectTo: () =>
      options.redirectTo === undefined ? APP : options.redirectTo,
  });

  return {
    service,
    calls,
    navigations,
    get settingsRequests() {
      return settingsRequests;
    },
  };
}

describe('OAuth sign-in', () => {
  it('refuses to redirect when the project has the provider switched off', async () => {
    const h = harness({ external: { google: false, github: false } });
    const result = await h.service.signInWithOAuth('google');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('provider-disabled');
    expect(h.calls).toHaveLength(0);
    expect(h.navigations).toEqual([]);
  });

  it('navigates to the authorisation URL when the provider is enabled', async () => {
    const h = harness({ external: { google: true, github: true } });
    const result = await h.service.signInWithOAuth('google');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.url).toBe(AUTHORIZE);
    expect(h.navigations).toEqual([AUTHORIZE]);
    expect(h.calls[0]).toMatchObject({
      provider: 'google',
      options: { redirectTo: APP, skipBrowserRedirect: true },
    });
  });

  it('only asks Google for an account picker', async () => {
    const h = harness({ external: { google: true, github: true } });
    await h.service.signInWithOAuth('google');
    await h.service.signInWithOAuth('github');

    const google = h.calls[0]?.options as { queryParams?: Record<string, string> };
    const github = h.calls[1]?.options as { queryParams?: Record<string, string> };
    expect(google.queryParams).toEqual({ prompt: 'select_account' });
    expect(github.queryParams).toBeUndefined();
  });

  it('still redirects when the settings probe fails', async () => {
    const failing = harness({ settingsStatus: 500 });
    expect((await failing.service.signInWithOAuth('github')).ok).toBe(true);
    expect(failing.navigations).toEqual([AUTHORIZE]);

    const offline = harness({ settingsThrows: true });
    expect((await offline.service.signInWithOAuth('google')).ok).toBe(true);
    expect(offline.navigations).toEqual([AUTHORIZE]);
  });

  it('rejects a file:// window before touching the network', async () => {
    const h = harness({ redirectTo: null });
    const result = await h.service.signInWithOAuth('google');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unconfigured');
    expect(h.settingsRequests).toBe(0);
    expect(h.navigations).toEqual([]);
  });

  it('surfaces a missing authorisation URL instead of navigating nowhere', async () => {
    const h = harness({ external: { google: true }, url: null });
    const result = await h.service.signInWithOAuth('google');

    expect(result.ok).toBe(false);
    expect(h.navigations).toEqual([]);
  });

  it('caches the provider flags between attempts', async () => {
    const h = harness({ external: { google: true } });
    await h.service.signInWithOAuth('google');
    await h.service.signInWithOAuth('google');
    expect(h.settingsRequests).toBe(1);
  });
});

describe('provider directory', () => {
  it('reuses a fresh answer and refetches after the TTL', async () => {
    let clock = 0;
    let requests = 0;
    const directory = createProviderDirectory({
      url: PROJECT,
      key: 'sb_publishable_test',
      ttlMs: 1_000,
      now: () => clock,
      fetchImpl: (async () => {
        requests += 1;
        return new Response(JSON.stringify({ external: { github: true } }), { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(await directory.isEnabled('github')).toBe(true);
    clock = 900;
    expect(await directory.isEnabled('github')).toBe(true);
    expect(requests).toBe(1);

    clock = 1_500;
    expect(await directory.isEnabled('github')).toBe(true);
    expect(requests).toBe(2);
  });

  it('answers null when the payload has no provider map', async () => {
    const directory = createProviderDirectory({
      url: PROJECT,
      key: 'sb_publishable_test',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ external: 'nope' }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(await directory.isEnabled('google')).toBeNull();
  });
});
