import type { AuthUser } from '@/services/types';

/**
 * Guest practice belongs to the account that was created on this browser, not
 * to any account that happens to sign in here.
 *
 * Up to 0.6.1 `progressScope` gave the guest record to any account without a
 * local learning record, so signing into an existing account on a fresh
 * browser silently mixed guest attempts into that account's cloud history.
 *
 * Two signals identify a genuinely new account:
 *  - `signUp()` records the new user id here. The marker survives the email
 *    confirmation round trip (a week is long enough for any confirmation mail)
 *    and is consumed when the account has had its one chance to adopt.
 *  - An OAuth round trip has no local `signUp()` call, so returning from OAuth
 *    into an account created moments ago counts as a new account as well.
 *
 * A plain sign-in never writes a marker — that is the point: existing accounts
 * keep their own statistics and leave the guest record alone.
 */
export interface NewAccountStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MARKER_PREFIX = 'mengyin:new-account:';
const MARKER_TTL_MS = 7 * 24 * 60 * 60_000;
/** An OAuth first sign-in lands seconds after GoTrue created the account. */
const OAUTH_ACCOUNT_GRACE_MS = 10 * 60_000;
/** Tolerate a small client/server clock difference when reading timestamps. */
const CLOCK_SKEW_MS = 60_000;

function browserStorage(): NewAccountStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Blocked storage (private mode, embedded webview) must not break boot.
    return null;
  }
}

function markerKey(userId: string): string {
  return `${MARKER_PREFIX}${userId}`;
}

/** Remember that this browser created `userId`; called after a successful sign-up. */
export function rememberNewAccount(
  userId: string,
  storage: NewAccountStorage | null = browserStorage(),
  now = Date.now(),
): void {
  if (!storage) return;
  try {
    storage.setItem(markerKey(userId), String(now));
  } catch {
    // Storage can be full or blocked; the account simply keeps its own
    // statistics, which is the safe default.
  }
}

/** Remove the marker once the new account has had its one adoption chance. */
export function forgetNewAccount(
  userId: string,
  storage: NewAccountStorage | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(markerKey(userId));
  } catch {
    // Nothing to recover: a stale marker expires on its own.
  }
}

/**
 * True when `userId` was created on this browser recently enough for the
 * marker to still describe the same onboarding.
 */
export function rememberedNewAccount(
  userId: string,
  storage: NewAccountStorage | null = browserStorage(),
  now = Date.now(),
): boolean {
  if (!storage) return false;
  let raw: string | null = null;
  try {
    raw = storage.getItem(markerKey(userId));
  } catch {
    return false;
  }
  if (raw === null) return false;
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= -CLOCK_SKEW_MS && age <= MARKER_TTL_MS;
}

/**
 * True when the account itself was created moments ago. Used only for the
 * OAuth return leg, where there is no local sign-up call to observe.
 */
export function isFreshAccount(
  user: Pick<AuthUser, 'createdAt'>,
  now = Date.now(),
  graceMs = OAUTH_ACCOUNT_GRACE_MS,
): boolean {
  if (!user.createdAt) return false;
  const created = Date.parse(user.createdAt);
  if (!Number.isFinite(created)) return false;
  const age = now - created;
  return age >= -CLOCK_SKEW_MS && age <= graceMs;
}
