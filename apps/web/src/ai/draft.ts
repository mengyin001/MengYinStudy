import type { AiQuestionResult } from '@mengyin/ai-contract';
import { appStore } from '../lib/storage';

const DRAFT_KEY = 'mengyin-generate-draft:v1';
const TAB_KEY = 'mengyin-generate-tab:v1';
const DRAFT_IDB_PREFIX = 'mengyin-generate-draft:v1:';
/** Keep well below the usual 5 MB sessionStorage quota. */
const FULL_DRAFT_LIMIT = 3_800_000;

/**
 * The live result is also kept in module memory. A route change unmounts the
 * Generate page, so sessionStorage alone would force a large illustrated deck
 * through its 5 MB limit and drop the pictures. IndexedDB carries the same
 * result across a reload; the sessionStorage copy remains the quick fallback.
 */
let memoryDraft: AiQuestionResult | null = null;
/** True when memoryDraft came from a full save, not a stripped session copy. */
let memoryComplete = false;

interface SavedDraft {
  version: 1;
  savedAt: number;
  result: AiQuestionResult;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function tabId(): string {
  const store = storage();
  if (!store) return 'default';
  try {
    const existing = store.getItem(TAB_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    store.setItem(TAB_KEY, created);
    return created;
  } catch {
    return 'default';
  }
}

function draftKey(): string {
  return `${DRAFT_IDB_PREFIX}${tabId()}`;
}

function isResult(value: unknown): value is AiQuestionResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AiQuestionResult>;
  return Boolean(
    item.deck &&
      typeof item.deck === 'object' &&
      Array.isArray(item.deck.questions) &&
      Array.isArray(item.warnings) &&
      item.usage &&
      item.engine &&
      item.images,
  );
}

/**
 * Illustrations are base64 data URLs and can easily exceed sessionStorage.
 * Figures are tiny specs and storage markers are references, so only inline
 * bitmaps are dropped; the questions stay.
 */
export function stripIllustrations(result: AiQuestionResult): AiQuestionResult {
  let hadImages = false;
  const keep = <T extends { type: string; src?: string }>(media: T): boolean => {
    if (media.type === 'figure') return true;
    return typeof media.src === 'string' && !media.src.startsWith('data:image/') && !/^\s*<svg[\s>]/i.test(media.src);
  };
  const questions = result.deck.questions.map((question) => {
    const keptMedia = question.media?.filter((item) => keep(item));
    const keptOptions = question.options?.map((option) =>
      option.media ? { ...option, media: option.media.filter((item) => keep(item)) } : option,
    );
    const mediaChanged = Boolean(question.media && keptMedia && keptMedia.length !== question.media.length);
    const optionsChanged = Boolean(
      question.options?.some((option, index) => {
        const before = option.media?.length ?? 0;
        const after = keptOptions?.[index]?.media?.length ?? 0;
        return before !== after;
      }),
    );
    if (!mediaChanged && !optionsChanged) return question;
    hadImages = true;
    return {
      ...question,
      ...(mediaChanged
        ? keptMedia && keptMedia.length > 0
          ? { media: keptMedia }
          : { media: undefined }
        : {}),
      ...(optionsChanged ? { options: keptOptions } : {}),
    };
  });
  if (!hadImages) return result;
  const alreadyWarned = result.warnings.some((warning) => warning.code === 'storage');
  return {
    ...result,
    deck: { ...result.deck, questions },
    warnings: alreadyWarned
      ? result.warnings
      : [
          ...result.warnings,
          {
            code: 'storage',
            message:
              'Illustrations were too large to keep when switching pages; the questions were kept.',
          },
        ],
  };
}

/** Load the in-memory or tab-scoped draft. A new tab starts empty. */
export function loadDraft(): AiQuestionResult | null {
  if (memoryDraft) return memoryDraft;
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedDraft>;
    if (parsed.version !== 1 || !isResult(parsed.result)) {
      store.removeItem(DRAFT_KEY);
      return null;
    }
    memoryDraft = parsed.result;
    memoryComplete = false;
    return parsed.result;
  } catch {
    try {
      store.removeItem(DRAFT_KEY);
    } catch {
      // Storage may be blocked; ignoring it is the only safe option.
    }
    return null;
  }
}

/**
 * Read the full illustrated draft from IndexedDB. The synchronous
 * `loadDraft()` copy exists for the first paint; this one restores the pictures
 * that the 5 MB sessionStorage fallback cannot hold.
 */
export async function hydrateDraft(): Promise<AiQuestionResult | null> {
  if (memoryDraft && memoryComplete) return memoryDraft;
  try {
    const saved = await appStore.get<SavedDraft>(draftKey());
    if (saved?.version === 1 && isResult(saved.result)) {
      memoryDraft = saved.result;
      memoryComplete = true;
      return saved.result;
    }
  } catch {
    // IndexedDB is best-effort; the session copy still has the questions.
  }
  return memoryDraft;
}

export type SaveDraftOutcome = 'saved' | 'stripped' | 'unavailable';

export function saveDraft(result: AiQuestionResult, slim = false): SaveDraftOutcome {
  const store = storage();
  if (!store) return 'unavailable';

  memoryDraft = result;
  memoryComplete = true;
  const durable = appStore.kind === 'indexeddb';
  // The full result, pictures included, goes to IndexedDB. This is what makes
  // a route change and a reload keep the illustrations.
  void appStore.set(draftKey(), {
    version: 1,
    savedAt: Date.now(),
    result,
  } satisfies SavedDraft);

  const write = (candidate: AiQuestionResult): boolean => {
    try {
      const payload: SavedDraft = { version: 1, savedAt: Date.now(), result: candidate };
      const text = JSON.stringify(payload);
      if (!slim && text.length > FULL_DRAFT_LIMIT) return false;
      store.setItem(DRAFT_KEY, text);
      return true;
    } catch {
      return false;
    }
  };

  const first = slim ? stripIllustrations(result) : result;
  if (write(first)) {
    if (durable) return 'saved';
    return slim && first !== result ? 'stripped' : 'saved';
  }
  if (first !== result) return durable ? 'saved' : 'unavailable';

  const stripped = stripIllustrations(result);
  if (stripped !== result && write(stripped)) return durable ? 'saved' : 'stripped';
  return durable ? 'saved' : 'unavailable';
}

export function clearDraft(): void {
  memoryDraft = null;
  memoryComplete = false;
  void appStore.remove(draftKey());
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    // Storage may be blocked; nothing else to clear.
  }
}
