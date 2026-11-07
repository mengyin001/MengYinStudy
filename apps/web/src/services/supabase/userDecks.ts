import type { Question } from '@mengyin/core';
import { deckFileSchema } from '@mengyin/plugin-sdk';
import { BackendError, toBackendError } from '../errors';
import type { UserDeck, UserDeckInput, UserDeckService } from '../types';
import type { SupabaseClientLike } from './client';
import { isMissingColumn, isUniqueViolation } from './compat';
import {
  collectUserMediaPaths,
  prepareQuestionsForStorage,
  USER_MEDIA_BUCKET,
} from './userMedia';

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
  // Embedded data URLs are uploaded to Storage before the row is written, so
  // the 8 MB check belongs to the prepared JSON (see upsert), not to the input.
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
      const session = await client.auth.getSession();
      const userId = session.data.session?.user.id;
      if (!userId) {
        throw new BackendError('unauthorized', 'Sign in to upload decks to the cloud.');
      }

      let uploadedPaths: string[] = [];
      let oldPaths: string[] = [];
      /** Set once the row is committed; from then on its objects are live. */
      let saved: UserDeck | null = null;
      try {
        // A plain upsert needs table-level UPDATE, which would also let a client
        // change owner/identity columns. Select-then-update keeps the column
        // grants narrow (owner and client key are insert-only).
        let existing = await client
          .from('user_decks')
          .select('id,questions')
          .eq('client_key', valid.clientKey)
          .maybeSingle();
        if (existing.error) throw existing.error;
        if (existing.data) oldPaths = collectUserMediaPaths(existing.data.questions as Question[]);

        const prepared = await prepareQuestionsForStorage(
          client,
          userId,
          valid.deckId,
          valid.questions,
          oldPaths,
        );
        uploadedPaths = prepared.uploaded;
        if (JSON.stringify(prepared.questions).length > 8_000_000) {
          throw new BackendError('invalid-data', 'This deck is too large to upload (8 MB limit).');
        }

        const baseValues = {
          title: valid.title,
          description: valid.description ?? null,
          tags: valid.tags,
          questions: prepared.questions,
          entry_source: valid.entrySource ?? null,
        };
        const write = async (
          values: typeof baseValues & { exam_minutes?: number | null },
          columns: string,
        ): Promise<UserDeck> => {
          if (existing.data) {
            const { data, error } = await client
              .from('user_decks')
              .update(values)
              .eq('id', existing.data.id)
              .select(columns)
              .single();
            if (error) throw error;
            return mapUserDeckRow(data);
          }

          const inserted = await client
            .from('user_decks')
            .insert({
              client_key: valid.clientKey,
              plugin_id: valid.pluginId,
              deck_id: valid.deckId,
              ...values,
            })
            .select(columns)
            .single();
          if (!inserted.error) return mapUserDeckRow(inserted.data);
          if (!isUniqueViolation(inserted.error)) throw inserted.error;

          // Another writer won the race — the automatic uploader saving the same
          // deck at the same moment, or a second tab. The row exists now, so the
          // insert becomes an update instead of failing the whole save.
          existing = await client
            .from('user_decks')
            .select('id,questions')
            .eq('client_key', valid.clientKey)
            .maybeSingle();
          if (existing.error || !existing.data) throw inserted.error;
          const { data, error } = await client
            .from('user_decks')
            .update(values)
            .eq('id', existing.data.id)
            .select(columns)
            .single();
          if (error) throw error;
          return mapUserDeckRow(data);
        };

        let written: UserDeck | null = null;
        try {
          written = await write(
            { ...baseValues, exam_minutes: valid.examMinutes ?? null },
            USER_DECK_COLUMNS,
          );
        } catch (error) {
          if (!isMissingColumn(error, 'exam_minutes')) throw error;
          // Pre-0.5.1 schema: upload the deck without its exam length.
          written = await write(baseValues, USER_DECK_COLUMNS_LEGACY);
        }
        saved = written;

        // Replacing a deck may remove an image or change its content. Delete
        // objects that the new row no longer references; this also returns the
        // bytes to the account's 30 MB budget.
        const stale = oldPaths.filter((path) => !prepared.paths.includes(path));
        if (stale.length > 0) {
          await client.storage.from(USER_MEDIA_BUCKET).remove(stale).catch(() => undefined);
        }
        if (!saved) throw new BackendError('server', 'The deck was not saved.');
        return saved;
      } catch (error) {
        // Only a row that never committed leaves its uploads unreachable. Once
        // the row is written those objects are live, and deleting them here is
        // what left a deck in the library with a dead image reference.
        if (saved === null) {
          const orphaned = uploadedPaths.filter((path) => !oldPaths.includes(path));
          if (orphaned.length > 0) {
            await client.storage.from(USER_MEDIA_BUCKET).remove(orphaned).catch(() => undefined);
          }
        }
        throw toBackendError(error);
      }
    },

    async remove(id: string, clientKey?: string): Promise<void> {
      try {
        const existing = await client
          .from('user_decks')
          .select('id,questions')
          .eq('id', id)
          .maybeSingle();
        if (existing.error) throw existing.error;
        let paths = existing.data
          ? collectUserMediaPaths(existing.data.questions as Question[])
          : [];

        // A DELETE that matches nothing still returns 204, so the affected row
        // count is the only proof the deck is really gone. Without it a stale id
        // (the row was re-created on another device, or the client was painting
        // from its cache) removed the deck from the screen and then the next
        // refresh brought it straight back.
        const byId = await client.from('user_decks').delete().eq('id', id).select('id');
        if (byId.error) throw byId.error;
        let deleted = byId.data?.length ?? 0;

        if (deleted === 0 && clientKey) {
          // The stable key still identifies the deck even when the id moved.
          if (paths.length === 0) {
            const byKeyRow = await client
              .from('user_decks')
              .select('id,questions')
              .eq('client_key', clientKey)
              .maybeSingle();
            if (byKeyRow.data) {
              paths = collectUserMediaPaths(byKeyRow.data.questions as Question[]);
            }
          }
          const byKey = await client
            .from('user_decks')
            .delete()
            .eq('client_key', clientKey)
            .select('id');
          if (byKey.error) throw byKey.error;
          deleted = byKey.data?.length ?? 0;
        }

        if (deleted === 0) {
          // Nothing was deleted. If the row is still visible to this account the
          // delete was refused (a stale session or a policy mismatch), and the
          // caller must not report success. An invisible row is already gone.
          const still = await client.from('user_decks').select('id').eq('id', id);
          if (still.error) throw still.error;
          if ((still.data ?? []).length > 0) {
            throw new BackendError(
              'forbidden',
              'The server did not delete this deck. Sign out and back in, then try again.',
            );
          }
        }

        // Best effort: the row is gone, so a Storage hiccup must not make the
        // deck reappear in the UI. Orphaned objects can be swept later.
        if (paths.length > 0) {
          await client.storage.from(USER_MEDIA_BUCKET).remove(paths).catch(() => undefined);
        }
      } catch (error) {
        throw toBackendError(error);
      }
    },
  };
}
