/**
 * Official catalogue lifecycle: bundle → cache → network.
 *
 * The app always boots from the bundled snapshot, then swaps in the last
 * synced catalogue from IndexedDB, then checks the backend version. A version
 * bump triggers one full catalogue fetch; unchanged versions cost one tiny
 * request. The user's own decks never enter this path.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { backend, backendConfig } from '@/services';
import { BackendError, fail, ok, toBackendError, type ServiceResult } from '@/services/errors';
import {
  cacheToLoadedPlugins,
  readOfficialCache,
  writeOfficialCache,
  type OfficialCache,
  type OfficialPack,
} from '@/services/officialCache';
import { buildOfficialPacks, type OfficialIssue } from '@/services/officialSync';

export type OfficialStatus =
  | 'loading'
  | 'disabled'
  | 'idle'
  | 'syncing'
  | 'ready'
  | 'stale'
  | 'error';

export interface OfficialContentState {
  ready: boolean;
  status: OfficialStatus;
  packs: OfficialPack[];
  version: string | null;
  syncedAt: number | null;
  source: 'network' | 'cache' | 'none';
  error: BackendError | null;
  issues: OfficialIssue[];
}

type Action =
  | { type: 'cache'; cache: OfficialCache }
  | { type: 'network'; cache: OfficialCache; issues: OfficialIssue[] }
  | { type: 'syncing' }
  | { type: 'stale'; cache: OfficialCache; error: BackendError }
  | { type: 'error'; error: BackendError }
  | { type: 'disabled' };

const initialState: OfficialContentState = {
  ready: false,
  status: 'loading',
  packs: [],
  version: null,
  syncedAt: null,
  source: 'none',
  error: null,
  issues: [],
};

function reducer(state: OfficialContentState, action: Action): OfficialContentState {
  switch (action.type) {
    case 'cache':
      return {
        ...state,
        ready: true,
        status: 'ready',
        packs: cacheToLoadedPlugins(action.cache),
        version: action.cache.version,
        syncedAt: action.cache.syncedAt,
        source: 'cache',
        error: null,
        issues: [],
      };
    case 'network':
      return {
        ...state,
        ready: true,
        status: 'ready',
        packs: cacheToLoadedPlugins(action.cache),
        version: action.cache.version,
        syncedAt: action.cache.syncedAt,
        source: 'network',
        error: null,
        issues: action.issues,
      };
    case 'syncing':
      return { ...state, ready: true, status: 'syncing' };
    case 'stale':
      return {
        ...state,
        ready: true,
        status: 'stale',
        packs: cacheToLoadedPlugins(action.cache),
        version: action.cache.version,
        syncedAt: action.cache.syncedAt,
        source: 'cache',
        error: action.error,
      };
    case 'error':
      return { ...state, ready: true, status: 'error', error: action.error };
    case 'disabled':
      return { ...state, ready: true, status: 'disabled' };
    default:
      return state;
  }
}

export interface OfficialContentContextValue {
  state: OfficialContentState;
  /** Check the catalogue version. `force` re-downloads even when unchanged. */
  sync(force?: boolean): Promise<ServiceResult<{ changed: boolean; packs: number }>>;
  /** Manual retry: clears the "backend not provisioned" short-circuit. */
  retry(): Promise<ServiceResult<{ changed: boolean; packs: number }>>;
}

const OfficialContentContext = createContext<OfficialContentContextValue | null>(null);

/**
 * A cache written for another Supabase project must not be reused. Older caches
 * have no `sourceUrl`; they are accepted and will be rewritten on the next sync.
 */
function cacheMatchesBackend(cache: OfficialCache | null): cache is OfficialCache {
  if (!cache) return false;
  if (!cache.sourceUrl || !backend.url) return true;
  return cache.sourceUrl === backend.url;
}

export function OfficialContentProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const syncing = useRef(false);
  const permanentFailure = useRef(false);
  const lastAttempt = useRef(0);

  const sync = useCallback(
    async (force = false): Promise<ServiceResult<{ changed: boolean; packs: number }>> => {
      if (!backend.configured) {
        return fail(new BackendError('unconfigured', backend.reason ?? 'The backend is not configured.'));
      }
      if (syncing.current) {
        return fail(new BackendError('unknown', 'A catalogue sync is already running.'));
      }

      syncing.current = true;
      lastAttempt.current = Date.now();
      dispatch({ type: 'syncing' });

      try {
        const manifest = await backend.official.getManifest();
        const stored = await readOfficialCache();
        const cached = cacheMatchesBackend(stored) ? stored : null;

        if (!force && cached && cached.version === manifest.version) {
          dispatch({ type: 'cache', cache: cached });
          return ok({ changed: false, packs: cached.packs.length });
        }

        const catalog = await backend.official.getCatalog(manifest.version);
        const built = buildOfficialPacks(catalog);
        const cache: OfficialCache = {
          schemaVersion: 1,
          sourceUrl: backend.url,
          version: catalog.version,
          syncedAt: Date.now(),
          packs: built.packs,
        };
        // Writing every time would be wasteful; the version check above already
        // guarantees the content changed or the caller asked for a repair.
        await writeOfficialCache(cache);
        permanentFailure.current = false;
        dispatch({ type: 'network', cache, issues: built.issues });
        return ok({ changed: true, packs: built.packs.length });
      } catch (error) {
        const mapped = toBackendError(error);
        if (mapped.code === 'not-ready' || mapped.code === 'forbidden') {
          permanentFailure.current = true;
        }
        const cached = await readOfficialCache();
        if (cacheMatchesBackend(cached)) dispatch({ type: 'stale', cache: cached, error: mapped });
        else dispatch({ type: 'error', error: mapped });
        return fail(mapped);
      } finally {
        syncing.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readOfficialCache();
      if (!active) return;
      if (cacheMatchesBackend(cached)) dispatch({ type: 'cache', cache: cached });
      if (!backend.configured) {
        dispatch({ type: 'disabled' });
        return;
      }
      await sync(false);
    })();
    return () => {
      active = false;
    };
  }, [sync]);

  useEffect(() => {
    if (!backend.configured) return;
    let active = true;

    const tick = () => {
      if (!active || permanentFailure.current) return;
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastAttempt.current < 60_000) return;
      void sync(false);
    };

    const interval = window.setInterval(tick, Math.max(1, backendConfig.syncMinutes) * 60_000);
    const onFocus = () => tick();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sync]);

  const retry = useCallback(() => {
    permanentFailure.current = false;
    return sync(false);
  }, [sync]);

  const value = useMemo<OfficialContentContextValue>(() => ({ state, sync, retry }), [state, sync, retry]);

  return <OfficialContentContext.Provider value={value}>{children}</OfficialContentContext.Provider>;
}

export function useOfficialContent(): OfficialContentContextValue {
  const context = useContext(OfficialContentContext);
  if (!context) throw new Error('useOfficialContent must be used inside OfficialContentProvider');
  return context;
}
