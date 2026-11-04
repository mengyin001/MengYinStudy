import type { Question } from '@mengyin/core';
import { deckFileSchema } from '@mengyin/plugin-sdk';
import { BackendError, toBackendError } from '../errors';
import type { UserDeck, UserDeckInput, UserDeckService } from '../types';
import type { SupabaseClientLike } from './client';
import { isMissingColumn } from './compat';

const USER_DECK_COLUMNS =
  'id,client_key,plugin_id,deck_id,title,description,tags,questions,exam_minutes,entry_source,created_at,updated_at';
/** Pre-0.5.1 schema: the app still works, but exam length falls back to estimation. */
const USER_DECK_COLUMNS_LEGACY =
  'id,client_key,plugin_id,deck_id,title,description,tags,questions,entry_source,created_at,updated_at';

interface UserDeckRow {
  id: string;
  client_key: string;
  plugin_id: string;
  deck_id: string;
  title: string;
  description: string | null;
  tags: string[] | null;
  questions: unknown;
  exam_minutes: number | null;
  entry_source: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function tagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== ''))];
}

function invalidRow(message: string): never {
  throw new BackendError('invalid-data', message);
}


/** Map a PostgREST row and re-validate the JSON with the plugin deck schema. */
export function mapUserDeckRow(raw: unknown): UserDeck {
  const row = raw as Partial<UserDeckRow>;
  if (!row || typeof row.id !== 'string' || typeof row.client_key !== 'string') {
    invalidRow('Cloud deck row is missing its id or client key.');
  }
  const pluginId = typeof row.plugin_id === 'string' ? row.plugin_id : '';
  const deckId = typeof row.deck_id === 'string' ? row.deck_id : '';
  if (!pluginId || !deckId) invalidRow('Cloud deck row is missing its plugin or deck id.');

  const parsed = deckFileSchema.safeParse({
    id: deckId,
    title: row.title,
    description: row.description ?? undefined,
    tags: tagList(row.tags),
    questions: row.questions,
    ...(row.exam_minutes == null ? {} : { examMinutes: row.exam_minutes }),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    invalidRow(`Cloud deck "${String(row.title ?? deckId)}" is invalid: ${first?.message ?? 'bad data'}`);
  }

  if (row.client_key !== `${pluginId}::${deckId}`) {
    invalidRow('Cloud deck client key does not match its plugin/deck id.');
  }

  return {
    id: row.id,
    clientKey: row.client_key,
    pluginId,
    deckId,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    tags: parsed.data.tags,
    questions: parsed.data.questions as Question[],
    examMinutes: parsed.data.examMinutes ?? null,
    entrySource: textOrNull(row.entry_source),
    createdAt: textOrNull(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: textOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function validateInput(input: UserDeckInput): UserDeckInput {
  if (input.clientKey !== `${input.pluginId}::${input.deckId}`) {
    throw new BackendError('invalid-data', 'A deck client key must be pluginId::deckId.');
  }
  const parsed = deckFileSchema.safeParse({
    id: input.deckId,
    title: input.title,
    description: input.description,
    tags: input.tags,
    questions: input.questions,
    ...(input.examMinutes == null ? {} : { examMinutes: input.examMinutes }),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BackendError('invalid-data', `Deck is invalid: ${first?.message ?? 'bad data'}`);
  }
  if (JSON.stringify(parsed.data.questions).length > 8_000_000) {
    throw new BackendError('invalid-data', 'This deck is too large to upload (8 MB limit).');
  }
  const entrySource = input.entrySource?.trim() || null;
  if (entrySource && entrySource.length > 1_000_000) {
    throw new BackendError('invalid-data', 'The plugin module is too large to upload (1 MB limit).');
  }
  return {
    ...input,
    title: parsed.data.title,
    ...(parsed.data.description ? { description: parsed.data.description } : { description: undefined }),
    tags: parsed.data.tags,
    questions: parsed.data.questions as Question[],
    examMinutes: parsed.data.examMinutes ?? null,
    entrySource,
  };
}

export function createSupabaseUserDeckService(client: SupabaseClientLike): UserDeckService {
  return {
    async list(): Promise<UserDeck[]> {
      const read = async (columns: string): Promise<UserDeck[]> => {
        const { data, error } = await client
          .from('user_decks')
          .select(columns)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return (data ?? []).map(mapUserDeckRow);
      };

      try {
        return await read(USER_DECK_COLUMNS);
      } catch (error) {
        // The new web build can reach a project that has not run the 0.5.1
        // migration yet. Without this retry the cached list would look fine
        // while every refresh failed, so a deleted deck appeared to come back.
        if (!isMissingColumn(error, 'exam_minutes')) throw toBackendError(error);
        try {
          return await read(USER_DECK_COLUMNS_LEGACY);
        } catch (legacyError) {
          throw toBackendError(legacyError);
        }
      }
    },

    async upsert(input: UserDeckInput): Promise<UserDeck> {
      const valid = validateInput(input);
      try {
        // A plain upsert needs table-level UPDATE, which would also let a client
        // change owner/identity columns. Select-then-update keeps the column
        // grants narrow (owner and client key are insert-only).
        const existing = await client
          .from('user_decks')
          .select('id')
          .eq('client_key', valid.clientKey)
          .maybeSingle();
        if (existing.error) throw existing.error;

        const baseValues = {
          title: valid.title,
          description: valid.description ?? null,
          tags: valid.tags,
          questions: valid.questions,
          entry_source: valid.entrySource ?? null,
        };
        const write = async (
          values: typeof baseValues & { exam_minutes?: number | null },
          columns: string,
        ): Promise<UserDeck> => {
          const query = existing.data
            ? client.from('user_decks').update(values).eq('id', existing.data.id)
            : client.from('user_decks').insert({
                client_key: valid.clientKey,
                plugin_id: valid.pluginId,
                deck_id: valid.deckId,
                ...values,
              });
          const { data, error } = await query.select(columns).single();
          if (error) throw error;
          return mapUserDeckRow(data);
        };

        try {
          return await write(
            { ...baseValues, exam_minutes: valid.examMinutes ?? null },
            USER_DECK_COLUMNS,
          );
        } catch (error) {
          if (!isMissingColumn(error, 'exam_minutes')) throw error;
          // Pre-0.5.1 schema: upload the deck without its exam length.
          return await write(baseValues, USER_DECK_COLUMNS_LEGACY);
        }
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async remove(id: string): Promise<void> {
      try {
        const { error } = await client.from('user_decks').delete().eq('id', id);
        if (error) throw error;
      } catch (error) {
        throw toBackendError(error);
      }
    },
  };
}
