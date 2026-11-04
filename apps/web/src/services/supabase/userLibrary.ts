import { BackendError, toBackendError } from '../errors';
import type { OfficialDeckRef, UserLibraryService } from '../types';
import type { SupabaseClientLike } from './client';

const LIBRARY_COLUMNS = 'pack_id,deck_id,added_at';

interface LibraryRow {
  pack_id: string;
  deck_id: string;
  added_at: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function mapOfficialDeckRef(raw: unknown): OfficialDeckRef {
  const row = raw as Partial<LibraryRow>;
  const packId = text(row?.pack_id);
  const deckId = text(row?.deck_id);
  if (!packId || !deckId) {
    throw new BackendError('invalid-data', 'Library row is missing its pack or deck id.');
  }
  return {
    packId,
    deckId,
    addedAt: text(row?.added_at) || new Date(0).toISOString(),
  };
}

function validateIds(packId: string, deckId: string): void {
  if (!packId.trim() || !deckId.trim()) {
    throw new BackendError('invalid-data', 'A pack id and deck id are required.');
  }
}

export function createSupabaseUserLibraryService(client: SupabaseClientLike): UserLibraryService {
  return {
    async list(): Promise<OfficialDeckRef[]> {
      try {
        const { data, error } = await client
          .from('user_official_decks')
          .select(LIBRARY_COLUMNS)
          .order('added_at', { ascending: false });
        if (error) throw error;
        return (data ?? []).map(mapOfficialDeckRef);
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async add(packId: string, deckId: string): Promise<OfficialDeckRef> {
      validateIds(packId, deckId);
      try {
        // Insert-then-read is safe to retry: (user, pack, deck) is the primary
        // key, so adding an already-added deck is a no-op rather than an error.
        const { error } = await client
          .from('user_official_decks')
          .insert({ pack_id: packId, deck_id: deckId });
        if (error && (error as { code?: string }).code !== '23505') throw error;

        const { data, error: readError } = await client
          .from('user_official_decks')
          .select(LIBRARY_COLUMNS)
          .eq('pack_id', packId)
          .eq('deck_id', deckId)
          .maybeSingle();
        if (readError) throw readError;
        if (!data) {
          throw new BackendError('unknown', 'The deck was added but could not be read back.');
        }
        return mapOfficialDeckRef(data);
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async remove(packId: string, deckId: string): Promise<void> {
      validateIds(packId, deckId);
      try {
        const { error } = await client
          .from('user_official_decks')
          .delete()
          .eq('pack_id', packId)
          .eq('deck_id', deckId);
        if (error) throw error;
      } catch (error) {
        throw toBackendError(error);
      }
    },
  };
}
