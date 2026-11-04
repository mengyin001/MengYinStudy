import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BackendConfig } from '../config';

export type SupabaseClientLike = SupabaseClient;

/**
 * The only place in the web app that constructs a Supabase client.
 *
 * `flowType: 'pkce'` keeps OAuth and recovery codes out of the URL fragment, so
 * the hash router can own `#/…` without fighting the auth callback.
 */
export function createSupabaseClient(config: BackendConfig): SupabaseClientLike {
  return createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'mengyin-study.auth',
    },
    db: { schema: 'public' },
    global: {
      headers: { 'x-application-name': 'mengyin-study' },
    },
  });
}
