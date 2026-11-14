import type { LocalizedText } from '@mengyin/core';
import { BackendError, toBackendError } from '../errors';
import type {
  OfficialCatalog,
  OfficialContentService,
  OfficialDeckPayload,
  OfficialManifest,
  OfficialPackPayload,
} from '../types';
import type { SupabaseClientLike } from './client';
import { isMissingColumn } from './compat';

const DECK_FIELDS =
  'id,pack_id,title,title_i18n,description,description_i18n,tags,questions,media_base_url,exam_minutes,version,published,sort_order,updated_at';
/** Pre-0.8.0 catalogue: exam length present, bilingual deck text unavailable. */
const DECK_FIELDS_NO_I18N =
  'id,pack_id,title,description,tags,questions,media_base_url,exam_minutes,version,published,sort_order,updated_at';
/** Pre-0.5.1 catalogue: decks load normally, with exam length estimated client-side. */
const DECK_FIELDS_LEGACY =
  'id,pack_id,title,description,tags,questions,media_base_url,version,published,sort_order,updated_at';

const PACK_FIELDS = 'id,name,version,description,author,tags,published,sort_order,updated_at';

interface DeckRow {
  id: string;
  pack_id: string;
  title: string;
  title_i18n?: unknown;
  description: string | null;
  description_i18n?: unknown;
  tags: string[] | null;
  questions: unknown;
  media_base_url: string | null;
  exam_minutes: number | null;
  version: string | null;
  published: boolean | null;
  sort_order: number | null;
  updated_at: string | null;
}

interface PackRow {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  author: string | null;
  tags: string[] | null;
  published: boolean | null;
  sort_order: number | null;
  updated_at: string | null;
  decks: DeckRow[];
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Accepts only a `{ en?, "zh-Hant"? }` object; anything else is ignored. */
function localizedTextOrUndefined(value: unknown): LocalizedText | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const en = textOrNull(record.en);
  const zh = textOrNull(record['zh-Hant']);
  if (!en && !zh) return undefined;
  return { ...(en ? { en } : {}), ...(zh ? { 'zh-Hant': zh } : {}) };
}

function tagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== ''))];
}

/** Only a positive whole number of minutes is a usable exam length. */
function examMinutesOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function mapDeck(row: DeckRow): OfficialDeckPayload {
  if (!row || typeof row.id !== 'string' || typeof row.title !== 'string') {
    throw new BackendError('invalid-data', 'Official deck row is missing id or title.');
  }
  const description = textOrNull(row.description);
  const examMinutes = examMinutesOrUndefined(row.exam_minutes);
  const titleI18n = localizedTextOrUndefined(row.title_i18n);
  const descriptionI18n = localizedTextOrUndefined(row.description_i18n);
  return {
    id: row.id,
    title: row.title,
    ...(titleI18n ? { titleI18n } : {}),
    ...(description ? { description } : {}),
    ...(descriptionI18n ? { descriptionI18n } : {}),
    tags: tagList(row.tags),
    questions: row.questions,
    mediaBaseUrl: textOrNull(row.media_base_url),
    ...(examMinutes === undefined ? {} : { examMinutes }),
    version: textOrNull(row.version) ?? '1',
    updatedAt: textOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function mapPack(row: PackRow): OfficialPackPayload {
  if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') {
    throw new BackendError('invalid-data', 'Official pack row is missing id or name.');
  }
  const decks = (Array.isArray(row.decks) ? row.decks : [])
    .filter((deck) => deck.published !== false)
    .map(mapDeck);
  const description = textOrNull(row.description);
  const author = textOrNull(row.author);

  return {
    id: row.id,
    name: row.name,
    version: textOrNull(row.version) ?? '1.0.0',
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    tags: tagList(row.tags),
    updatedAt: textOrNull(row.updated_at) ?? new Date(0).toISOString(),
    decks,
  };
}

export function mapCatalogRows(version: string, rows: unknown): OfficialCatalog {
  if (!Array.isArray(rows)) {
    throw new BackendError('invalid-data', 'Official catalogue response is not an array.');
  }
  return {
    version,
    packs: (rows as PackRow[]).filter((row) => row.published !== false).map(mapPack),
  };
}

export function createSupabaseOfficialService(client: SupabaseClientLike): OfficialContentService {
  async function getManifest(): Promise<OfficialManifest> {
    try {
      const { data, error } = await client
        .from('official_catalog_meta')
        .select('version,updated_at')
        .eq('id', true)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        throw new BackendError(
          'not-ready',
          'The official catalogue has no metadata row. Run the Supabase migrations first.',
        );
      }
      const row = data as { version?: unknown; updated_at?: unknown };
      if (row.version === null || row.version === undefined) {
        throw new BackendError('invalid-data', 'Catalogue version is missing.');
      }
      return {
        version: String(row.version),
        updatedAt: textOrNull(row.updated_at),
      };
    } catch (error) {
      throw toBackendError(error);
    }
  }

  return {
    getManifest,

    async getCatalog(version?: string): Promise<OfficialCatalog> {
      try {
        const loadDecks = (fields: string) =>
          client
            .from('official_decks')
            .select(fields)
            .eq('published', true)
            .order('sort_order', { ascending: true })
            .order('title', { ascending: true });

        const [packsResult, decksResult] = await Promise.all([
          client
            .from('official_packs')
            .select(PACK_FIELDS)
            .eq('published', true)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          loadDecks(DECK_FIELDS),
        ]);
        if (packsResult.error) throw packsResult.error;

        let decksData: unknown = decksResult.data;
        if (decksResult.error) {
          // A project still on an older migration should keep serving the
          // catalogue. Drop the newest optional columns one step at a time:
          // bilingual deck text first, then the authored exam length.
          const optional = ['title_i18n', 'description_i18n', 'exam_minutes'];
          let error = decksResult.error;
          if (!optional.some((column) => isMissingColumn(error, column))) throw error;

          let recovered = false;
          for (const fields of [DECK_FIELDS_NO_I18N, DECK_FIELDS_LEGACY]) {
            const retry = await loadDecks(fields);
            if (!retry.error) {
              decksData = retry.data;
              recovered = true;
              break;
            }
            error = retry.error;
            if (!optional.some((column) => isMissingColumn(error, column))) throw error;
          }
          if (!recovered) throw error;
        }

        const decksByPack = new Map<string, DeckRow[]>();
        for (const deck of (decksData ?? []) as DeckRow[]) {
          if (deck.published === false) continue;
          const list = decksByPack.get(deck.pack_id);
          if (list) list.push(deck);
          else decksByPack.set(deck.pack_id, [deck]);
        }
        for (const list of decksByPack.values()) {
          list.sort(
            (a, b) =>
              (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.title.localeCompare(b.title),
          );
        }

        const rows = ((packsResult.data ?? []) as Omit<PackRow, 'decks'>[]).map((pack) => ({
          ...pack,
          decks: decksByPack.get(pack.id) ?? [],
        }));
        const catalogVersion = version ?? (await getManifest()).version;
        return mapCatalogRows(catalogVersion, rows);
      } catch (error) {
        throw toBackendError(error);
      }
    },
  };
}
