/**
 * Backend configuration.
 *
 * Only the publishable Supabase key is ever allowed in the browser bundle.
 * A secret/service-role key in a `VITE_` variable would be readable by every
 * visitor, so it is rejected before a client is created.
 */

export type BackendConfigStatus = 'configured' | 'missing' | 'invalid-url' | 'secret-key';

export interface BackendConfig {
  url: string;
  key: string;
  configured: boolean;
  status: BackendConfigStatus;
  /** Human readable, safe to show in the UI (never contains the key). */
  reason: string | null;
  /** Minutes between automatic catalogue checks. */
  syncMinutes: number;
}

const DEFAULT_SYNC_MINUTES = 15;

function positiveMinutes(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return DEFAULT_SYNC_MINUTES;
  return Math.min(24 * 60, Math.round(value));
}

export function parseBackendConfig(
  rawUrl: string | undefined,
  rawKey: string | undefined,
  rawSyncMinutes?: string,
): BackendConfig {
  const syncMinutes = positiveMinutes(rawSyncMinutes);
  const url = (rawUrl ?? '').trim().replace(/\/+$/, '');
  const key = (rawKey ?? '').trim();

  if (!url || !key) {
    return {
      url,
      key,
      configured: false,
      status: 'missing',
      reason: 'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set.',
      syncMinutes,
    };
  }

  if (key.startsWith('sb_secret_') || key.startsWith('service_role')) {
    return {
      url,
      key: '',
      configured: false,
      status: 'secret-key',
      reason:
        'A secret key was supplied to the browser bundle. Use the publishable key; secret keys are server-only.',
      syncMinutes,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      url,
      key,
      configured: false,
      status: 'invalid-url',
      reason: 'VITE_SUPABASE_URL is not a valid URL.',
      syncMinutes,
    };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return {
      url,
      key,
      configured: false,
      status: 'invalid-url',
      reason: 'VITE_SUPABASE_URL must use http or https.',
      syncMinutes,
    };
  }

  return { url, key, configured: true, status: 'configured', reason: null, syncMinutes };
}

export const backendConfig: BackendConfig = parseBackendConfig(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  import.meta.env.VITE_OFFICIAL_SYNC_MINUTES,
);

/**
 * Where Supabase should send the browser after OAuth, email confirmation or a
 * password-reset link. Always a bare document URL: supabase-js consumes the
 * `?code=` query before the hash router runs, and our routes live in the hash.
 */
export function authRedirectUrl(): string {
  if (typeof window === 'undefined') return '';
  const { protocol, origin, pathname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return '';
  return `${origin}${pathname}`;
}
