/**
 * Progress is stored per identity: one record for guests and one per account.
 *
 * Versions up to 0.4.0 kept a single `progress:v1` record, so signing out left
 * the previous account's attempts, sessions and mistakes on the dashboard.
 * Scoped keys fix that: a signed-out view only ever reads the guest record.
 *
 * Guest practice is not dead data. A learner who tries the starter decks and
 * then creates an account on this browser keeps their work: the new account
 * adopts it once and the guest record is cleared. Adoption is opt-in because it
 * is only correct for a new account — signing into an existing account must
 * never merge guest attempts into that account's history. `newAccount.ts`
 * decides who qualifies. The old shared `progress:v1` blob is adopted once by
 * the first account that signs in after upgrading; it is that account's own
 * history from before this change.
 */
import { emptyProgress, normalizeProgress, type ProgressState } from '@mengyin/core';
import { migrateLegacyProgress } from '@/lib/legacy';
import { STORAGE_KEYS, type KeyValueStore } from '@/lib/storage';

export type ProgressScope = { kind: 'guest' } | { kind: 'account'; userId: string };

export interface LoadScopeOptions {
  /**
   * The account was created on this browser and is claiming its one-time
   * guest-practice inheritance. False/omitted for every existing account.
   */
  adoptGuest?: boolean;
}

const GUEST_KEY = `${STORAGE_KEYS.progressScoped}:guest`;

export function progressScopeFor(userId: string | null | undefined): ProgressScope {
  return userId ? { kind: 'account', userId } : { kind: 'guest' };
}

export function progressKey(scope: ProgressScope): string {
  return scope.kind === 'guest' ? GUEST_KEY : `${STORAGE_KEYS.progressScoped}:user:${scope.userId}`;
}

export function sameProgressScope(left: ProgressScope, right: ProgressScope): boolean {
  return progressKey(left) === progressKey(right);
}

/**
 * Attempts, schedule, flags, notes or sessions count as history. Settings do
 * not: a theme choice alone must not stop guest practice from being adopted.
 */
export function hasLearningRecord(progress: ProgressState): boolean {
  return (
    progress.epoch > 0 ||
    progress.attempts.length > 0 ||
    progress.sessions.length > 0 ||
    Object.keys(progress.cards).length > 0 ||
    Object.keys(progress.flags).length > 0 ||
    Object.keys(progress.notes).length > 0
  );
}

async function readAt(store: KeyValueStore, key: string): Promise<ProgressState | undefined> {
  const raw = await store.get<unknown>(key);
  if (raw === undefined) return undefined;
  const normalized = normalizeProgress(raw);
  const migrated = migrateLegacyProgress(normalized);
  // Persist the pre-rename plugin-id remap once, not on every boot.
  if (migrated !== normalized) await store.set(key, migrated);
  return migrated;
}

export async function saveScopeProgress(
  store: KeyValueStore,
  scope: ProgressScope,
  progress: ProgressState,
): Promise<void> {
  await store.set(progressKey(scope), progress);
}

/**
 * Resolve the record that `scope` may see.
 *
 * 1. its own record, when that record has learning history;
 * 2. an account with no history adopts the pre-0.4.1 shared `progress:v1`
 *    blob once — the history that predates per-account storage;
 * 3. a new account (`adoptGuest`) adopts guest practice from this browser, then
 *    the guest record is removed so signing out shows zero;
 * 4. otherwise an existing settings-only record, or a fresh one.
 *
 * An existing account never reads guest practice: the guest record is left
 * untouched for the guest view. A guest never reads an account's record or the
 * shared legacy blob's history; only its appearance settings are borrowed so
 * signing out keeps the language and theme the learner was using.
 */
export async function loadScopeProgress(
  store: KeyValueStore,
  scope: ProgressScope,
  options: LoadScopeOptions = {},
): Promise<ProgressState> {
  const own = await readAt(store, progressKey(scope));
  if (own && hasLearningRecord(own)) return own;

  if (scope.kind === 'guest') {
    if (own) return own;
    const legacy = await readAt(store, STORAGE_KEYS.progress);
    return legacy ? { ...emptyProgress(), settings: legacy.settings } : emptyProgress();
  }

  // An existing settings-only record still owns this account's appearance.
  const settings = own?.settings;
  const legacy = await readAt(store, STORAGE_KEYS.progress);
  if (legacy && hasLearningRecord(legacy)) {
    const adopted = settings ? { ...legacy, settings } : legacy;
    await saveScopeProgress(store, scope, adopted);
    await store.remove(STORAGE_KEYS.progress);
    return adopted;
  }

  if (!options.adoptGuest && own) return own;

  const guest = await readAt(store, progressKey({ kind: 'guest' }));
  if (options.adoptGuest && guest && hasLearningRecord(guest)) {
    const adopted = settings ? { ...guest, settings } : guest;
    await saveScopeProgress(store, scope, adopted);
    await store.remove(progressKey({ kind: 'guest' }));
    return adopted;
  }

  if (own) return own;
  // A first visit on this browser still keeps the language and theme the
  // learner chose as a guest; only the learning history stays behind.
  return guest?.settings ? { ...emptyProgress(), settings: guest.settings } : emptyProgress();
}
