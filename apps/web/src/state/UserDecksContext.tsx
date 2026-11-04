import { deckFileSchema } from '@mengyin/plugin-sdk';
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
import type { UserDeck } from '@/services/types';
import type { LocalPluginRecord } from '@/domain/pluginHost';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import { useAuth } from './AuthContext';

const BUILTIN_TYPES = new Set(['single', 'multi', 'boolean', 'fill', 'short', 'code']);

interface UserDecksState {
  ready: boolean;
  decks: UserDeck[];
  busy: boolean;
  error: BackendError | null;
}

type Action =
  | { type: 'reset' }
  | { type: 'loading' }
  | { type: 'loaded'; decks: UserDeck[] }
  | { type: 'removed'; id: string }
  | { type: 'error'; error: BackendError }
  | { type: 'busy'; busy: boolean };

const initialState: UserDecksState = {
  ready: false,
  decks: [],
  busy: false,
  error: null,
};

function reducer(state: UserDecksState, action: Action): UserDecksState {
  switch (action.type) {
    case 'reset':
      return { ready: true, decks: [], busy: false, error: null };
    case 'loading':
      return { ...state, ready: false, error: null };
    case 'loaded':
      return { ready: true, decks: action.decks, busy: false, error: null };
    case 'removed':
      return {
        ...state,
        ready: true,
        decks: state.decks.filter((deck) => deck.id !== action.id),
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

export interface UserDecksActions {
  refresh(): Promise<void>;
  upload(record: LocalPluginRecord): Promise<ServiceResult<number>>;
  remove(id: string): Promise<ServiceResult>;
}

export interface UserDecksContextValue {
  state: UserDecksState;
  authenticated: boolean;
  syncedKeys: ReadonlySet<string>;
  /** pluginId → single-file ES module, when the owner uploaded runtime code. */
  sources: ReadonlyMap<string, string>;
  actions: UserDecksActions;
}

const UserDecksContext = createContext<UserDecksContextValue | null>(null);

function relativeMedia(src: string): boolean {
  return !/^(https:\/\/|data:)/i.test(src);
}

/**
 * Validate what is about to leave the device. The database repeats the JSON
 * check, but this catches unsupported question types and local image paths
 * before a partial upload.
 */
function validateDeck(record: LocalPluginRecord, deckIndex: number): void {
  const deck = record.decks[deckIndex];
  if (!deck) throw new BackendError('invalid-data', 'Deck is missing.');

  for (const question of deck.questions) {
    if (!record.entrySource && !BUILTIN_TYPES.has(question.type)) {
      throw new BackendError(
        'invalid-data',
        `Question type "${question.type}" is plugin-specific. Upload the plugin module with the deck first.`,
      );
    }
    const media = [...(question.media ?? []), ...(question.options ?? []).flatMap((option) => option.media ?? [])];
    if (media.some((item) => relativeMedia(item.src))) {
      throw new BackendError(
        'invalid-data',
        'This deck still contains a relative image. Re-import its folder so the image can be embedded, then upload again.',
      );
    }
  }

  const parsed = deckFileSchema.safeParse({
    id: deck.id,
    title: deck.title,
    description: deck.description,
    tags: deck.tags,
    questions: deck.questions,
    ...(deck.examMinutes == null ? {} : { examMinutes: deck.examMinutes }),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BackendError('invalid-data', `Deck is invalid: ${first?.message ?? 'bad data'}`);
  }
}

interface UserDecksCache {
  userId: string;
  fingerprint: string;
  decks: UserDeck[];
  fetchedAt: number;
}

/** Changes whenever any row's content timestamp or identity changes. */
export function userDeckFingerprint(decks: readonly UserDeck[]): string {
  return decks
    .map((deck) => `${deck.id}:${deck.clientKey}:${deck.updatedAt}`)
    .sort()
    .join('|');
}

function cacheKey(userId: string): string {
  return `${STORAGE_KEYS.userDecksCache}:${userId}`;
}

export function isCachedDeck(value: unknown): value is UserDeck {
  if (!value || typeof value !== 'object') return false;
  const deck = value as Partial<UserDeck>;
  if (
    typeof deck.id !== 'string' ||
    typeof deck.clientKey !== 'string' ||
    typeof deck.pluginId !== 'string' ||
    typeof deck.deckId !== 'string' ||
    typeof deck.title !== 'string' ||
    !deck.title ||
    (deck.description !== null && typeof deck.description !== 'string') ||
    !Array.isArray(deck.tags) ||
    !deck.tags.every((tag) => typeof tag === 'string') ||
    (deck.entrySource !== null && typeof deck.entrySource !== 'string') ||
    typeof deck.createdAt !== 'string' ||
    typeof deck.updatedAt !== 'string'
  ) {
    return false;
  }
  if (deck.clientKey !== `${deck.pluginId}::${deck.deckId}`) return false;
  const parsed = deckFileSchema.safeParse({
    id: deck.deckId,
    title: deck.title,
    description: deck.description ?? undefined,
    tags: deck.tags,
    questions: deck.questions,
    ...(deck.examMinutes == null ? {} : { examMinutes: deck.examMinutes }),
  });
  return parsed.success;
}

async function readUserDecksCache(userId: string): Promise<UserDecksCache | null> {
  const raw = await appStore.get<unknown>(cacheKey(userId));
  if (!raw || typeof raw !== 'object') return null;
  const cache = raw as Partial<UserDecksCache>;
  if (
    cache.userId !== userId ||
    typeof cache.fingerprint !== 'string' ||
    !Array.isArray(cache.decks) ||
    !cache.decks.every(isCachedDeck)
  ) {
    return null;
  }
  return {
    userId,
    fingerprint: cache.fingerprint,
    decks: cache.decks,
    fetchedAt: typeof cache.fetchedAt === 'number' ? cache.fetchedAt : 0,
  };
}

async function writeUserDecksCache(
  userId: string,
  decks: readonly UserDeck[],
  fingerprint: string,
): Promise<void> {
  await appStore.set(cacheKey(userId), {
    userId,
    fingerprint,
    decks: [...decks],
    fetchedAt: Date.now(),
  } satisfies UserDecksCache);
}

export function UserDecksProvider({ children }: { children: ReactNode }) {
  const { state: auth } = useAuth();
  const userId = auth.user?.id ?? null;
  const [state, dispatch] = useReducer(reducer, initialState);
  const requestId = useRef(0);
  const loadedDecks = useRef<UserDeck[] | null>(null);
  const loadedFingerprint = useRef<string | null>(null);

  const refresh = useCallback(
    async (quiet = false): Promise<void> => {
      const request = ++requestId.current;
      if (!userId || !backend.configured) {
        loadedDecks.current = null;
        loadedFingerprint.current = null;
        dispatch({ type: 'reset' });
        return;
      }

      // Paint the account's last-known decks before the network call. The
      // cache is keyed by user id, so signing out or switching account never
      // exposes another learner's generated decks.
      const cached = loadedDecks.current ? null : await readUserDecksCache(userId);
      if (request !== requestId.current) return;
      if (!loadedDecks.current && cached) {
        loadedDecks.current = cached.decks;
        loadedFingerprint.current = cached.fingerprint;
        dispatch({ type: 'loaded', decks: cached.decks });
      } else if (!loadedDecks.current && !quiet) {
        dispatch({ type: 'loading' });
      }

      try {
        const decks = await backend.userDecks.list();
        if (request !== requestId.current) return;
        const fingerprint = userDeckFingerprint(decks);
        const unchanged = cached
          ? cached.fingerprint === fingerprint
          : loadedFingerprint.current === fingerprint;
        loadedDecks.current = decks;
        loadedFingerprint.current = fingerprint;
        dispatch({ type: 'loaded', decks });
        if (!unchanged) {
          await writeUserDecksCache(userId, decks, fingerprint);
        }
      } catch (error) {
        if (request !== requestId.current) return;
        if (!loadedDecks.current && cached) {
          loadedDecks.current = cached.decks;
          loadedFingerprint.current = cached.fingerprint;
          dispatch({ type: 'loaded', decks: cached.decks });
        }
        dispatch({ type: 'error', error: toBackendError(error) });
      }
    },
    [userId],
  );

  useEffect(() => {
    requestId.current += 1;
    loadedDecks.current = null;
    loadedFingerprint.current = null;
    dispatch({ type: 'reset' });
    if (userId) void refresh();
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return;
    const onFocus = () => void refresh(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, refresh]);

  const upload = useCallback(
    async (record: LocalPluginRecord): Promise<ServiceResult<number>> => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to upload decks to the cloud.'));
      }
      if (record.decks.length === 0) {
        return fail(new BackendError('invalid-data', 'This plugin has no decks to upload.'));
      }

      dispatch({ type: 'busy', busy: true });
      try {
        // Validate every deck before the first write, so a multi-deck plugin
        // cannot leave a half-uploaded state.
        for (let index = 0; index < record.decks.length; index += 1) {
          validateDeck(record, index);
        }
        for (const deck of record.decks) {
          await backend.userDecks.upsert({
            clientKey: deck.key,
            pluginId: deck.pluginId,
            deckId: deck.id,
            title: deck.title,
            ...(deck.description ? { description: deck.description } : {}),
            tags: deck.tags,
            questions: deck.questions,
            examMinutes: deck.examMinutes ?? null,
            entrySource: record.entrySource,
          });
        }
        await refresh(true);
        return ok(record.decks.length);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [refresh, userId],
  );

  const remove = useCallback(
    async (id: string): Promise<ServiceResult> => {
      if (!userId) {
        return fail(new BackendError('unauthorized', 'Sign in to remove a cloud deck.'));
      }
      dispatch({ type: 'busy', busy: true });
      try {
        await backend.userDecks.remove(id);
        // Paint the deletion immediately. The follow-up refresh is authoritative,
        // but on an older database (missing `exam_minutes`) it can fail while the
        // delete itself succeeded; without this the row appeared to come back.
        dispatch({ type: 'removed', id });
        if (loadedDecks.current) {
          loadedDecks.current = loadedDecks.current.filter((deck) => deck.id !== id);
          const fingerprint = userDeckFingerprint(loadedDecks.current);
          loadedFingerprint.current = fingerprint;
          await writeUserDecksCache(userId, loadedDecks.current, fingerprint);
        }
        await refresh(true);
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      } finally {
        dispatch({ type: 'busy', busy: false });
      }
    },
    [refresh, userId],
  );

  const syncedKeys = useMemo(
    () => new Set(state.decks.map((deck) => deck.clientKey)),
    [state.decks],
  );

  const sources = useMemo(() => {
    const map = new Map<string, string>();
    for (const deck of state.decks) {
      if (deck.entrySource) map.set(deck.pluginId, deck.entrySource);
    }
    return map;
  }, [state.decks]);

  const actions = useMemo<UserDecksActions>(
    () => ({
      refresh: () => refresh(),
      upload,
      remove,
    }),
    [refresh, upload, remove],
  );

  const value = useMemo<UserDecksContextValue>(
    () => ({
      state,
      authenticated: Boolean(userId),
      syncedKeys,
      sources,
      actions,
    }),
    [state, userId, syncedKeys, sources, actions],
  );

  return <UserDecksContext.Provider value={value}>{children}</UserDecksContext.Provider>;
}

export function useUserDecks(): UserDecksContextValue {
  const context = useContext(UserDecksContext);
  if (!context) throw new Error('useUserDecks must be used inside UserDecksProvider');
  return context;
}
