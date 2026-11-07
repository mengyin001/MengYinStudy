/** Supabase JWT verification for the public API. */
import type { Env } from '../env';
import { ApiError, unauthorized, unconfigured } from '../errors';

export interface AuthContext {
  /** Null only when AUTH_REQUIRED=false (local development). */
  userId: string | null;
  /** The bearer token, so a handler can call Supabase RPCs as this user. */
  token: string | null;
}

const CACHE_TTL_MS = 60_000;
const CACHE_LIMIT = 500;
const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

export function authRequired(env: Env): boolean {
  return (env.AUTH_REQUIRED ?? 'true').trim().toLowerCase() !== 'false';
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cacheGet(key: string, now: number): string | null {
  const hit = tokenCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    tokenCache.delete(key);
    return null;
  }
  return hit.userId;
}

function cachePut(key: string, userId: string, now: number): void {
  if (tokenCache.size >= CACHE_LIMIT) tokenCache.clear();
  tokenCache.set(key, { userId, expiresAt: now + CACHE_TTL_MS });
}

/**
 * Validate a bearer token with GoTrue's `/user` endpoint.
 *
 * Only a hash of the token is kept in memory, and only for a minute. The
 * service does not need the JWT signing secret, so it can run with just the
 * publishable key.
 */
export async function authenticate(
  request: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AuthContext> {
  if (!authRequired(env)) return { userId: null, token: null };

  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) throw unauthorized();

  const key = await hashToken(token);
  const cached = cacheGet(key, now());
  if (cached) return { userId: cached, token };

  const supabaseUrl = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (!supabaseUrl || !publishableKey) {
    throw unconfigured(
      'AUTH_REQUIRED is on but SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are missing from the server environment.',
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
  } catch (error) {
    throw new ApiError(
      503,
      'server_error',
      `Could not verify your session (${(error instanceof Error ? error.message : String(error)).slice(0, 120)}).`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw unauthorized('Your session expired. Sign in again.');
  }
  if (!response.ok) {
    throw new ApiError(503, 'server_error', `Session verification failed (${response.status}).`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(503, 'server_error', 'Session verification returned an unreadable response.');
  }
  const userId =
    payload && typeof payload === 'object' && typeof (payload as { id?: unknown }).id === 'string'
      ? (payload as { id: string }).id
      : '';
  if (!userId) throw unauthorized('Your session is no longer valid. Sign in again.');

  cachePut(key, userId, now());
  return { userId, token };
}
