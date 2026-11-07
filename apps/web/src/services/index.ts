/**
 * Composition root for the data layer.
 *
 * Pages, contexts and components import `backend` (or a type) from here; none
 * of them import `@supabase/supabase-js`. Swapping the backend therefore means
 * implementing these interfaces, not editing the UI.
 */
import { backendConfig, type BackendConfig } from './config';
import { BackendError, fail } from './errors';
import { createSupabaseAuthService } from './supabase/auth';
import { createSupabaseClient, type SupabaseClientLike } from './supabase/client';
import { createSupabaseOfficialService } from './supabase/official';
import { createSupabaseProfileService } from './supabase/profiles';
import { createSupabaseUserDeckService } from './supabase/userDecks';
import { createSupabaseUserCollectionService } from './supabase/userCollections';
import { createSupabaseUserLibraryService } from './supabase/userLibrary';
import { createSupabaseUserMediaService } from './supabase/userMedia';
import { createSupabaseUserProgressService } from './supabase/userProgress';
import type {
  AuthService,
  Backend,
  OfficialContentService,
  ProfileService,
  UserCollectionsService,
  UserDeckService,
  UserLibraryService,
  UserMediaService,
  UserProgressService,
} from './types';

function unavailableAuth(reason: string): AuthService {
  const error = () => fail(new BackendError('unconfigured', reason));
  return {
    async getSession() {
      return null;
    },
    async getAccessToken() {
      return null;
    },
    async validateSession() {
      return fail(new BackendError('unconfigured', reason));
    },
    onAuthStateChange() {
      return () => undefined;
    },
    signInWithPassword: async () => error(),
    signUp: async () => error(),
    signInWithOAuth: async () => error(),
    signOut: async () => error(),
    deleteAccount: async () => error(),
    requestPasswordReset: async () => error(),
    updatePassword: async () => error(),
    resendConfirmation: async () => error(),
  };
}

function unavailableProfiles(reason: string): ProfileService {
  return {
    async getProfile() {
      throw new BackendError('unconfigured', reason);
    },
    async updateProfile() {
      throw new BackendError('unconfigured', reason);
    },
  };
}

function unavailableOfficial(reason: string): OfficialContentService {
  return {
    async getManifest() {
      throw new BackendError('unconfigured', reason);
    },
    async getCatalog() {
      throw new BackendError('unconfigured', reason);
    },
  };
}

function unavailableUserDecks(reason: string): UserDeckService {
  return {
    async list() {
      throw new BackendError('unconfigured', reason);
    },
    async upsert() {
      throw new BackendError('unconfigured', reason);
    },
    async remove() {
      throw new BackendError('unconfigured', reason);
    },
  };
}

function unavailableUserCollections(reason: string): UserCollectionsService {
  return {
    async list() {
      throw new BackendError('unconfigured', reason);
    },
    async upsert() {
      throw new BackendError('unconfigured', reason);
    },
    async remove() {
      throw new BackendError('unconfigured', reason);
    },
  };
}

function unavailableUserMedia(reason: string): UserMediaService {
  return {
    async usage() {
      throw new BackendError('unconfigured', reason);
    },
    async signedUrl() {
      throw new BackendError('unconfigured', reason);
    },
    async signedUrls() {
      throw new BackendError('unconfigured', reason);
    },
    async remove() {
      throw new BackendError('unconfigured', reason);
    },
    async removeAll() {
      throw new BackendError('unconfigured', reason);
    },
  };
}

function unavailableUserLibrary(reason: string): UserLibraryService {
  return {
    async list() {
      throw new BackendError('unconfigured', reason);
    },
    async add() {
      throw new BackendError('unconfigured', reason);
    },
    async remove() {
      throw new BackendError('unconfigured', reason);
    },
  };
}

function unavailableUserProgress(reason: string): UserProgressService {
  return {
    async get() {
      throw new BackendError('unconfigured', reason);
    },
    async push() {
      throw new BackendError('unconfigured', reason);
    },
    subscribe() {
      return () => undefined;
    },
  };
}

export function createUnavailableBackend(config: BackendConfig): Backend {
  const reason = config.reason ?? 'The backend is not configured.';
  return {
    configured: false,
    status: config.status,
    reason,
    url: null,
    auth: unavailableAuth(reason),
    profiles: unavailableProfiles(reason),
    official: unavailableOfficial(reason),
    userDecks: unavailableUserDecks(reason),
    userCollections: unavailableUserCollections(reason),
    userMedia: unavailableUserMedia(reason),
    userLibrary: unavailableUserLibrary(reason),
    userProgress: unavailableUserProgress(reason),
  };
}

export function createSupabaseBackend(
  config: BackendConfig,
  client: SupabaseClientLike = createSupabaseClient(config),
): Backend {
  return {
    configured: true,
    status: config.status,
    reason: null,
    url: config.url,
    // The URL/key let the auth service check `/auth/v1/settings` before an OAuth
    // redirect, so a disabled provider is an in-app message, not a JSON page.
    auth: createSupabaseAuthService(client, { url: config.url, key: config.key }),
    profiles: createSupabaseProfileService(client),
    official: createSupabaseOfficialService(client),
    userDecks: createSupabaseUserDeckService(client),
    userCollections: createSupabaseUserCollectionService(client),
    userMedia: createSupabaseUserMediaService(client),
    userLibrary: createSupabaseUserLibraryService(client),
    userProgress: createSupabaseUserProgressService(client),
  };
}

export function createBackend(config: BackendConfig = backendConfig): Backend {
  return config.configured ? createSupabaseBackend(config) : createUnavailableBackend(config);
}

if (!backendConfig.configured && backendConfig.status === 'secret-key') {
  // Loud on purpose: this is a security bug in deployment, not a normal state.
  console.error('[mengyin] Refusing to create a Supabase client with a secret key in the browser bundle.');
}

export const backend: Backend = createBackend();

export type { Backend, BackendConfig };
export { authRedirectUrl, backendConfig } from './config';
export { BackendError, isBackendError, type BackendErrorCode, type ServiceResult } from './errors';
export * from './types';
