import {
  addSession,
  addTime,
  advance,
  createId,
  createSession,
  currentItem,
  EMPTY_PROGRESS_FINGERPRINT,
  emptyProgress,
  examMinutesForQuestions,
  examTimeLimitMsForEntries,
  finishSession as engineFinish,
  goTo,
  gradeSession,
  isAnswered,
  learningFingerprint,
  mergeProgress,
  normalizeProgress,
  qualityFromStatus,
  recordAttempt,
  reviewCard,
  setDraftAnswer,
  setNote as engineSetNote,
  skipCurrent as engineSkip,
  submitAnswer as engineSubmit,
  summarize,
  toggleFlag as engineToggleFlag,
  toggleQuestionFlag as engineToggleProgressFlag,
  type Answer,
  type Attempt,
  type Deck,
  type Locale,
  type ProgressState,
  type QuestionEntry,
  type Session,
  type SessionSummary,
  type Settings,
  type StudyMode,
} from '@mengyin/core';
import { loadPluginsFromIndex, type LoadedPlugin } from '@mengyin/plugin-sdk';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  activateModule,
  importModuleFromSource,
  loadPersistedLocalPlugins,
  localPluginFromDeckText,
  localPluginFromDecks,
  localPluginFromFiles,
  localPluginFromGeneratedDeck,
  mergeLocalPlugins,
  persistLocalPlugins,
  canSeeLocalPlugin,
  isGeneratedLocalPlugin,
  removeDeckFromLocalPlugins,
  updateDeckInLocalPlugins,
  type LocalImportResult,
  type LocalPluginRecord,
  type PluginIssue,
} from '@/domain/pluginHost';
import { DEFAULT_AI_SETTINGS, loadAiSettings, normalizeAiSettings, saveAiSettings } from '@/ai/config';
import { ingestFiles, loadMaterials, saveMaterials, type IngestProgress } from '@/ai/materials';
import type { AiSettings, AiMaterial } from '@/ai/types';
import { prepareCodeAnswer, stripCodeRun } from '@/sandbox/codeRun';
import { gradeQuestion } from '@/domain/grading';
import { describeGiven } from '@/domain/answers';
import { createTranslator, type Translate } from '@/i18n/messages';
import {
  buildEntries,
  deckViews as buildDeckViews,
  editableDeckKeys as buildEditableDeckKeys,
  pluginViews as buildPluginViews,
  selectOfficialDecks,
  type DeckView,
  type PluginView,
} from '@/domain/library';
import { buildCloudPlugins } from '@/domain/cloud';
import { buildGuestPlugin, GUEST_PLUGIN_ID, isGuestDeckKey } from '@/domain/guest';
import { localizeDeck } from '@/domain/localize';
import { importers, questionTypes, registerBuiltinQuestionTypes } from '@/domain/registry';
import { appStore, downloadJson } from '@/lib/storage';
import { migrateLegacyProgress } from '@/lib/legacy';
import { applyAppearance, watchSystemTheme } from '@/lib/theme';
import { navigate } from '@/lib/router';
import { useOfficialContent } from './OfficialContentContext';
import { useUserDecks } from './UserDecksContext';
import { useUserLibrary } from './UserLibraryContext';
import {
  hasLearningRecord,
  loadScopeProgress,
  progressScopeFor,
  sameProgressScope,
  saveScopeProgress,
  type ProgressScope,
} from './progressScope';
import { backend } from '@/services';
import { collectUserMediaPaths, hasEmbeddedMedia } from '@/services/supabase/userMedia';
import { describeBackendError } from '@/i18n/backend';
import { useAuth } from './AuthContext';

registerBuiltinQuestionTypes();

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type ProgressSyncPhase = 'off' | 'syncing' | 'idle' | 'error';

export interface ProgressSyncStatus {
  phase: ProgressSyncPhase;
  lastSyncedAt: number | null;
  /** Raw backend message; the UI shows translated guidance around it. */
  error: string | null;
}

interface AppState {
  ready: boolean;
  progress: ProgressState;
  bundled: LoadedPlugin[];
  local: LocalPluginRecord[];
  issues: PluginIssue[];
  session: Session | null;
  summary: SessionSummary | null;
  toast: Toast | null;
  aiSettings: AiSettings;
  materials: AiMaterial[];
}

type Action =
  | {
      type: 'hydrate';
      progress: ProgressState;
      bundled: LoadedPlugin[];
      local: LocalPluginRecord[];
      issues: PluginIssue[];
      aiSettings: AiSettings;
      materials: AiMaterial[];
    }
  | { type: 'progress'; progress: ProgressState }
  | { type: 'local'; local: LocalPluginRecord[] }
  | { type: 'bundled'; bundled: LoadedPlugin[]; issues: PluginIssue[] }
  | { type: 'session'; session: Session | null }
  | { type: 'summary'; summary: SessionSummary | null }
  | { type: 'toast'; toast: Toast | null }
  | { type: 'aiSettings'; aiSettings: AiSettings }
  | { type: 'materials'; materials: AiMaterial[] };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        ready: true,
        progress: action.progress,
        bundled: action.bundled,
        local: action.local,
        issues: action.issues,
        aiSettings: action.aiSettings,
        materials: action.materials,
      };
    case 'progress':
      return { ...state, progress: action.progress };
    case 'local':
      return { ...state, local: action.local };
    case 'bundled':
      return { ...state, bundled: action.bundled, issues: action.issues };
    case 'session':
      return { ...state, session: action.session };
    case 'summary':
      return { ...state, summary: action.summary };
    case 'toast':
      return { ...state, toast: action.toast };
    case 'aiSettings':
      return { ...state, aiSettings: action.aiSettings };
    case 'materials':
      return { ...state, materials: action.materials };
    default:
      return state;
  }
}

const initialState: AppState = {
  ready: false,
  progress: emptyProgress(),
  bundled: [],
  local: [],
  issues: [],
  session: null,
  summary: null,
  toast: null,
  aiSettings: { ...DEFAULT_AI_SETTINGS },
  materials: [],
};

export interface StartSessionInput {
  mode: StudyMode;
  entries: QuestionEntry[];
  label?: string;
  limit?: number;
  timeLimitMs?: number | null;
}

export interface AppActions {
  startSession(input: StartSessionInput): void;
  /** Practice submission. Code questions run their tests before grading. */
  submit(answer: Answer, msSpent: number): Promise<void>;
  /** Exam mode: store the current answer without grading it. */
  setAnswer(answer: Answer): void;
  next(msSpent?: number): void;
  prev(msSpent?: number): void;
  jump(index: number, msSpent?: number): void;
  toggleFlagOnCurrent(): void;
  skipCurrent(msSpent: number): void;
  finishSession(msSpent?: number): void;
  exitSession(): void;
  toggleQuestionFlag(key: string): void;
  setQuestionNote(key: string, note: string): void;
  updateSettings(patch: Partial<Settings>): void;
  updateAiSettings(patch: Partial<AiSettings>): void;
  addMaterials(
    files: FileList | File[],
    onProgress?: (progress: IngestProgress) => void,
  ): Promise<{ added: number; errors: string[] }>;
  removeMaterial(id: string): Promise<void>;
  /** Delete every uploaded material after a successful generation. */
  clearMaterials(): Promise<void>;
  saveGeneratedDeck(deck: Deck): Promise<string | null>;
  /**
   * Rename an AI-generated deck and/or drop some of its questions. Kept
   * questions keep their ids, so their practice history stays attached.
   */
  updateDeck(
    key: string,
    edit: { title?: string; keepQuestionIds?: readonly string[] },
  ): Promise<boolean>;
  importPluginFiles(files: FileList | File[]): Promise<void>;
  removeLocalPlugin(id: string): Promise<void>;
  /** Remove one deck from wherever it lives: local, cloud or official library. */
  deleteDeck(key: string): Promise<boolean>;
  /** Remove several decks with one summary toast; used when deleting a collection. */
  deleteDecks(keys: readonly string[]): Promise<{ removed: number; failed: number }>;
  /** Remove a generated local copy after its cloud row is deleted. */
  forgetLocalDeck(key: string): Promise<void>;
  exportData(): void;
  importData(file: File): Promise<void>;
  resetProgress(): void;
  /** Pull the cloud record, merge it and push any local changes immediately. */
  syncNow(): void;
  reloadPlugins(): Promise<void>;
  notify(kind: Toast['kind'], message: string): void;
  dismissToast(): void;
}

interface AppContextValue {
  state: AppState;
  decks: Deck[];
  entries: QuestionEntry[];
  deckViews: DeckView[];
  plugins: PluginView[];
  pluginNames: Map<string, string>;
  locale: Locale;
  t: Translate;
  /** Deck keys that are always bundled for guests and cannot be deleted. */
  guestDeckKeys: ReadonlySet<string>;
  /** Deck keys that come from the official catalogue and were added by the user. */
  officialDeckKeys: ReadonlySet<string>;
  /** Deck keys backed by a private cloud row. */
  cloudDeckKeys: ReadonlySet<string>;
  /** Deck keys the learner may rename or prune (AI-generated decks only). */
  editableDeckKeys: ReadonlySet<string>;
  /** State of the automatic progress sync for the signed-in account. */
  sync: ProgressSyncStatus;
  findDeck(key: string): Deck | undefined;
  actions: AppActions;
}

const AppContext = createContext<AppContextValue | null>(null);

function pluginIssue(issue: { path: string; message: string }, pluginId: string, pluginName: string): PluginIssue {
  return { ...issue, pluginId, pluginName };
}

async function loadBundledPlugins(): Promise<{ plugins: LoadedPlugin[]; issues: PluginIssue[] }> {
  // Resolve against the document, not the JS bundle: dynamic import() of plugin
  // modules would otherwise resolve relative to /assets/.
  const base = new URL(`${import.meta.env.BASE_URL}plugins/`, document.baseURI).href;
  const reports = await loadPluginsFromIndex(base);
  const plugins: LoadedPlugin[] = [];
  const issues: PluginIssue[] = [];

  for (const report of reports) {
    const pluginId = report.plugin?.manifest.id ?? report.dir;
    const pluginName = report.plugin?.manifest.name ?? report.dir;
    for (const issue of report.issues) issues.push(pluginIssue(issue, pluginId, pluginName));
    if (!report.plugin) continue;
    plugins.push(report.plugin);
    if (report.plugin.module) {
      const activationIssues = await activateModule(report.plugin.manifest, report.plugin.module);
      for (const issue of activationIssues) {
        issues.push(pluginIssue(issue, report.plugin.manifest.id, report.plugin.manifest.name));
      }
    }
  }
  return { plugins, issues };
}

async function activateLocalPlugins(records: readonly LocalPluginRecord[]): Promise<PluginIssue[]> {
  const issues: PluginIssue[] = [];
  for (const record of records) {
    if (!record.entrySource) continue;
    try {
      const module = await importModuleFromSource(record.entrySource);
      const activationIssues = await activateModule(record.manifest, module);
      for (const issue of activationIssues) {
        issues.push(pluginIssue(issue, record.manifest.id, record.manifest.name));
      }
    } catch (error) {
      issues.push(
        pluginIssue(
          {
            path: `${record.dir}/entry`,
            message: `Plugin code failed to run: ${error instanceof Error ? error.message : String(error)}`,
          },
          record.manifest.id,
          record.manifest.name,
        ),
      );
    }
  }
  return issues;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { state: officialState } = useOfficialContent();
  const { state: cloudState, sources: cloudSources, actions: cloudActions } = useUserDecks();
  const { state: libraryState, actions: libraryActions } = useUserLibrary();
  const { state: authState, actions: authActions } = useAuth();
  const locale = state.progress.settings.locale;
  const guestPlugin = useMemo(() => buildGuestPlugin(), []);
  const cloudPlugins = useMemo(
    () => (authState.user ? buildCloudPlugins(cloudState.decks) : []),
    [authState.user, cloudState.decks],
  );
  const cloudDeckKeys = useMemo(
    () => new Set(cloudPlugins.flatMap((plugin) => plugin.decks.map((deck) => deck.key))),
    [cloudPlugins],
  );
  const editableDeckKeys = useMemo(
    () =>
      buildEditableDeckKeys(
        state.local,
        cloudPlugins.flatMap((plugin) => plugin.decks),
      ),
    [cloudPlugins, state.local],
  );
  // Official decks carry both languages; select the one the interface uses.
  // Re-localising from the canonical catalogue keeps switching idempotent.
  const officialDecks = useMemo(
    () =>
      selectOfficialDecks(officialState.packs, libraryState.refs).map((deck) =>
        localizeDeck(deck, locale),
      ),
    [officialState.packs, libraryState.refs, locale],
  );
  const officialDeckKeys = useMemo(
    () => new Set(officialDecks.map((deck) => deck.key)),
    [officialDecks],
  );
  const guestDeckKeys = useMemo(
    () => new Set(guestPlugin.decks.map((deck) => deck.key)),
    [guestPlugin],
  );
  const progressRef = useRef(state.progress);
  const sessionRef = useRef<Session | null>(null);
  const aiSettingsRef = useRef(state.aiSettings);
  const materialsRef = useRef(state.materials);
  const bootstrapped = useRef(false);
  const hydrated = useRef(false);
  const toastTimer = useRef<number | null>(null);
  const scopeRef = useRef<ProgressScope>({ kind: 'guest' });
  /** The identity a switch is heading to; set synchronously to survive rapid changes. */
  const targetScopeRef = useRef<ProgressScope>({ kind: 'guest' });
  const persistEnabled = useRef(false);
  const persistTimer = useRef<number | null>(null);
  const scopeSwitch = useRef(0);
  const activatedCloudSources = useRef(new Map<string, string>());
  const autoUploaded = useRef(new Set<string>());
  /**
   * Deck keys this tab deleted. They are hidden from the library and never
   * re-uploaded, so a stale list reply cannot put a deleted deck back on screen.
   */
  const [deletedKeys, setDeletedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const tombstone = useCallback((key: string) => {
    setDeletedKeys((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);
  const revive = useCallback((key: string) => {
    setDeletedKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);
  const [cloudRuntimeNonce, bumpCloudRuntime] = useState(0);

  // Progress sync. All guards are refs because timers, Realtime callbacks and
  // in-flight requests outlive the render that started them.
  const [syncStatus, setSyncStatus] = useState<ProgressSyncStatus>({
    phase: 'off',
    lastSyncedAt: null,
    error: null,
  });
  const syncUser = useRef<string | null>(null);
  const syncGeneration = useRef(0);
  const syncBase = useRef<string | null>(null);
  const syncBaseline = useRef<string | null>(null);
  const syncTimer = useRef<number | null>(null);
  const syncBusy = useRef(false);
  const syncQueued = useRef(false);
  const syncUnsubscribe = useRef<(() => void) | null>(null);
  const syncListeners = useRef<Array<() => void>>([]);
  const syncPoll = useRef<number | null>(null);
  const authUserId = useRef<string | null>(null);
  authUserId.current = authState.user?.id ?? null;

  useEffect(() => {
    aiSettingsRef.current = state.aiSettings;
  }, [state.aiSettings]);

  useEffect(() => {
    materialsRef.current = state.materials;
  }, [state.materials]);

  const t = useMemo(() => createTranslator(locale), [locale]);

  const cancelPendingWrite = useCallback(() => {
    if (persistTimer.current === null) return;
    window.clearTimeout(persistTimer.current);
    persistTimer.current = null;
  }, []);

  /** Write the active record now, e.g. before switching identity or on reset. */
  const persistNow = useCallback(
    (progress: ProgressState) => {
      cancelPendingWrite();
      if (!hydrated.current) return;
      return saveScopeProgress(appStore, scopeRef.current, progress);
    },
    [cancelPendingWrite],
  );

  const commitProgress = useCallback(
    (progress: ProgressState) => {
      progressRef.current = progress;
      dispatch({ type: 'progress', progress });
      if (!persistEnabled.current) return;
      const scope = scopeRef.current;
      cancelPendingWrite();
      persistTimer.current = window.setTimeout(() => {
        persistTimer.current = null;
        void saveScopeProgress(appStore, scope, progress);
      }, 450);
    },
    [cancelPendingWrite],
  );

  const commitSession = useCallback((session: Session | null) => {
    sessionRef.current = session;
    dispatch({ type: 'session', session });
  }, []);

  const clearSyncTimers = useCallback(() => {
    if (syncTimer.current !== null) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    if (syncPoll.current !== null) {
      window.clearInterval(syncPoll.current);
      syncPoll.current = null;
    }
  }, []);

  const stopSync = useCallback(() => {
    syncGeneration.current += 1;
    syncUser.current = null;
    syncBase.current = null;
    syncBaseline.current = null;
    syncBusy.current = false;
    syncQueued.current = false;
    clearSyncTimers();
    if (syncUnsubscribe.current) {
      syncUnsubscribe.current();
      syncUnsubscribe.current = null;
    }
    for (const remove of syncListeners.current.splice(0)) remove();
    setSyncStatus({ phase: 'off', lastSyncedAt: null, error: null });
  }, [clearSyncTimers]);

  /**
   * Pull the account's cloud record, merge it into the local one, then push the
   * result if the cloud is behind. The GET also makes a push conflict cheap to
   * recover from: a 0-row conditional update is re-read and re-merged.
   */
  const runSync = useCallback(
    async (quiet = false) => {
      const userId = syncUser.current;
      if (!userId || authUserId.current !== userId || !backend.configured) return;
      if (syncBusy.current) {
        syncQueued.current = true;
        return;
      }
      if (syncTimer.current !== null) {
        window.clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }

      const generation = syncGeneration.current;
      syncBusy.current = true;
      if (!quiet) setSyncStatus((current) => ({ ...current, phase: 'syncing', error: null }));

      try {
        const snapshot = await backend.userProgress.get();
        if (generation !== syncGeneration.current || syncUser.current !== userId) return;

        const local = progressRef.current;
        const remote = snapshot ? normalizeProgress(snapshot.progress) : null;
        let merged = remote ? mergeProgress(local, remote) : local;
        let mergedFingerprint = learningFingerprint(merged);
        const remoteFingerprint = remote ? learningFingerprint(remote) : null;

        if (mergedFingerprint !== learningFingerprint(local)) {
          // Record the merged fingerprint before committing so the progress
          // effect does not immediately queue another upload.
          syncBaseline.current = mergedFingerprint;
          commitProgress(merged);
        } else {
          syncBaseline.current = mergedFingerprint;
        }
        syncBase.current = snapshot?.updatedAt ?? null;

        if (mergedFingerprint === remoteFingerprint) {
          setSyncStatus({ phase: 'idle', lastSyncedAt: Date.now(), error: null });
          return;
        }
        if (!snapshot && mergedFingerprint === EMPTY_PROGRESS_FINGERPRINT) {
          // A new account with nothing to remember does not need an empty row.
          setSyncStatus({ phase: 'idle', lastSyncedAt: Date.now(), error: null });
          return;
        }

        let base = snapshot?.updatedAt ?? null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const result = await backend.userProgress.push(merged, base, userId);
          if (generation !== syncGeneration.current || syncUser.current !== userId) return;
          if (result) {
            syncBase.current = result.updatedAt;
            syncBaseline.current = mergedFingerprint;
            setSyncStatus({ phase: 'idle', lastSyncedAt: Date.now(), error: null });
            return;
          }

          // Another device wrote first. Re-read, merge with the *current* local
          // state (the learner may have answered while this was in flight), and
          // try again with the new base.
          const latest = await backend.userProgress.get();
          if (generation !== syncGeneration.current || syncUser.current !== userId) return;
          if (!latest) {
            base = null;
            continue;
          }
          const latestRemote = normalizeProgress(latest.progress);
          merged = mergeProgress(progressRef.current, latestRemote);
          mergedFingerprint = learningFingerprint(merged);
          if (mergedFingerprint !== learningFingerprint(progressRef.current)) {
            syncBaseline.current = mergedFingerprint;
            commitProgress(merged);
          } else {
            syncBaseline.current = mergedFingerprint;
          }
          base = latest.updatedAt;
        }

        setSyncStatus((current) => ({
          phase: 'error',
          lastSyncedAt: current.lastSyncedAt,
          error: 'Sync conflict',
        }));
      } catch (error) {
        if (generation !== syncGeneration.current || syncUser.current !== userId) return;
        setSyncStatus((current) => ({
          phase: 'error',
          lastSyncedAt: current.lastSyncedAt,
          error: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        if (generation === syncGeneration.current) {
          syncBusy.current = false;
          if (syncQueued.current) {
            syncQueued.current = false;
            void runSync(true);
          }
        }
      }
    },
    [commitProgress],
  );

  const startSync = useCallback(
    (userId: string) => {
      stopSync();
      const generation = ++syncGeneration.current;
      syncUser.current = userId;
      syncBase.current = null;
      syncBaseline.current = learningFingerprint(progressRef.current);
      setSyncStatus({ phase: 'syncing', lastSyncedAt: null, error: null });

      if (backend.configured) {
        try {
          syncUnsubscribe.current = backend.userProgress.subscribe(userId, () => {
            if (syncGeneration.current !== generation) return;
            void runSync(true);
          });
        } catch {
          // Polling and focus refresh still cover a Realtime failure.
        }
      }

      const refresh = () => {
        if (syncGeneration.current !== generation) return;
        if (document.visibilityState === 'hidden') return;
        void runSync(true);
      };
      const onVisibility = () => {
        if (document.visibilityState === 'visible') refresh();
      };
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
      document.addEventListener('visibilitychange', onVisibility);
      syncListeners.current.push(
        () => window.removeEventListener('focus', refresh),
        () => window.removeEventListener('online', refresh),
        () => document.removeEventListener('visibilitychange', onVisibility),
      );
      // Realtime is the fast path; this is the safety net for a dropped socket.
      syncPoll.current = window.setInterval(refresh, 20_000);

      void runSync();
    },
    [runSync, stopSync],
  );

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    dispatch({ type: 'toast', toast: { id: createId('toast'), kind, message } });
    toastTimer.current = window.setTimeout(() => dispatch({ type: 'toast', toast: null }), 3600);
  }, []);

  const dismissToast = useCallback(() => dispatch({ type: 'toast', toast: null }), []);

  // A cloud deck may carry the owner's single-file plugin module. Activate it
  // once so custom question types/importers are registered before practice.
  useEffect(() => {
    for (const plugin of cloudPlugins) {
      const source = cloudSources.get(plugin.manifest.id);
      if (!source || activatedCloudSources.current.get(plugin.manifest.id) === source) continue;
      activatedCloudSources.current.set(plugin.manifest.id, source);
      void importModuleFromSource(source)
        .then((module) => activateModule(plugin.manifest, module))
        .then((issues) => {
          for (const issue of issues) notify('error', issue.message);
          bumpCloudRuntime((value) => value + 1);
        })
        .catch((error: unknown) => {
          activatedCloudSources.current.delete(plugin.manifest.id);
          notify('error', `Cloud plugin "${plugin.manifest.id}": ${String(error)}`);
          bumpCloudRuntime((value) => value + 1);
        });
    }
  }, [cloudPlugins, cloudSources, notify]);

  // Old generated records predate ownerId. Claim them for the first account
  // that signs in, so a second account on the same browser cannot see them.
  useEffect(() => {
    const userId = authState.user?.id;
    if (!userId || !state.ready) return;
    const unowned = state.local.filter(
      (record) => isGeneratedLocalPlugin(record) && !record.ownerId,
    );
    if (unowned.length === 0) return;
    const next = state.local.map((record) =>
      unowned.includes(record) ? { ...record, ownerId: userId } : record,
    );
    dispatch({ type: 'local', local: next });
    void persistLocalPlugins(next);
  }, [authState.user, state.ready, state.local]);

  // A signed-in learner's decks belong on the server. Upload every local deck
  // that is not in the cloud list yet — generated decks and imported folders
  // alike. There is no separate "Upload" action in the UI.
  useEffect(() => {
    const userId = authState.user?.id;
    if (!userId) {
      autoUploaded.current.clear();
      setDeletedKeys((current) => (current.size === 0 ? current : new Set<string>()));
      return;
    }
    if (!state.ready || !cloudState.ready) return;
    const pending = state.local.filter(
      (record) =>
        canSeeLocalPlugin(record, userId) &&
        record.decks.length > 0 &&
        !record.decks.every((deck) => cloudDeckKeys.has(deck.key)) &&
        !autoUploaded.current.has(record.id),
    );
    if (pending.length === 0) return;

    void (async () => {
      for (const record of pending) {
        // A deck deleted in this tab may still be sitting in a local record; it
        // must not be uploaded again, or the deletion undoes itself.
        const remaining = record.decks.filter((deck) => !deletedKeys.has(deck.key));
        if (remaining.length === 0) continue;
        const payload =
          remaining.length === record.decks.length ? record : { ...record, decks: remaining };
        autoUploaded.current.add(record.id);
        const result = await cloudActions.upload(payload);
        if (!result.ok) {
          notify(
            'error',
            result.error.code === 'invalid-data'
              ? result.error.message
              : describeBackendError(result.error, t),
          );
        }
      }
    })();
  }, [
    authState.user,
    state.ready,
    state.local,
    cloudState.ready,
    cloudDeckKeys,
    cloudActions,
    deletedKeys,
    notify,
    t,
  ]);

  // A stored illustration can go missing: an earlier build deleted the Storage
  // objects of a deck whose row survived a refused delete, so the deck stayed in
  // the library with a dead image reference. When the local copy still holds the
  // inline image, re-save that deck — the object is written back at the same
  // path, which is exactly what the stored marker points at.
  const mediaRepaired = useRef(new Set<string>());
  useEffect(() => {
    if (!authState.user || !state.ready || !cloudState.ready) return;
    const localDecks = new Map<string, { record: LocalPluginRecord; deck: Deck }>();
    for (const record of state.local) {
      for (const deck of record.decks) localDecks.set(deck.key, { record, deck });
    }
    const candidates = cloudState.decks
      .map((cloud) => ({ cloud, paths: collectUserMediaPaths(cloud.questions) }))
      .filter(
        ({ cloud, paths }) =>
          paths.length > 0 &&
          !mediaRepaired.current.has(cloud.clientKey) &&
          localDecks.has(cloud.clientKey),
      );
    if (candidates.length === 0) return;

    void (async () => {
      for (const { cloud, paths } of candidates) {
        const source = localDecks.get(cloud.clientKey);
        if (!source || !hasEmbeddedMedia(source.deck.questions)) continue;
        let healthy = true;
        try {
          const signed = await backend.userMedia.signedUrls(paths);
          healthy = signed.size === paths.length;
        } catch {
          healthy = true;
        }
        if (healthy) continue;
        mediaRepaired.current.add(cloud.clientKey);
        const uploaded = await cloudActions.upload({ ...source.record, decks: [source.deck] });
        if (uploaded.ok) notify('info', t('toast.mediaRepaired'));
      }
    })();
  }, [
    authState.user,
    state.ready,
    state.local,
    cloudState.ready,
    cloudState.decks,
    cloudActions,
    notify,
    t,
  ]);

  const boot = useCallback(
    async (scope: ProgressScope, adoptGuest: boolean) => {
      const [progress, local, aiSettings, materials] = await Promise.all([
        loadScopeProgress(appStore, scope, { adoptGuest }),
        loadPersistedLocalPlugins(),
        loadAiSettings(),
        loadMaterials(),
      ]);
      scopeRef.current = scope;
      targetScopeRef.current = scope;
      progressRef.current = progress;
      hydrated.current = true;
      persistEnabled.current = true;
      if (adoptGuest) authActions.consumeNewAccount();

      const localIssues = await activateLocalPlugins(local);
      const { plugins, issues } = await loadBundledPlugins();
      dispatch({
        type: 'hydrate',
        progress,
        bundled: plugins,
        local,
        issues: [...issues, ...localIssues],
        aiSettings,
        materials,
      });
    },
    [authActions],
  );

  useEffect(() => {
    // Wait for auth before choosing a record: a restored session must load its
    // own progress, not the guest record.
    if (!authState.ready || bootstrapped.current) return;
    bootstrapped.current = true;
    const adoptGuest = authState.newAccount && authState.user !== null;
    void boot(progressScopeFor(authState.user?.id), adoptGuest);
  }, [authState.ready, authState.user, authState.newAccount, boot]);

  // A closed tab must not lose the last answer to the 450 ms local debounce.
  // IndexedDB writes are asynchronous, but starting one on pagehide is the best
  // effort available; the next boot uploads whatever was saved.
  useEffect(() => {
    const flush = () => {
      if (!hydrated.current || !persistEnabled.current) return;
      cancelPendingWrite();
      void saveScopeProgress(appStore, scopeRef.current, progressRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cancelPendingWrite]);

  // Stop the previous account's sync as soon as auth changes, before the scope
  // switch flushes anything. Starting waits until the new record is on screen.
  useEffect(() => {
    const userId = authState.user?.id ?? null;
    if (!userId) {
      if (syncUser.current) stopSync();
      return;
    }
    if (syncUser.current === userId) return;
    if (syncUser.current) stopSync();
    if (!state.ready || !hydrated.current) return;
    if (scopeRef.current.kind !== 'account' || scopeRef.current.userId !== userId) return;
    startSync(userId);
  }, [authState.user, state.ready, state.progress, startSync, stopSync]);

  // Local learning changes upload after a short pause. Settings changes do not
  // count: `learningFingerprint` ignores them.
  useEffect(() => {
    if (!state.ready || !syncUser.current) return;
    const fingerprint = learningFingerprint(state.progress);
    if (fingerprint === syncBaseline.current) return;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      syncTimer.current = null;
      void runSync();
    }, 800);
    return () => {
      if (syncTimer.current !== null) {
        window.clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
    };
  }, [state.progress, state.ready, runSync]);

  // Signing in or out switches the visible progress record. The account that is
  // being left is written immediately, then the next identity's record is read.
  // Stats never carry across identities; only a brand-new account created on
  // this browser adopts guest practice, and only once.
  useEffect(() => {
    if (!authState.ready || !state.ready || !hydrated.current) return;
    const next = progressScopeFor(authState.user?.id);
    if (sameProgressScope(next, targetScopeRef.current)) return;

    targetScopeRef.current = next;
    const token = ++scopeSwitch.current;
    const adoptGuest = authState.newAccount && next.kind === 'account';
    void (async () => {
      persistEnabled.current = false;
      const leaving = progressRef.current;
      await persistNow(leaving);
      if (token !== scopeSwitch.current) return;

      let loaded = await loadScopeProgress(appStore, next, { adoptGuest });
      if (token !== scopeSwitch.current) return;
      if (adoptGuest) authActions.consumeNewAccount();
      // Keep the language/theme the learner was using when the guest record is
      // empty; the record itself stays at zero.
      if (next.kind === 'guest' && !hasLearningRecord(loaded)) {
        loaded = { ...loaded, settings: leaving.settings };
      }

      scopeRef.current = next;
      progressRef.current = loaded;
      persistEnabled.current = true;
      dispatch({ type: 'progress', progress: loaded });
      commitSession(null);
      dispatch({ type: 'summary', summary: null });
      await saveScopeProgress(appStore, next, loaded);
    })();
  }, [
    authState.ready,
    authState.user,
    authState.newAccount,
    authActions,
    commitSession,
    persistNow,
    state.ready,
  ]);

  useEffect(() => {
    applyAppearance(state.progress.settings.theme, state.progress.settings.fontScale, locale);
    if (state.progress.settings.theme !== 'system') return;
    return watchSystemTheme(() => applyAppearance('system', state.progress.settings.fontScale, locale));
  }, [state.progress.settings.theme, state.progress.settings.fontScale, locale]);

  const finalize = useCallback(
    (session: Session) => {
      const summary = summarize(session);
      dispatch({ type: 'summary', summary });
      commitProgress(addSession(progressRef.current, summary));
    },
    [commitProgress],
  );

  const startSession = useCallback(
    (input: StartSessionInput) => {
      if (input.entries.length === 0) {
        notify('info', t('toast.nothing'));
        return;
      }
      const isExam = input.mode === 'exam';
      const created = createSession({
        mode: input.mode,
        entries: input.entries,
        ...(input.label ? { label: input.label } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
        ...(input.timeLimitMs !== undefined
          ? { timeLimitMs: input.timeLimitMs }
          : isExam
            ? { timeLimitMs: examTimeLimitMsForEntries(input.entries, input.limit) }
            : {}),
        reveal: input.mode !== 'exam',
        requeueMissed: input.mode === 'drill',
      });
      commitSession(created);
      dispatch({ type: 'summary', summary: null });
      navigate('/practice');
    },
    [commitSession, notify, t],
  );

  const submit = useCallback(
    async (answer: Answer, msSpent: number) => {
      const session = sessionRef.current;
      if (!session) return;
      const item = currentItem(session);
      if (!item || item.result) return;
      const question = item.entry.question;

      let finalAnswer = answer;
      if (question.type === 'code') {
        if (!isAnswered(answer, question)) {
          notify('info', t('toast.answerFirst'));
          return;
        }
        if (session.mode === 'exam') {
          // Defensive: exam submission goes through finishExam, never here.
          notify('error', t('code.examLocked'));
          return;
        }
        try {
          finalAnswer = await prepareCodeAnswer(question, answer);
        } catch (error) {
          notify(
            'error',
            t('toast.codeRunFailed', {
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          return;
        }
        // The learner may have navigated away while the sandbox ran.
        const live = sessionRef.current;
        if (!live || live.id !== session.id) return;
        const liveItem = currentItem(live);
        if (!liveItem || liveItem.entry.key !== item.entry.key || liveItem.result) return;
      }

      const result = gradeQuestion(question, finalAnswer);
      if (result.status === 'pending') {
        notify('info', t('toast.answerFirst'));
        return;
      }
      const next = engineSubmit(session, finalAnswer, msSpent, gradeQuestion);
      commitSession(next);

      const now = Date.now();
      const attempt: Attempt = {
        id: createId('att'),
        questionKey: item.entry.key,
        questionId: question.id,
        deckKey: item.entry.deck.key,
        pluginId: item.entry.deck.pluginId,
        sessionId: session.id,
        mode: session.mode,
        at: now,
        msSpent: Math.max(0, msSpent),
        status: result.status,
        ratio: result.ratio,
        skipped: false,
        given: describeGiven(question, finalAnswer, t),
      };
      const card = reviewCard(progressRef.current.cards[item.entry.key], qualityFromStatus(result.status, msSpent), now);
      commitProgress(recordAttempt(progressRef.current, { attempt, card }, now));
    },
    [commitProgress, commitSession, notify, t],
  );

  const setAnswer = useCallback(
    (answer: Answer) => {
      const session = sessionRef.current;
      if (!session) return;
      const item = currentItem(session);
      if (!item) return;
      const clean =
        item.entry.question.type === 'code' ? (stripCodeRun(answer) ?? answer) : answer;
      commitSession(setDraftAnswer(session, session.index, clean));
    },
    [commitSession],
  );

  /** Close an exam: grade every draft, record the attempts, then summarise. */
  const finishExam = useCallback(
    (session: Session) => {
      const now = Date.now();
      // Exams are answer-only: never carry a code run into marking.
      const sanitized: Session = {
        ...session,
        items: session.items.map((item) =>
          item.entry.question.type === 'code' ? { ...item, answer: stripCodeRun(item.answer) } : item,
        ),
      };
      const graded = gradeSession(sanitized, gradeQuestion, now);
      commitSession(graded);

      let progress = progressRef.current;
      for (const item of graded.items) {
        if (!item.answer || !item.result || item.result.status === 'pending') continue;
        const attempt: Attempt = {
          id: createId('att'),
          questionKey: item.entry.key,
          questionId: item.entry.question.id,
          deckKey: item.entry.deck.key,
          pluginId: item.entry.deck.pluginId,
          sessionId: graded.id,
          mode: graded.mode,
          at: now,
          msSpent: item.msSpent,
          status: item.result.status,
          ratio: item.result.ratio,
          skipped: item.skipped,
          given: describeGiven(item.entry.question, item.answer, t),
        };
        const card = reviewCard(progress.cards[item.entry.key], qualityFromStatus(item.result.status, item.msSpent), now);
        progress = recordAttempt(progress, { attempt, card }, now);
      }
      commitProgress(progress);
      finalize(graded);
    },
    [commitProgress, commitSession, finalize],
  );

  const next = useCallback(
    (msSpent = 0) => {
      const current = sessionRef.current;
      if (!current) return;
      const session = addTime(current, current.index, msSpent);
      if (session.mode === 'exam' && session.index + 1 >= session.items.length) {
        finishExam(session);
        return;
      }
      const advanced = advance(session, Date.now());
      commitSession(advanced);
      if (advanced.finished) finalize(advanced);
    },
    [commitSession, finalize, finishExam],
  );

  const prev = useCallback(
    (msSpent = 0) => {
      const current = sessionRef.current;
      if (!current) return;
      const session = addTime(current, current.index, msSpent);
      commitSession(goTo(session, session.index - 1));
    },
    [commitSession],
  );

  const jump = useCallback(
    (index: number, msSpent = 0) => {
      const current = sessionRef.current;
      if (!current) return;
      const session = addTime(current, current.index, msSpent);
      commitSession(goTo(session, index));
    },
    [commitSession],
  );

  const toggleFlagOnCurrent = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    commitSession(engineToggleFlag(session));
  }, [commitSession]);

  const skip = useCallback(
    (msSpent: number) => {
      const session = sessionRef.current;
      if (!session) return;
      commitSession(engineSkip(session, msSpent));
    },
    [commitSession],
  );

  const finishSession = useCallback(
    (msSpent = 0) => {
      const current = sessionRef.current;
      if (!current) return;
      const session = addTime(current, current.index, msSpent);
      if (session.mode === 'exam') {
        finishExam(session);
        return;
      }
      const finished = engineFinish(session, Date.now());
      commitSession(finished);
      finalize(finished);
    },
    [commitSession, finalize, finishExam],
  );

  const exitSession = useCallback(() => {
    commitSession(null);
    dispatch({ type: 'summary', summary: null });
    navigate('/');
  }, [commitSession]);

  const toggleQuestionFlag = useCallback(
    (key: string) => {
      commitProgress(engineToggleProgressFlag(progressRef.current, key, Date.now()));
    },
    [commitProgress],
  );

  const setQuestionNote = useCallback(
    (key: string, note: string) => {
      commitProgress(engineSetNote(progressRef.current, key, note));
    },
    [commitProgress],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      const progress = progressRef.current;
      commitProgress({ ...progress, settings: { ...progress.settings, ...patch }, updatedAt: Date.now() });
    },
    [commitProgress],
  );

  const updateAiSettings = useCallback(
    (patch: Partial<AiSettings>) => {
      if (!authState.user) {
        notify('info', t('gen.engineSignIn'));
        return;
      }
      const next = normalizeAiSettings({ ...aiSettingsRef.current, ...patch });
      aiSettingsRef.current = next;
      dispatch({ type: 'aiSettings', aiSettings: next });
      void saveAiSettings(next);
    },
    [authState.user, notify, t],
  );

  const addMaterials = useCallback(
    async (files: FileList | File[], onProgress?: (progress: IngestProgress) => void) => {
      const list = Array.from(files);
      if (list.length === 0) return { added: 0, errors: [] };
      const result = await ingestFiles(materialsRef.current, list, {
        ...(onProgress ? { onProgress } : {}),
      });
      if (result.added.length > 0) {
        const next = [...materialsRef.current, ...result.added];
        materialsRef.current = next;
        dispatch({ type: 'materials', materials: next });
        await saveMaterials(next);
        notify('success', t('toast.materialsAdded', { n: result.added.length }));
      }
      for (const error of result.errors) notify('error', error);
      return { added: result.added.length, errors: result.errors };
    },
    [notify, t],
  );

  const removeMaterial = useCallback(
    async (id: string) => {
      const next = materialsRef.current.filter((material) => material.id !== id);
      materialsRef.current = next;
      dispatch({ type: 'materials', materials: next });
      await saveMaterials(next);
      notify('info', t('toast.materialRemoved'));
    },
    [notify, t],
  );

  const clearMaterials = useCallback(async () => {
    if (materialsRef.current.length === 0) return;
    materialsRef.current = [];
    dispatch({ type: 'materials', materials: [] });
    await saveMaterials([]);
    notify('info', t('toast.materialsCleared'));
  }, [notify, t]);

  const saveGeneratedDeck = useCallback(
    async (deck: Deck) => {
      const userId = authState.user?.id;
      if (!userId) {
        notify('info', t('toast.saveNeedsLogin'));
        return null;
      }
      const { record, issues } = localPluginFromGeneratedDeck(deck, userId);
      if (!record) {
        for (const issue of issues) notify('error', `${issue.path}: ${issue.message}`);
        return null;
      }
      const local = mergeLocalPlugins(state.local, record);
      // Claim the record before the local write is persisted: the automatic
      // uploader runs on the next render and would otherwise upload the same
      // deck twice, and the loser of that race failed with a duplicate key.
      autoUploaded.current.add(record.id);
      dispatch({ type: 'local', local });
      await persistLocalPlugins(local);
      // An explicit save always wins over an earlier delete of the same key.
      revive(deck.key);
      const uploaded = await cloudActions.upload(record);
      if (!uploaded.ok) {
        notify(
          'error',
          t('toast.deckSaveUploadFailed', {
            message:
              uploaded.error.code === 'invalid-data'
                ? uploaded.error.message
                : describeBackendError(uploaded.error, t),
          }),
        );
        // Keep the draft on screen so a quota/MIME/network failure can be
        // retried after the cause is fixed. The local copy stays too and is
        // replaced when the retry succeeds.
        return null;
      }
      notify('success', t('toast.deckGenerated', { name: deck.title }));
      return record.id;
    },
    [authState.user, cloudActions, notify, state.local, t],
  );

  const importPluginFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const single = list.length === 1 ? list[0] : undefined;
      const extension = single ? `.${single.name.split('.').pop()?.toLowerCase() ?? ''}` : '';
      const importerEntry = single
        ? importers.list().find(({ item }) => item.accept.some((accept) => accept.toLowerCase() === extension))
        : undefined;

      let result: LocalImportResult;
      if (single && importerEntry && !single.webkitRelativePath) {
        try {
          const payload = importerEntry.item.parse(await single.text(), single.name);
          result = localPluginFromDecks(payload, single.name);
        } catch (error) {
          notify(
            'error',
            t('toast.importFailed', { message: error instanceof Error ? error.message : String(error) }),
          );
          return;
        }
      } else if (single && extension === '.json' && !single.webkitRelativePath) {
        result = localPluginFromDeckText(await single.text(), single.name);
      } else {
        result = await localPluginFromFiles(list);
      }

      for (const issue of result.issues) {
        notify('error', `${issue.path}: ${issue.message}`);
      }
      if (!result.record) {
        if (result.issues.length === 0) notify('error', t('toast.unrecognised'));
        return;
      }

      if (result.record.entrySource) {
        const activationIssues = await activateLocalPlugins([result.record]);
        for (const issue of activationIssues) notify('error', issue.message);
      }

      const local = mergeLocalPlugins(state.local, result.record);
      dispatch({ type: 'local', local });
      await persistLocalPlugins(local);
      // Re-importing the same id after a delete must upload again.
      for (const deck of result.record.decks) revive(deck.key);
      autoUploaded.current.delete(result.record.id);
      notify('success', t('toast.imported', { name: result.record.manifest.name }));
    },
    [notify, state.local, t],
  );

  const removeLocalPlugin = useCallback(
    async (id: string) => {
      const record = state.local.find((candidate) => candidate.id === id);
      if (record) {
        const keys = new Set(record.decks.map((deck) => deck.key));
        for (const cloudDeck of cloudState.decks) {
          if (!keys.has(cloudDeck.clientKey)) continue;
          const removed = await cloudActions.remove(cloudDeck.id, cloudDeck.clientKey);
          if (!removed.ok) {
            notify('error', describeBackendError(removed.error, t));
            return;
          }
        }
        for (const key of keys) tombstone(key);
      }
      const local = state.local.filter((candidate) => candidate.id !== id);
      dispatch({ type: 'local', local });
      await persistLocalPlugins(local);
      autoUploaded.current.delete(id);
      questionTypes.removeByPlugin(id);
      importers.removeByPlugin(id);
      notify('info', t('toast.removed'));
    },
    [cloudActions, cloudState.decks, notify, state.local, t],
  );

  /** Drop a deck's local copy. Used after the cloud row or the deck itself is deleted. */
  const forgetLocalDeck = useCallback(
    async (key: string) => {
      // Even if the local record cannot be found, the uploader must not bring
      // this key back.
      tombstone(key);
      const result = removeDeckFromLocalPlugins(state.local, key);
      if (!result.removed) return;
      dispatch({ type: 'local', local: result.records });
      await persistLocalPlugins(result.records);
      const kept = new Set(result.records.map((record) => record.id));
      for (const record of state.local) {
        if (kept.has(record.id)) continue;
        autoUploaded.current.delete(record.id);
        questionTypes.removeByPlugin(record.id);
        importers.removeByPlugin(record.id);
      }
    },
    [state.local],
  );

  const exportData = useCallback(() => {
    const exportedLocal = state.local.filter((record) =>
      canSeeLocalPlugin(record, authState.user?.id ?? null),
    );
    downloadJson(`mengyin-study-backup-${new Date().toISOString().slice(0, 10)}.json`, {
      app: 'mengyin-study',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      progress: progressRef.current,
      localPlugins: exportedLocal,
    });
    notify('success', t('settings.exported'));
  }, [authState.user, notify, state.local, t]);

  const importData = useCallback(
    async (file: File) => {
      try {
        const raw: unknown = JSON.parse(await file.text());
        const container = raw as { progress?: unknown; localPlugins?: unknown };
        const imported = migrateLegacyProgress(normalizeProgress(container.progress ?? raw));
        // An explicit import is a replacement: bump the epoch so it wins over
        // copies already in the cloud, then let the sync push it.
        const progress = {
          ...imported,
          epoch: Math.max(imported.epoch, progressRef.current.epoch ?? 0) + 1,
        };
        commitProgress(progress);
        commitSession(null);
        dispatch({ type: 'summary', summary: null });
        await persistNow(progress);
        void runSync();
        if (Array.isArray(container.localPlugins)) {
          const incoming = container.localPlugins as LocalPluginRecord[];
          let merged = state.local;
          for (const record of incoming) {
            if (!record || typeof record.id !== 'string' || !Array.isArray(record.decks)) continue;
            merged = mergeLocalPlugins(merged, record);
          }
          dispatch({ type: 'local', local: merged });
          await persistLocalPlugins(merged);
        }
        notify('success', t('settings.imported'));
      } catch (error) {
        notify(
          'error',
          t('toast.backupInvalid', { message: error instanceof Error ? error.message : String(error) }),
        );
      }
    },
    [commitProgress, commitSession, notify, persistNow, runSync, state.local, t],
  );

  const resetProgress = useCallback(() => {
    // A higher epoch replaces every device's record instead of merging the old
    // attempts back in.
    const epoch = (progressRef.current.epoch ?? 0) + 1;
    const settings = progressRef.current.settings;
    const fresh = { ...emptyProgress(), epoch, settings };
    commitProgress(fresh);
    commitSession(null);
    dispatch({ type: 'summary', summary: null });
    void persistNow(fresh);
    void runSync();
    notify('info', t('settings.resetDone'));
  }, [commitProgress, commitSession, notify, persistNow, runSync, t]);

  const syncNow = useCallback(() => {
    if (!syncUser.current) return;
    void runSync();
  }, [runSync]);

  const reloadPlugins = useCallback(async () => {
    questionTypes.clear();
    importers.clear();
    registerBuiltinQuestionTypes();
    const localIssues = await activateLocalPlugins(state.local);
    const { plugins, issues } = await loadBundledPlugins();
    dispatch({ type: 'bundled', bundled: plugins, issues: [...issues, ...localIssues] });
    notify('success', t('toast.reloaded', { n: plugins.length }));
  }, [notify, state.local, t]);

  // A synced official pack replaces the bundled snapshot with the same id.
  const effectiveBundled = useMemo(() => {
    const officialIds = new Set(officialState.packs.map((plugin) => plugin.manifest.id));
    const remaining = state.bundled.filter((plugin) => !officialIds.has(plugin.manifest.id));
    return [...remaining, ...officialState.packs];
  }, [state.bundled, officialState.packs]);

  // Generated decks are account content. Signed out (or owned by another
  // account) only imported local decks are visible; cloud rows are fetched by
  // UserDecksProvider and cached per account.
  const visibleLocal = useMemo(
    () =>
      state.local.filter(
        (record) =>
          canSeeLocalPlugin(record, authState.user?.id ?? null) &&
          (record.decks.length === 0 || !record.decks.every((deck) => cloudDeckKeys.has(deck.key))),
      ),
    [state.local, cloudDeckKeys, authState.user],
  );

  const decks = useMemo<Deck[]>(() => {
    const localDecks = visibleLocal.flatMap((record) => record.decks);
    const cloudDecks = cloudPlugins.flatMap((plugin) => plugin.decks);
    // Guest decks are always available. Official decks appear only after the
    // learner adds them in the Plaza, and a cloud copy replaces the matching
    // local deck so the same deck is never shown twice.
    return [
      ...guestPlugin.decks,
      ...officialDecks,
      ...localDecks.filter((deck) => !cloudDeckKeys.has(deck.key)),
      ...cloudDecks,
      // A deck deleted in this tab stays gone even if a list reply that started
      // before the delete arrives afterwards.
    ].filter((deck) => !deletedKeys.has(deck.key));
  }, [guestPlugin, officialDecks, visibleLocal, cloudPlugins, cloudDeckKeys, deletedKeys]);

  const pluginNames = useMemo(() => {
    const names = new Map<string, string>();
    names.set(GUEST_PLUGIN_ID, guestPlugin.manifest.name);
    for (const plugin of effectiveBundled) names.set(plugin.manifest.id, plugin.manifest.name);
    for (const record of visibleLocal) names.set(record.id, record.manifest.name);
    for (const plugin of cloudPlugins) names.set(plugin.manifest.id, plugin.manifest.name);
    return names;
  }, [guestPlugin, effectiveBundled, visibleLocal, cloudPlugins]);

  const entries = useMemo(() => buildEntries(decks), [decks]);

  const views = useMemo(() => buildDeckViews(decks, state.progress), [decks, state.progress]);

  const typeOwners = useMemo(() => {
    const owners = new Map<string, string>();
    for (const { item, pluginId } of questionTypes.list()) {
      if (pluginId !== 'builtin') owners.set(item.id, pluginId);
    }
    return owners;
  }, [state.bundled, state.local, cloudRuntimeNonce]);

  const plugins = useMemo(
    () => buildPluginViews(state.bundled, visibleLocal, typeOwners, officialState.packs, cloudPlugins),
    [state.bundled, visibleLocal, officialState.packs, cloudPlugins, typeOwners],
  );

  const findDeck = useCallback((key: string) => decks.find((deck) => deck.key === key), [decks]);

  const updateDeck = useCallback(
    async (
      key: string,
      edit: { title?: string; keepQuestionIds?: readonly string[] },
    ): Promise<boolean> => {
      const deck = decks.find((candidate) => candidate.key === key);
      if (!deck) {
        notify('info', t('toast.deckNotFound'));
        return false;
      }
      if (!authState.user || !editableDeckKeys.has(key)) {
        notify('info', t('toast.deckNotEditable'));
        return false;
      }

      const title = (edit.title ?? deck.title).trim();
      if (!title) {
        notify('error', t('toast.deckTitleRequired'));
        return false;
      }
      // A generated plugin's manifest name is capped at 80 characters by the
      // plugin schema, so the deck name stays inside the same budget.
      if (title.length > 80) {
        notify('error', t('toast.deckTitleTooLong'));
        return false;
      }

      const keepIds = [
        ...new Set(edit.keepQuestionIds ?? deck.questions.map((question) => question.id)),
      ];
      const byId = new Map(deck.questions.map((question) => [question.id, question]));
      const questions = keepIds
        .map((id) => byId.get(id))
        .filter((question): question is Deck['questions'][number] => Boolean(question));
      if (questions.length === 0) {
        notify('error', t('toast.deckNeedsQuestion'));
        return false;
      }

      const unchanged =
        title === deck.title &&
        questions.length === deck.questions.length &&
        questions.every((question, index) => question.id === deck.questions[index]?.id);
      if (unchanged) return true;

      const nextDeck: Deck = {
        ...deck,
        title,
        questions,
        examMinutes: examMinutesForQuestions(questions),
      };

      // The cloud row is the authoritative copy for a signed-in learner. Write
      // it first so a failure leaves the old deck visible instead of a local
      // edit that the cloud copy would immediately hide again.
      let cloudSaved = false;
      if (backend.configured) {
        const saved = await cloudActions.update(nextDeck);
        if (!saved.ok) {
          notify('error', describeBackendError(saved.error, t));
          return false;
        }
        cloudSaved = true;
      }

      const local = updateDeckInLocalPlugins(state.local, key, {
        title,
        questionIds: questions.map((question) => question.id),
      });
      if (local.updated) {
        // The local write is already on the server. Claim the record so the
        // automatic uploader does not race a second copy of the same edit out
        // before the refreshed cloud list notices the row.
        if (cloudSaved) {
          const record = local.records.find((item) => item.decks.some((deck) => deck.key === key));
          if (record) autoUploaded.current.add(record.id);
        }
        dispatch({ type: 'local', local: local.records });
        // The cloud copy is already updated and shown; a failed local cache
        // write must not turn a successful edit into an error.
        await persistLocalPlugins(local.records).catch(() => undefined);
      }
      notify('success', t('toast.deckUpdated', { name: title }));
      return true;
    },
    [authState.user, cloudActions, decks, editableDeckKeys, notify, state.local, t],
  );

  /**
   * Remove a deck from the learner's library. The source decides what is
   * deleted: a cloud row, an official-library reference, or a local record.
   * Bundled guest decks are permanent; progress is deliberately retained.
   */
  const deleteDeckInternal = useCallback(
    async (key: string, quiet: boolean): Promise<boolean> => {
      const deck = decks.find((candidate) => candidate.key === key);
      const name = deck?.title ?? key;

      if (isGuestDeckKey(key)) {
        if (!quiet) notify('info', t('toast.guestDeckLocked'));
        return false;
      }

      const cloudRecord = cloudState.decks.find((record) => record.clientKey === key);
      if (cloudRecord) {
        // Claim the key before the request: the automatic uploader must not
        // re-create the deck while the delete is still in flight.
        tombstone(key);
        const result = await cloudActions.remove(cloudRecord.id, key);
        if (!result.ok) {
          revive(key);
          if (!quiet) {
            notify(
              'error',
              result.error.code === 'forbidden'
                ? t('toast.deckDeleteBlocked')
                : describeBackendError(result.error, t),
            );
          }
          return false;
        }
        // The row is gone; a local copy left behind would be re-uploaded by the
        // automatic uploader and the deck would reappear.
        await forgetLocalDeck(key);
        if (!quiet) notify('success', t('toast.deckDeleted', { name }));
        return true;
      }

      const ref = libraryState.refs.find((item) => `${item.packId}::${item.deckId}` === key);
      if (ref) {
        const result = await libraryActions.remove(ref.packId, ref.deckId);
        if (!result.ok) {
          if (!quiet) notify('error', describeBackendError(result.error, t));
          return false;
        }
        if (!quiet) notify('success', t('toast.deckDeleted', { name }));
        return true;
      }

      const local = removeDeckFromLocalPlugins(state.local, key);
      if (local.removed) {
        dispatch({ type: 'local', local: local.records });
        await persistLocalPlugins(local.records);
        const kept = new Set(local.records.map((record) => record.id));
        for (const record of state.local) {
          if (kept.has(record.id)) continue;
          autoUploaded.current.delete(record.id);
          questionTypes.removeByPlugin(record.id);
          importers.removeByPlugin(record.id);
        }
        if (!quiet) notify('success', t('toast.deckDeleted', { name }));
        return true;
      }

      if (!quiet) notify('info', t('toast.deckNotFound'));
      return false;
    },
    [
      decks,
      notify,
      t,
      cloudState.decks,
      cloudActions,
      forgetLocalDeck,
      libraryState.refs,
      libraryActions,
      state.local,
    ],
  );

  const deleteDeck = useCallback(
    (key: string) => deleteDeckInternal(key, false),
    [deleteDeckInternal],
  );

  const deleteDecks = useCallback(
    async (keys: readonly string[]) => {
      const unique = [...new Set(keys)];
      let removed = 0;
      let failed = 0;
      for (const key of unique) {
        if (await deleteDeckInternal(key, true)) removed += 1;
        else failed += 1;
      }
      if (removed > 0) notify('success', t('toast.decksDeleted', { n: removed }));
      if (failed > 0) notify('error', t('toast.decksDeleteFailed', { n: failed }));
      return { removed, failed };
    },
    [deleteDeckInternal, notify, t],
  );

  // A deck can disappear after sign-out (generated decks are account content)
  // or after a deletion. Close the practice session rather than leaving its
  // questions on screen.
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const visible = new Set(decks.map((deck) => deck.key));
    if (!session.items.some((item) => !visible.has(item.entry.deck.key))) return;
    commitSession(null);
    dispatch({ type: 'summary', summary: null });
    navigate('/');
  }, [decks, commitSession]);

  const actions = useMemo<AppActions>(
    () => ({
      startSession,
      submit,
      setAnswer,
      next,
      prev,
      jump,
      toggleFlagOnCurrent,
      skipCurrent: skip,
      finishSession,
      exitSession,
      toggleQuestionFlag,
      setQuestionNote,
      updateSettings,
      updateAiSettings,
      addMaterials,
      removeMaterial,
      clearMaterials,
      saveGeneratedDeck,
      updateDeck,
      importPluginFiles,
      removeLocalPlugin,
      deleteDeck,
      deleteDecks,
      forgetLocalDeck,
      exportData,
      importData,
      resetProgress,
      syncNow,
      reloadPlugins,
      notify,
      dismissToast,
    }),
    [
      startSession,
      submit,
      setAnswer,
      next,
      prev,
      jump,
      toggleFlagOnCurrent,
      skip,
      finishSession,
      exitSession,
      toggleQuestionFlag,
      setQuestionNote,
      updateSettings,
      updateAiSettings,
      addMaterials,
      removeMaterial,
      clearMaterials,
      saveGeneratedDeck,
      updateDeck,
      importPluginFiles,
      removeLocalPlugin,
      deleteDeck,
      deleteDecks,
      forgetLocalDeck,
      exportData,
      importData,
      resetProgress,
      syncNow,
      reloadPlugins,
      notify,
      dismissToast,
    ],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      decks,
      entries,
      deckViews: views,
      plugins,
      pluginNames,
      locale,
      t,
      guestDeckKeys,
      officialDeckKeys,
      cloudDeckKeys,
      editableDeckKeys,
      sync: syncStatus,
      findDeck,
      actions,
    }),
    [
      state,
      decks,
      entries,
      views,
      plugins,
      pluginNames,
      locale,
      t,
      guestDeckKeys,
      officialDeckKeys,
      cloudDeckKeys,
      editableDeckKeys,
      syncStatus,
      findDeck,
      actions,
      cloudRuntimeNonce,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
