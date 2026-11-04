/**
 * Which OAuth providers this Supabase project actually has switched on.
 *
 * `signInWithOAuth` only *builds* the `/auth/v1/authorize` URL — supabase-js
 * never calls it, so a disabled provider is invisible until the browser has
 * already left the app and GoTrue answers with a raw JSON page:
 *
 *   {"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
 *
 * `GET /auth/v1/settings` is public (publishable key only) and lists every
 * provider flag, so the sign-in page can check before navigating.
 *
 * The answer is cached and the check fails **open**: if the request fails the
 * caller still navigates, because a broken diagnostic must never block a
 * provider that is in fact enabled.
 */
import type { OAuthProvider } from '../types';

export interface ProviderDirectoryOptions {
  /** Project URL, e.g. `https://<ref>.supabase.co` (no trailing slash). */
  url: string;
  /** Publishable key; `/auth/v1/settings` rejects a request without one. */
  key: string;
  fetchImpl?: typeof fetch;
  /** How long a successful answer is reused. */
  ttlMs?: number;
  now?: () => number;
}

export interface ProviderDirectory {
  /** `true` / `false` when the project answered, `null` when it could not be asked. */
  isEnabled(provider: OAuthProvider): Promise<boolean | null>;
  /** Drop the cached answer (used by tests and by "try again" paths). */
  reset(): void;
}

type ExternalFlags = Record<string, unknown>;

const DEFAULT_TTL_MS = 10 * 60_000;
const SETTINGS_TIMEOUT_MS = 5_000;

export function createProviderDirectory(options: ProviderDirectoryOptions): ProviderDirectory {
  const fetcher = options.fetchImpl ?? globalThis.fetch;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;

  let cached: { at: number; external: ExternalFlags } | null = null;
  let inflight: Promise<ExternalFlags | null> | null = null;

  async function load(): Promise<ExternalFlags | null> {
    if (cached && now() - cached.at < ttlMs) return cached.external;
    if (inflight) return inflight;

    inflight = (async () => {
      try {
        const response = await fetcher(`${options.url}/auth/v1/settings`, {
          headers: { apikey: options.key },
          // A hanging probe would leave the sign-in button spinning; give up
          // quickly and let the caller navigate (fail open).
          signal: AbortSignal.timeout(SETTINGS_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') return null;
        const external = (body as { external?: unknown }).external;
        if (!external || typeof external !== 'object') return null;
        const flags = external as ExternalFlags;
        cached = { at: now(), external: flags };
        return flags;
      } catch {
        return null;
      } finally {
        inflight = null;
      }
    })();

    return inflight;
  }

  return {
    async isEnabled(provider) {
      const external = await load();
      if (!external) return null;
      return external[provider] === true;
    },
    reset() {
      cached = null;
      inflight = null;
    },
  };
}
