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
import { backend } from '@/services';
import { BackendError, fail, ok, toBackendError, type ServiceResult } from '@/services/errors';
import type { OfficialDeckRef } from '@/services/types';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import { useAuth } from './AuthContext';

interface UserLibraryState {
  ready: boolean;
  refs: OfficialDeckRef[];
  busy: boolean;
  error: BackendError | null;
}

type Action =
  | { type: 'reset' }
  | { type: 'loading' }
  | { type: 'loaded'; refs: OfficialDeckRef[] }
  | { type: 'removed'; packId: string; deckId: string }
  | { type: 'error'; error: BackendError }
  | { type: 'busy'; busy: boolean };

const initialState: UserLibraryState = {
  ready: false,
  refs: [],
  busy: false,
  error: null,
};

function reducer(state: UserLibraryState, action: Action): UserLibraryState {
  switch (action.type) {
    case 'reset':
      return { ready: true, refs: [], busy: false, error: null };
    case 'loading':
      return { ...state, ready: false, error: null };
    case 'loaded':
      return { ready: true, refs: action.refs, busy: false, error: null };
    case 'removed':
      return {
        ...state,
        ready: true,
        refs: state.refs.filter(
          (ref) => !(ref.packId === action.packId && ref.deckId === action.deckId),
        ),
        error: null,
      };
    case 'error':
      return { ...state, ready: true, busy: false, error: action.error };
    case 'busy':
      return { ...state, busy: action.busy };
    default:
      return state;
  }
}

export interface UserLibraryActions {
  refresh(): Promise<void>;
  add(packId: string, deckId: string): Promise<ServiceResult<OfficialDeckRef>>;
  remove(packId: string, deckId: string): Promise<ServiceResult>;
}

export interface UserLibraryContextValue {
  state: UserLibraryState;
  authenticated: boolean;
  /** `packId::deckId` keys, for quick membership checks in the Plaza. */
  keys: ReadonlySet<string>;
  actions: UserLibraryActions;
}

const UserLibraryContext = createContext<UserLibraryContextValue | null>(null);

export function officialDeckKey(packId: string, deckId: string): string {
  return `${packId}::${deckId}`;
}

function isRef(value: unknown): value is OfficialDeckRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<OfficialDeckRef>;
  return (
    typeof ref.packId === 'string' &&
    ref.packId.length > 0 &&
    typeof ref.deckId === 'string' &&
    ref.deckId.length > 0 &&
    typeof ref.addedAt === 'string'
  );
}

function cacheKey(userId: string): string {
  return `${STORAGE_KEYS.userLibraryCache}:${userId}`;
}

async function readCache(userId: string): Promise<OfficialDeckRef[] | null> {
  const raw = await appStore.get<unknown>(cacheKey(userId));
  if (!Array.isArray(raw) || !raw.every(isRef)) return null;
  return raw;
}

async function writeCache(userId: string, refs: readonly OfficialDeckRef[]): Promise<void> {
  await appStore.set(cacheKey(userId), [...refs]);
}

export function UserLibraryProvider({ children }: { children: ReactNode }) {
  const { state: auth } = useAuth();
  const userId = auth.user?.id ?? null;
  const [state, dispatch] = useReducer(reducer, initialState);
  const requestId = useRef(0);
  const loadedFor = useRef<string | null>(null);

  const refresh = useCallback(
    async (quiet = false): Promise<void> => {
      const request = ++requestId.current;
      if (!userId || !backend.configured) {
        loadedFor.current = null;
        dispatch({ type: 'reset' });
        return;
      }

      if (loadedFor.current !== userId) {
        const cached = await readCache(userId);
        if (request !== requestId.current) return;
        if (cached) {
          loadedFor.current = userId;
          dispatch({ type: 'loaded', refs: cached });
        } else if (!quiet) {
          dispatch({ type: 'loading' });
        }
      }

      try {
        const refs = await backend.userLibrary.list();
        if (request !== requestId.current) return;
        loadedFor.current = userId;
        dispatch({ type: 'loaded', refs });
        await writeCache(userId, refs);
      } catch (error) {
        if (request !== requestId.current) return;
        const cached = loadedFor.current === userId ? null : await readCache(userId);
        if (cached) {
          loadedFor.current = userId;
          dispatch({ type: 'loaded', refs: cached });
        }
        dispatch({ type: 'error', error: toBackendError(error) });
      }
    },
    [userId],
  );

  useEffect(() => {
    requestId.current += 1;
    loadedFor.current = null;
    dispatch({ type: 'reset' });
    if (userId) void refresh();
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return;
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, refresh]);

  const add = useCallback(
    async (packId: string, deckId: string): Promise<ServiceResult<OfficialDeckRef>> => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to add a deck from the Plaza.'));
      }
      dispatch({ type: 'busy', busy: true });
      try {
        const ref = await backend.userLibrary.add(packId, deckId);
        await refresh(true);
        return ok(ref);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [refresh, userId],
  );

  const remove = useCallback(
    async (packId: string, deckId: string): Promise<ServiceResult> => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to remove a deck from your library.'));
      }
      dispatch({ type: 'busy', busy: true });
      try {
        await backend.userLibrary.remove(packId, deckId);
        // Apply the removal before the refresh so a slow or failed catalogue
        // refresh cannot leave a removed deck on screen.
        dispatch({ type: 'removed', packId, deckId });
        await writeCache(
          userId,
          state.refs.filter((ref) => !(ref.packId === packId && ref.deckId === deckId)),
        );
        await refresh(true);
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [refresh, state.refs, userId],
  );

  const keys = useMemo(
    () => new Set(state.refs.map((ref) => officialDeckKey(ref.packId, ref.deckId))),
    [state.refs],
  );

  const actions = useMemo<UserLibraryActions>(
    () => ({
      refresh: () => refresh(),
      add,
      remove,
    }),
    [refresh, add, remove],
  );

  const value = useMemo<UserLibraryContextValue>(
    () => ({ state, authenticated: Boolean(userId), keys, actions }),
    [state, userId, keys, actions],
  );

  return <UserLibraryContext.Provider value={value}>{children}</UserLibraryContext.Provider>;
}

export function useUserLibrary(): UserLibraryContextValue {
  const context = useContext(UserLibraryContext);
  if (!context) throw new Error('useUserLibrary must be used inside UserLibraryProvider');
  return context;
}
