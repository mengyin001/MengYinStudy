import { examMinutesForQuestions, type Deck, type Question, type QuestionMedia } from '@mengyin/core';
import {
  adaptDeck,
  parseDeckFile,
  parseDeckText,
  parseManifest,
  type Issue,
  type LoadedPlugin,
  type PluginContext,
  type PluginManifest,
  type PluginModule,
} from '@mengyin/plugin-sdk';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import { importers, questionTypes } from './registry';

export type LocalPluginOrigin = 'generated' | 'imported';

/** A plugin the user imported from a local folder, persisted in IndexedDB. */
export interface LocalPluginRecord {
  id: string;
  dir: string;
  manifest: PluginManifest;
  decks: Deck[];
  entrySource: string | null;
  importedAt: number;
  /** Generated decks are private to the signed-in account; imported ones stay local. */
  origin?: LocalPluginOrigin;
  /** The account that generated the deck, once known. */
  ownerId?: string;
}

/** Old records predate the origin field; AI plugin ids are a stable fallback. */
export function isGeneratedLocalPlugin(record: LocalPluginRecord): boolean {
  if (record.origin) return record.origin === 'generated';
  return record.id.startsWith('ai.') || record.decks.some((deck) => deck.pluginId.startsWith('ai.'));
}

/**
 * Generated decks are account content: signed out, they are never shown. Legacy
 * records without an owner can be claimed by the first account that signs in.
 */
export function canSeeLocalPlugin(record: LocalPluginRecord, userId: string | null): boolean {
  if (!isGeneratedLocalPlugin(record)) return true;
  if (!userId) return false;
  return !record.ownerId || record.ownerId === userId;
}

export interface PluginIssue extends Issue {
  pluginId: string;
  pluginName: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPluginContext(manifest: PluginManifest): PluginContext {
  return {
    manifest,
    registerQuestionType(definition) {
      if (!definition || typeof definition.id !== 'string' || !definition.id) {
        throw new Error('registerQuestionType 需要 id');
      }
      if (typeof definition.check !== 'function') {
        throw new Error(`題型 ${definition.id} 缺少 check() 函式`);
      }
      questionTypes.register(definition, manifest.id);
    },
    registerImporter(definition) {
      if (!definition || typeof definition.parse !== 'function') {
        throw new Error('registerImporter 需要 parse() 函式');
      }
      importers.register(definition, manifest.id);
    },
    log(...args) {
      // eslint-disable-next-line no-console
      console.info(`[plugin:${manifest.id}]`, ...args);
    },
    kv: {
      get: (key) => appStore.get(`${STORAGE_KEYS.pluginKvPrefix}${manifest.id}:${key}`),
      set: async (key, value) => {
        await appStore.set(`${STORAGE_KEYS.pluginKvPrefix}${manifest.id}:${key}`, value);
      },
    },
  };
}

/** Run a plugin's `activate()` hook and collect any issues it raises. */
export async function activateModule(
  manifest: PluginManifest,
  module: PluginModule | null,
): Promise<Issue[]> {
  if (!module?.activate) return [];
  try {
    await module.activate(createPluginContext(manifest));
    return [];
  } catch (error) {
    return [{ path: `${manifest.id}#activate`, message: messageOf(error) }];
  }
}

/** Load plugin code from source text (used for locally imported plugins). */
export async function importModuleFromSource(source: string): Promise<PluginModule> {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
    return (module.default ?? module) as PluginModule;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export function relativeFilePath(file: File): string {
  const withPath = file as File & { webkitRelativePath?: string };
  return (withPath.webkitRelativePath || file.name).replace(/\\/g, '/');
}

function joinRelative(prefix: string, file: string): string {
  const clean = file.replace(/^\.\//, '');
  return prefix ? `${prefix}/${clean}` : clean;
}

export interface LocalImportResult {
  record: LocalPluginRecord | null;
  issues: Issue[];
}

const IMAGE_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_TOTAL_BYTES = 8 * 1024 * 1024;

function imageExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('無法讀取圖片'));
    reader.readAsDataURL(file);
  });
}

/**
 * Imported folders keep their images in memory, not on a URL. Inline the files
 * a deck references so the deck renders locally and can be uploaded to another
 * device as plain JSON (data: URLs) without a second storage service.
 */
async function inlineDeckMedia(
  deck: Deck,
  prefix: string,
  paths: ReadonlyMap<string, File>,
): Promise<Deck> {
  const imageUrls = new Map<string, string>();
  let total = 0;
  for (const [path, file] of paths) {
    if (!IMAGE_EXTENSIONS.has(imageExtension(path)) || file.size > MAX_INLINE_IMAGE_BYTES) continue;
    if (total + file.size > MAX_INLINE_TOTAL_BYTES) break;
    total += file.size;
    try {
      imageUrls.set(path, await fileToDataUrl(file));
    } catch {
      // Leave the relative path in place; cloud upload will reject it.
    }
  }

  const resolve = (src: string): string => {
    if (/^(https:\/\/|data:)/i.test(src)) return src;
    const path = joinRelative(prefix, src.replace(/^\.\//, ''));
    return imageUrls.get(path) ?? src;
  };

  const rewrite = <T extends { media?: QuestionMedia[] }>(item: T): T =>
    item.media
      ? {
          ...item,
          media: item.media.map((media) =>
            media.type === 'figure' ? media : { ...media, src: resolve(media.src) },
          ),
        }
      : item;

  return {
    ...deck,
    questions: deck.questions.map((question) => {
      const next = rewrite(question);
      return {
        ...next,
        ...(next.options
          ? { options: next.options.map((option) => rewrite(option)) }
          : {}),
      };
    }),
  };
}

/** Import a plugin folder (manifest.json + deck JSON files). */
export async function localPluginFromFiles(files: File[]): Promise<LocalImportResult> {
  const issues: Issue[] = [];
  const paths = new Map(files.map((file) => [relativeFilePath(file), file]));
  const manifestEntry = [...paths.keys()].find((path) => path.split('/').length <= 2 && /manifest\.json$/i.test(path));
  if (!manifestEntry) {
    return { record: null, issues: [{ path: 'manifest.json', message: '資料夾內找不到 manifest.json' }] };
  }
  const manifestFile = paths.get(manifestEntry);
  if (!manifestFile) {
    return { record: null, issues: [{ path: manifestEntry, message: '無法讀取檔案' }] };
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await manifestFile.text());
  } catch {
    return { record: null, issues: [{ path: manifestEntry, message: '不是有效的 JSON' }] };
  }
  const parsed = parseManifest(rawManifest);
  if (!parsed.ok) {
    return {
      record: null,
      issues: parsed.issues.map((issue) => ({ path: `${manifestEntry} → ${issue.path}`, message: issue.message })),
    };
  }
  const manifest = parsed.value;
  const prefix = manifestEntry.includes('/') ? manifestEntry.slice(0, manifestEntry.lastIndexOf('/')) : '';
  const decks: Deck[] = [];

  for (const contentPath of manifest.content) {
    const file = paths.get(joinRelative(prefix, contentPath));
    if (!file) {
      issues.push({ path: contentPath, message: '找不到題庫檔案' });
      continue;
    }
    const result = parseDeckText(manifest.id, await file.text());
    if (result.deck) decks.push(await inlineDeckMedia(result.deck, prefix, paths));
    for (const issue of result.issues) {
      issues.push({ path: `${contentPath} → ${issue.path}`, message: issue.message });
    }
  }

  let entrySource: string | null = null;
  if (manifest.entry) {
    const file = paths.get(joinRelative(prefix, manifest.entry));
    if (file) entrySource = await file.text();
    else issues.push({ path: manifest.entry, message: '找不到插件程式碼' });
  }

  if (manifest.content.length === 0) {
    issues.push({ path: manifestEntry, message: 'content 為空，插件沒有任何題庫' });
  }

  const record: LocalPluginRecord = {
    id: manifest.id,
    dir: `local:${manifest.id}`,
    manifest,
    decks,
    entrySource,
    importedAt: Date.now(),
    origin: 'imported',
  };
  return { record, issues };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Wrap decks produced by a plugin importer into a local plugin record. */
export function localPluginFromDecks(raw: unknown, sourceName: string): LocalImportResult {
  const candidates = Array.isArray(raw) ? raw : [raw];
  const issues: Issue[] = [];
  const decks: Deck[] = [];
  const base = sourceName.replace(/\.[^.]+$/, '');
  const pluginId = `imported.${slugify(base) || 'deck'}`;

  for (const candidate of candidates) {
    const parsed = parseDeckFile(candidate);
    if (parsed.ok) decks.push(adaptDeck(pluginId, parsed.value));
    else for (const issue of parsed.issues) issues.push({ path: issue.path, message: issue.message });
  }
  if (decks.length === 0) return { record: null, issues };

  const manifest = parseManifest({
    schemaVersion: 1,
    id: pluginId,
    name: base,
    version: '1.0.0',
    description: `由 ${sourceName} 匯入（插件匯入器）`,
    tags: [],
    content: [],
  });
  if (!manifest.ok) return { record: null, issues: manifest.issues };

  return {
    record: {
      id: pluginId,
      dir: `local:${pluginId}`,
      manifest: manifest.value,
      decks,
      entrySource: null,
      importedAt: Date.now(),
      origin: 'imported',
    },
    issues,
  };
}

/** Wrap a deck produced by the AI generator as a local, removable plugin. */
export function localPluginFromGeneratedDeck(deck: Deck, ownerId?: string): LocalImportResult {
  const manifest = parseManifest({
    schemaVersion: 1,
    id: deck.pluginId,
    name: deck.title,
    version: '1.0.0',
    description: deck.description ?? 'AI-generated practice set',
    tags: deck.tags,
    content: [],
  });
  if (!manifest.ok) return { record: null, issues: manifest.issues };
  return {
    record: {
      id: deck.pluginId,
      dir: `local:${deck.pluginId}`,
      manifest: manifest.value,
      decks: [deck],
      entrySource: null,
      importedAt: Date.now(),
      origin: 'generated',
      ...(ownerId ? { ownerId } : {}),
    },
    issues: [],
  };
}

/** Import a single deck JSON file as a one-deck plugin. */
export function localPluginFromDeckText(text: string, fileName: string): LocalImportResult {
  const base = fileName.replace(/\.json$/i, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const id = `local.${slug || 'deck'}`;
  const parsed = parseDeckText(id, text);
  if (!parsed.deck) return { record: null, issues: parsed.issues };
  const deck = parsed.deck;
  const manifest = parseManifest({
    schemaVersion: 1,
    id,
    name: deck.title,
    version: '1.0.0',
    description: `由 ${fileName} 匯入`,
    tags: deck.tags,
    content: [],
  });
  if (!manifest.ok) return { record: null, issues: manifest.issues };
  return {
    record: {
      id,
      dir: `local:${id}`,
      manifest: manifest.value,
      decks: [deck],
      entrySource: null,
      importedAt: Date.now(),
      origin: 'imported',
    },
    issues: [],
  };
}

export function mergeLocalPlugins(
  existing: readonly LocalPluginRecord[],
  incoming: LocalPluginRecord,
): LocalPluginRecord[] {
  const filtered = existing.filter((record) => record.id !== incoming.id);
  return [...filtered, incoming].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'zh-Hant'));
}

export async function persistLocalPlugins(records: readonly LocalPluginRecord[]): Promise<void> {
  await appStore.set(STORAGE_KEYS.localPlugins, records);
}

export interface RemoveDeckResult {
  records: LocalPluginRecord[];
  removed: boolean;
}

/**
 * Remove one deck from the local records, dropping a record that no longer has
 * any decks. Pure so the delete path can be tested without React or IndexedDB.
 */
export function removeDeckFromLocalPlugins(
  records: readonly LocalPluginRecord[],
  key: string,
): RemoveDeckResult {
  let removed = false;
  const next = records.flatMap((record) => {
    if (!record.decks.some((deck) => deck.key === key)) return [record];
    removed = true;
    const decks = record.decks.filter((deck) => deck.key !== key);
    return decks.length > 0 ? [{ ...record, decks }] : [];
  });
  return { records: next, removed };
}

export interface LocalDeckEdit {
  /** New deck name, already trimmed by the caller. */
  title: string;
  /** Question ids to keep, in the order they should remain. */
  questionIds: readonly string[];
}

export interface UpdateLocalDeckResult {
  records: LocalPluginRecord[];
  updated: boolean;
}

/**
 * Apply a rename/question-prune to the local copy of a deck. Questions are
 * matched by id so every kept question keeps its original object (and inline
 * images); a generated one-deck plugin also follows its deck's new name.
 *
 * The caller is responsible for refusing an edit that would leave no questions:
 * such a deck is never written, because the deck schema requires at least one.
 */
export function updateDeckInLocalPlugins(
  records: readonly LocalPluginRecord[],
  key: string,
  edit: LocalDeckEdit,
): UpdateLocalDeckResult {
  let updated = false;
  const next = records.map((record) => {
    const index = record.decks.findIndex((deck) => deck.key === key);
    if (index < 0) return record;
    const deck = record.decks[index];
    if (!deck) return record;

    const byId = new Map(deck.questions.map((question) => [question.id, question]));
    const questions = edit.questionIds
      .map((id) => byId.get(id))
      .filter((question): question is Question => Boolean(question));
    if (questions.length === 0) return record;

    updated = true;
    const editedDeck: Deck = {
      ...deck,
      title: edit.title,
      questions,
      examMinutes: examMinutesForQuestions(questions),
    };
    const decks = record.decks.map((candidate, deckIndex) =>
      deckIndex === index ? editedDeck : candidate,
    );
    // The manifest is the plugin's display name. Generated plugins hold one
    // deck, so leaving the old name here made Decks show the previous title
    // beside the renamed deck.
    const manifest =
      isGeneratedLocalPlugin(record) && record.decks.length === 1
        ? { ...record.manifest, name: edit.title }
        : record.manifest;
    return { ...record, decks, manifest };
  });
  return { records: updated ? next : [...records], updated };
}

export async function loadPersistedLocalPlugins(): Promise<LocalPluginRecord[]> {
  const stored = await appStore.get<LocalPluginRecord[]>(STORAGE_KEYS.localPlugins);
  if (!Array.isArray(stored)) return [];
  return stored.filter((record) => record && typeof record.id === 'string' && Array.isArray(record.decks));
}

export function pluginIssues(plugin: LoadedPlugin): PluginIssue[] {
  return plugin.issues.map((issue) => ({
    ...issue,
    pluginId: plugin.manifest.id,
    pluginName: plugin.manifest.name,
  }));
}

export function resetPluginRegistries(): void {
  questionTypes.clear();
  importers.clear();
}
