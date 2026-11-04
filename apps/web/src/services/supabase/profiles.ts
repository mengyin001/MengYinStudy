import { BackendError, toBackendError } from '../errors';
import type { AppRole, Profile, ProfilePatch, ProfileService } from '../types';
import type { SupabaseClientLike } from './client';

const PROFILE_COLUMNS = 'id,display_name,avatar_url,role,created_at,updated_at';

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

function asRole(value: unknown): AppRole {
  return value === 'admin' ? 'admin' : 'user';
}

export function mapProfileRow(raw: unknown): Profile {
  const row = raw as Partial<ProfileRow>;
  if (!row || typeof row.id !== 'string') {
    throw new BackendError('invalid-data', 'Profile row is missing an id.');
  }
  return {
    id: row.id,
    displayName: typeof row.display_name === 'string' ? row.display_name : null,
    avatarUrl: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    role: asRole(row.role),
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}

export function createSupabaseProfileService(client: SupabaseClientLike): ProfileService {
  async function getProfile(userId: string): Promise<Profile | null> {
    try {
      const { data, error } = await client
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return data ? mapProfileRow(data) : null;
    } catch (error) {
      throw toBackendError(error);
    }
  }

  return {
    getProfile,

    async updateProfile(userId, patch: ProfilePatch) {
      const update: Record<string, string | null> = {};
      if (patch.displayName !== undefined) {
        const displayName = patch.displayName.trim();
        if (!displayName) throw new BackendError('invalid-data', 'Display name cannot be empty.');
        if (displayName.length > 80) {
          throw new BackendError('invalid-data', 'Display name must be 80 characters or fewer.');
        }
        update.display_name = displayName;
      }
      if (patch.avatarUrl !== undefined) {
        update.avatar_url = patch.avatarUrl?.trim() || null;
      }
      if (Object.keys(update).length === 0) {
        const current = await getProfile(userId);
        if (!current) throw new BackendError('profile-missing', 'Profile not found.');
        return current;
      }

      try {
        const { data, error } = await client
          .from('profiles')
          .update(update)
          .eq('id', userId)
          .select(PROFILE_COLUMNS)
          .single();
        if (error) throw error;
        return mapProfileRow(data);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'PGRST116') {
          throw new BackendError('profile-missing', 'Profile not found for this account.');
        }
        throw toBackendError(error);
      }
    },
  };
}
