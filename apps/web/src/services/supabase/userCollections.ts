import { BackendError, toBackendError } from '../errors';
import type {
  UserCollection,
  UserCollectionInput,
  UserCollectionsService,
} from '../types';
import type { SupabaseClientLike } from './client';
import { isUniqueViolation } from './compat';

const COLLECTION_COLUMNS = 'client_id,name,description,deck_keys,created_at,updated_at';
const MAX_DECKS = 500;

interface UserCollectionRow {
  client_id: string;
  name: string;
  description: string | null;
  deck_keys: string[] | null;
  created_at: string | null;
  updated_at: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Trim, de-duplicate and bound a deck-key list coming from disk or the network. */
export function cleanCollectionDeckKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const key = item.trim();
    if (!key || key.length > 200) continue;
    if (!keys.includes(key)) keys.push(key);
    if (keys.length >= MAX_DECKS) break;
  }
  return keys;
}

function invalid(message: string): never {
  throw new BackendError('invalid-data', message);
}

export function mapUserCollectionRow(raw: unknown): UserCollection {
  const row = raw as Partial<UserCollectionRow> | null;
  if (!row || typeof row.client_id !== 'string' || !row.client_id.trim()) {
    invalid('Cloud collection row is missing its client id.');
  }
  if (typeof row.name !== 'string' || !row.name.trim()) {
    invalid('Cloud collection row is missing its name.');
  }
  return {
    id: row.client_id,
    name: row.name.trim(),
    description: textOrNull(row.description),
    deckKeys: cleanCollectionDeckKeys(row.deck_keys),
    createdAt: textOrNull(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: textOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function normalizeInput(input: UserCollectionInput): UserCollectionInput {
  const id = input.id.trim();
  if (!id || id.length > 128) invalid('A collection id must be 1–128 characters.');
  const name = input.name.trim();
  if (!name) invalid('A collection needs a name.');
  if (name.length > 80) invalid('A collection name must be 80 characters or fewer.');
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) {
    invalid('A collection description must be 2000 characters or fewer.');
  }
  const deckKeys = cleanCollectionDeckKeys(input.deckKeys);
  if (deckKeys.length !== input.deckKeys.length) {
    invalid('A collection contains duplicate or invalid deck keys.');
  }
  return { id, name, description, deckKeys };
}

function rowPayload(input: UserCollectionInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    deck_keys: input.deckKeys,
  };
}

export function createSupabaseUserCollectionService(
  client: SupabaseClientLike,
): UserCollectionsService {
  return {
    async list(): Promise<UserCollection[]> {
      try {
        const { data, error } = await client
          .from('user_collections')
          .select(COLLECTION_COLUMNS)
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return (data ?? []).map(mapUserCollectionRow);
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async upsert(input: UserCollectionInput): Promise<UserCollection> {
      const valid = normalizeInput(input);
      try {
        // Select-then-update keeps insert grants narrow (client_id is insert
        // only), matching the deck upload path.
        const existing = await client
          .from('user_collections')
          .select('client_id')
          .eq('client_id', valid.id)
          .maybeSingle();
        if (existing.error) throw existing.error;

        if (existing.data) {
          const updated = await client
            .from('user_collections')
            .update(rowPayload(valid))
            .eq('client_id', valid.id)
            .select(COLLECTION_COLUMNS)
            .single();
          if (updated.error) throw updated.error;
          return mapUserCollectionRow(updated.data);
        }

        const inserted = await client
          .from('user_collections')
          .insert({
            client_id: valid.id,
            ...rowPayload(valid),
          })
          .select(COLLECTION_COLUMNS)
          .single();
        if (!inserted.error) return mapUserCollectionRow(inserted.data);
        if (!isUniqueViolation(inserted.error)) throw inserted.error;

        // Another tab won the insert race; update the row that now exists.
        const retried = await client
          .from('user_collections')
          .update(rowPayload(valid))
          .eq('client_id', valid.id)
          .select(COLLECTION_COLUMNS)
          .single();
        if (retried.error) throw retried.error;
        return mapUserCollectionRow(retried.data);
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async remove(id: string): Promise<void> {
      const clientId = id.trim();
      if (!clientId) invalid('A collection id is required.');
      try {
        const { error } = await client
          .from('user_collections')
          .delete()
          .eq('client_id', clientId);
        if (error) throw error;
      } catch (error) {
        throw toBackendError(error);
      }
    },
  };
}
