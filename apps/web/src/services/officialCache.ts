/**
 * Official catalogue snapshot in IndexedDB.
 *
 * The cache is written only after every deck has passed the plugin zod schema,
 * and read back through the same schema. A corrupt or half-written cache falls
 * back to the bundled snapshot instead of breaking the app.
 */
import type { Deck } from '@mengyin/core';
import {
  adaptDeck,
  parseDeckFile,
  parseManifest,
  type LoadedPlugin,
  type PluginManifest,
} from '@mengyin/plugin-sdk';
import { appStore, STORAGE_KEYS, type KeyValueStore } from '@/lib/storage';

export interface CachedOfficialPack {
  manifest: PluginManifest;
  decks: Deck[];
  updatedAt: string;
}

/**
 * A loaded official pack. `updatedAt` comes from the catalogue row and is kept
 * on the loaded object so the Plaza can show when a pack last changed without
 * another request.
 */
export interface OfficialPack extends LoadedPlugin {
  updatedAt: string;
}

export interface OfficialCache {
  schemaVersion: 1;
  /** Project the cache came from, so switching Supabase projects cannot reuse it. */
  sourceUrl: string | null;
  version: string;
  syncedAt: number;
  packs: CachedOfficialPack[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Re-validates a cached pack. `adaptDeck` is deliberately run again: it
 * normalises tags and keeps absolute image URLs, so a cache written by an older
 * app version still satisfies the current schema.
 */
function parseCachedPack(raw: unknown): CachedOfficialPack | null {
  if (!isRecord(raw)) return null;
  if (!isRecord(raw.manifest) || !Array.isArray(raw.decks)) return null;
  const parsedManifest = parseManifest({ ...raw.manifest, content: [] });
  if (!parsedManifest.ok) return null;
  const manifest = parsedManifest.value;

  const decks: Deck[] = [];
  for (const candidate of raw.decks) {
    const parsedDeck = parseDeckFile(candidate);
    if (!parsedDeck.ok) return null;
    const deck = adaptDeck(manifest.id, parsedDeck.value);
    if (!decks.some((existing) => existing.id === deck.id)) decks.push(deck);
  }
  if (decks.length === 0) return null;

  return {
    manifest,
    decks,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

export function parseOfficialCache(raw: unknown): OfficialCache | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== 1) return null;
  if (typeof raw.version !== 'string' || !raw.version) return null;
  if (typeof raw.syncedAt !== 'number' || !Number.isFinite(raw.syncedAt)) return null;
  if (!Array.isArray(raw.packs)) return null;

  const packs: CachedOfficialPack[] = [];
  for (const candidate of raw.packs) {
    const pack = parseCachedPack(candidate);
    if (!pack) return null;
    if (packs.some((existing) => existing.manifest.id === pack.manifest.id)) return null;
    packs.push(pack);
  }

  return {
    schemaVersion: 1,
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : null,
    version: raw.version,
    syncedAt: raw.syncedAt,
    packs,
  };
}

export function cacheToLoadedPlugins(cache: OfficialCache): OfficialPack[] {
  return cache.packs.map((pack) => ({
    dir: `official:${pack.manifest.id}`,
    manifest: pack.manifest,
    decks: pack.decks,
    module: null,
    entryUrl: null,
    issues: [],
    updatedAt: pack.updatedAt,
  }));
}

export async function readOfficialCache(
  store: KeyValueStore = appStore,
): Promise<OfficialCache | null> {
  const raw = await store.get<unknown>(STORAGE_KEYS.officialContent);
  return parseOfficialCache(raw);
}

export async function writeOfficialCache(
  cache: OfficialCache,
  store: KeyValueStore = appStore,
): Promise<void> {
  await store.set(STORAGE_KEYS.officialContent, cache);
}

export async function clearOfficialCache(store: KeyValueStore = appStore): Promise<void> {
  await store.remove(STORAGE_KEYS.officialContent);
}
