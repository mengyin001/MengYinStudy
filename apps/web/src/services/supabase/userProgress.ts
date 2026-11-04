import { BackendError, toBackendError } from '../errors';
import type { UserProgressService, UserProgressSnapshot } from '../types';
import type { SupabaseClientLike } from './client';

const PROGRESS_COLUMNS = 'progress,updated_at';
const MAX_PROGRESS_BYTES = 8_000_000;

interface ProgressRow {
  progress: unknown;
  updated_at: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function mapProgressRow(raw: unknown): UserProgressSnapshot {
  const row = raw as Partial<ProgressRow>;
  if (!row || row.progress === undefined || row.progress === null) {
    throw new BackendError('invalid-data', 'Cloud progress row is missing its payload.');
  }
  return {
    progress: row.progress,
    updatedAt: textOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function assertProgress(progress: unknown): void {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
    throw new BackendError('invalid-data', 'Progress must be a JSON object.');
  }
  if (JSON.stringify(progress).length > MAX_PROGRESS_BYTES) {
    throw new BackendError('invalid-data', 'Progress is too large to upload (8 MB limit).');
  }
}

export function createSupabaseUserProgressService(client: SupabaseClientLike): UserProgressService {
  return {
    async get(): Promise<UserProgressSnapshot | null> {
      try {
        const { data, error } = await client
          .from('user_progress')
          .select(PROGRESS_COLUMNS)
          .maybeSingle();
        if (error) throw error;
        return data ? mapProgressRow(data) : null;
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async push(
      progress: unknown,
      baseUpdatedAt: string | null,
      userId: string,
    ): Promise<UserProgressSnapshot | null> {
      assertProgress(progress);
      try {
        if (baseUpdatedAt === null) {
          const { data, error } = await client
            .from('user_progress')
            .insert({ user_id: userId, progress })
            .select(PROGRESS_COLUMNS)
            .single();
          if (error) {
            // Another device created the row after our last pull.
            if ((error as { code?: string }).code === '23505') return null;
            throw error;
          }
          return mapProgressRow(data);
        }

        const { data, error } = await client
          .from('user_progress')
          .update({ progress })
          .eq('user_id', userId)
          .eq('updated_at', baseUpdatedAt)
          .select(PROGRESS_COLUMNS)
          .maybeSingle();
        if (error) throw error;
        // No row matched: the base is stale (or the row was removed).
        return data ? mapProgressRow(data) : null;
      } catch (error) {
        throw toBackendError(error);
      }
    },

    subscribe(userId: string, onChange: () => void): () => void {
      let cancelled = false;
      let channel: ReturnType<SupabaseClientLike['channel']> | null = null;

      // Realtime authorises postgres_changes with the user's JWT. Make sure the
      // socket has the current access token before the channel subscribes;
      // otherwise RLS silently drops the account's rows.
      void client.auth
        .getSession()
        .then(({ data }) => {
          if (cancelled || !data.session) return;
          // A controller for an account that has just been signed out must not
          // subscribe with the next account's token.
          if (data.session.user.id !== userId) return;
          client.realtime.setAuth(data.session.access_token);
          const topic = `user-progress:${userId}:${Math.random().toString(36).slice(2)}`;
          channel = client
            .channel(topic)
            .on(
              'postgres_changes',
              {
                event: '*',
                schema: 'public',
                table: 'user_progress',
                filter: `user_id=eq.${userId}`,
              },
              () => onChange(),
            )
            .subscribe();
        })
        .catch(() => {
          // The polling/focus fallback still keeps progress in sync.
        });

      return () => {
        cancelled = true;
        if (channel) void client.removeChannel(channel);
      };
    },
  };
}
