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
import { createId } from '@mengyin/core';
import { backend } from '@/services';
import { BackendError, fail, ok, toBackendError, type ServiceResult } from '@/services/errors';
import type { UserCollection, UserCollectionInput } from '@/services/types';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import { normalizeDeckKeys } from '@/domain/collections';
import { createRefreshGuard, type RefreshGuard } from './refreshGuard';
import { useAuth } from './AuthContext';

interface CollectionsState {
  ready: boolean;
  collections: UserCollection[];
  busy: boolean;
  error: BackendError | null;
}

type Action =
  | { type: 'reset' }
  | { type: 'loading' }
  | { type: 'loaded'; collections: UserCollection[] }
  | { type: 'removed'; id: string }
  | { type: 'error'; error: BackendError }
  | { type: 'busy'; busy: boolean };

const initialState: CollectionsState = {
  ready: false,
  collections: [],
  busy: false,
  error: null,
};

function reducer(state: CollectionsState, action: Action): CollectionsState {
  switch (action.type) {
    case 'reset':
      return { ready: true, collections: [], busy: false, error: null };
    case 'loading':
      return { ...state, ready: false, error: null };
    case 'loaded':
      return { ...state, ready: true, collections: action.collections, error: null };
    case 'removed':
      return {
        ...state,
        ready: true,
        collections: state.collections.filter((item) => item.id !== action.id),
        error: null,
      };
    case 'error':
      return { ...state, ready: true, error: action.error };
    case 'busy':
      return { ...state, busy: action.busy };
    default:
      return state;
  }
}

export interface CollectionsActions {
  refresh(): Promise<void>;
  create(input: { name: string; description?: string | null }): Promise<ServiceResult<UserCollection>>;
  update(
    id: string,
    patch: { name?: string; description?: string | null; deckKeys?: string[] },
  ): Promise<ServiceResult<UserCollection>>;
  remove(id: string): Promise<ServiceResult>;
  addDecks(id: string, deckKeys: readonly string[]): Promise<ServiceResult<UserCollection>>;
  removeDeck(id: string, deckKey: string): Promise<ServiceResult<UserCollection>>;
  setDecks(id: string, deckKeys: readonly string[]): Promise<ServiceResult<UserCollection>>;
  /** Add/remove one deck across several collections in one pass. */
  setDeckMembership(deckKey: string, collectionIds: readonly string[]): Promise<ServiceResult<number>>;
}

export interface CollectionsContextValue {
  state: CollectionsState;
  authenticated: boolean;
  actions: CollectionsActions;
}

const CollectionsContext = createContext<CollectionsContextValue | null>(null);

function isCollection(value: unknown): value is UserCollection {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<UserCollection>;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    (item.description === null || typeof item.description === 'string') &&
    Array.isArray(item.deckKeys) &&
    item.deckKeys.every((key) => typeof key === 'string') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  );
}

function cacheKey(userId: string): string {
  return `${STORAGE_KEYS.userCollectionsCache}:${userId}`;
}

async function readCache(userId: string): Promise<UserCollection[] | null> {
  const raw = await appStore.get<unknown>(cacheKey(userId));
  if (!Array.isArray(raw) || !raw.every(isCollection)) return null;
  return raw;
}

async function writeCache(userId: string, collections: readonly UserCollection[]): Promise<void> {
  await appStore.set(cacheKey(userId), [...collections]);
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
}

function cleanDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim() ?? '';
  if (!trimmed) return null;
  return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
}

function validate(name: string): BackendError | null {
  if (!name) return new BackendError('invalid-data', 'A collection needs a name.');
  return null;
}

export function CollectionsProvider({ children }: { children: ReactNode }) {
  const { state: auth } = useAuth();
  const userId = auth.user?.id ?? null;
  const [state, dispatch] = useReducer(reducer, initialState);
  const guard = useRef<RefreshGuard>(createRefreshGuard());

  const refresh = useCallback(
    async (quiet = false): Promise<void> => {
      const request = guard.current.begin();
      if (!userId || !backend.configured) {
        dispatch({ type: 'reset' });
        return;
      }

      const cached = await readCache(userId);
      if (!guard.current.accept(request)) return;
      if (cached) {
        dispatch({ type: 'loaded', collections: cached });
      } else if (!quiet) {
        dispatch({ type: 'loading' });
      }

      try {
        const collections = await backend.userCollections.list();
        if (!guard.current.accept(request)) return;
        dispatch({ type: 'loaded', collections });
        await writeCache(userId, collections);
      } catch (error) {
        if (!guard.current.accept(request)) return;
        dispatch({ type: 'error', error: toBackendError(error) });
      }
    },
    [userId],
  );

  useEffect(() => {
    guard.current.invalidate();
    dispatch({ type: 'reset' });
    if (userId) void refresh();
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return;
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, refresh]);

  /**
   * Save one or more collections, then merge the server's rows into state.
   * Callers have already checked `userId` and set the busy flag.
   */
  const persist = useCallback(
    async (inputs: readonly UserCollectionInput[]): Promise<UserCollection[]> => {
      // A list request that started before this write describes the account as
      // it was; letting it land would repaint collections this write changed.
      guard.current.invalidate();
      const saved: UserCollection[] = [];
      for (const input of inputs) {
        saved.push(await backend.userCollections.upsert(input));
      }
      let merged = [...state.collections];
      for (const item of saved) {
        merged = [item, ...merged.filter((existing) => existing.id !== item.id)];
      }
      dispatch({ type: 'loaded', collections: merged });
      if (userId) await writeCache(userId, merged);
      return saved;
    },
    [state.collections, userId],
  );

  const create = useCallback<CollectionsActions['create']>(
    async (input) => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to create a collection.'));
      }
      const name = cleanName(input.name);
      const invalid = validate(name);
      if (invalid) return fail(invalid);

      dispatch({ type: 'busy', busy: true });
      try {
        const [saved] = await persist([
          {
            id: createId('col'),
            name,
            description: cleanDescription(input.description),
            deckKeys: [],
          },
        ]);
        if (!saved) return fail(new BackendError('unknown', 'The collection was not returned.'));
        return ok(saved);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [persist, userId],
  );

  const update = useCallback<CollectionsActions['update']>(
    async (id, patch) => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to update a collection.'));
      }
      const current = state.collections.find((item) => item.id === id);
      if (!current) {
        return fail(new BackendError('invalid-data', 'The collection no longer exists.'));
      }
      const name = cleanName(patch.name ?? current.name);
      const invalid = validate(name);
      if (invalid) return fail(invalid);

      dispatch({ type: 'busy', busy: true });
      try {
        const [saved] = await persist([
          {
            id,
            name,
            description:
              patch.description === undefined
                ? current.description
                : cleanDescription(patch.description),
            deckKeys: normalizeDeckKeys(patch.deckKeys ?? current.deckKeys),
          },
        ]);
        if (!saved) return fail(new BackendError('unknown', 'The collection was not returned.'));
        return ok(saved);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [persist, state.collections, userId],
  );

  const remove = useCallback<CollectionsActions['remove']>(
    async (id) => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to delete a collection.'));
      }
      dispatch({ type: 'busy', busy: true });
      guard.current.invalidate();
      try {
        await backend.userCollections.remove(id);
        const next = state.collections.filter((item) => item.id !== id);
        dispatch({ type: 'removed', id });
        await writeCache(userId, next);
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [state.collections, userId],
  );

  const addDecks = useCallback<CollectionsActions['addDecks']>(
    async (id, deckKeys) => {
      const current = state.collections.find((item) => item.id === id);
      if (!current) {
        return fail(new BackendError('invalid-data', 'The collection no longer exists.'));
      }
      return update(id, {
        deckKeys: normalizeDeckKeys([...current.deckKeys, ...deckKeys]),
      });
    },
    [state.collections, update],
  );

  const removeDeck = useCallback<CollectionsActions['removeDeck']>(
    async (id, deckKey) => {
      const current = state.collections.find((item) => item.id === id);
      if (!current) {
        return fail(new BackendError('invalid-data', 'The collection no longer exists.'));
      }
      return update(id, {
        deckKeys: current.deckKeys.filter((key) => key !== deckKey),
      });
    },
    [state.collections, update],
  );

  const setDecks = useCallback<CollectionsActions['setDecks']>(
    async (id, deckKeys) => update(id, { deckKeys: normalizeDeckKeys(deckKeys) }),
    [update],
  );

  const setDeckMembership = useCallback<CollectionsActions['setDeckMembership']>(
    async (deckKey, collectionIds) => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to update collections.'));
      }
      const wanted = new Set(collectionIds);
      const inputs: UserCollectionInput[] = [];
      for (const collection of state.collections) {
        const has = collection.deckKeys.includes(deckKey);
        const should = wanted.has(collection.id);
        if (has === should) continue;
        inputs.push({
          id: collection.id,
          name: collection.name,
          description: collection.description,
          deckKeys: should
            ? normalizeDeckKeys([...collection.deckKeys, deckKey])
            : collection.deckKeys.filter((key) => key !== deckKey),
        });
      }
      if (inputs.length === 0) return ok(0);

      dispatch({ type: 'busy', busy: true });
      try {
        await persist(inputs);
        return ok(inputs.length);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [persist, state.collections, userId],
  );

  const actions = useMemo<CollectionsActions>(
    () => ({
      refresh: () => refresh(),
      create,
      update,
      remove,
      addDecks,
      removeDeck,
      setDecks,
      setDeckMembership,
    }),
    [refresh, create, update, remove, addDecks, removeDeck, setDecks, setDeckMembership],
  );

  const value = useMemo<CollectionsContextValue>(
    () => ({ state, authenticated: Boolean(userId), actions }),
    [state, userId, actions],
  );

  return <CollectionsContext.Provider value={value}>{children}</CollectionsContext.Provider>;
}

export function useCollections(): CollectionsContextValue {
  const context = useContext(CollectionsContext);
  if (!context) throw new Error('useCollections must be used inside CollectionsProvider');
  return context;
}
