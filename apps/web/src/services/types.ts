/**
 * Data-service contracts.
 *
 * The React app only talks to these interfaces. Supabase is one implementation
 * (`services/supabase/*`); tests and any future backend can supply another
 * without touching a page or component.
 */
import type { LocalizedText, Question } from '@mengyin/core';
import type { BackendConfigStatus } from './config';
import type { ServiceResult } from './errors';

export type OAuthProvider = 'google' | 'github';
export type AppRole = 'user' | 'admin';

export interface AuthUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  provider: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AuthSession {
  user: AuthUser;
  expiresAt: number | null;
}

export type AuthEvent =
  | 'initial'
  | 'signed-in'
  | 'signed-out'
  | 'token-refreshed'
  | 'user-updated'
  | 'password-recovery';

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
}

export interface SignUpResult {
  session: AuthSession | null;
  /** The created account, present even when a confirmation email is required. */
  user: AuthUser | null;
  needsConfirmation: boolean;
}

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  /**
   * The bearer token for the current session, or null when signed out.
   * Used by the hosted AI API; it is never persisted by the AI client.
   */
  getAccessToken(): Promise<string | null>;
  /**
   * Re-check the stored session against the auth server.
   *
   * `getSession()` only reads local storage, so a session whose account was
   * deleted on another device still looks valid until its token expires. This
   * call asks GoTrue's `/user` endpoint instead. A missing session resolves to
   * `null`; an `unauthorized` error means the stored session must be dropped
   * (for example because the account no longer exists). Network and server
   * errors leave the local session alone so offline study keeps working.
   */
  validateSession(): Promise<ServiceResult<AuthUser | null>>;
  onAuthStateChange(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void;
  signInWithPassword(email: string, password: string): Promise<ServiceResult<AuthSession>>;
  signUp(input: SignUpInput): Promise<ServiceResult<SignUpResult>>;
  signInWithOAuth(provider: OAuthProvider): Promise<ServiceResult<{ url: string | null }>>;
  signOut(): Promise<ServiceResult>;
  /**
   * Permanently deletes the signed-in learner's account and everything owned
   * by it (profile, cloud decks, library, progress). The local session is
   * dropped as part of the call.
   */
  deleteAccount(): Promise<ServiceResult>;
  requestPasswordReset(email: string): Promise<ServiceResult>;
  updatePassword(password: string): Promise<ServiceResult>;
  resendConfirmation(email: string): Promise<ServiceResult>;
}

export interface Profile {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: AppRole;
  createdAt: string;
  updatedAt: string;
}

export interface ProfilePatch {
  displayName?: string;
  avatarUrl?: string | null;
}

export interface ProfileService {
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<Profile>;
}

export interface OfficialManifest {
  /** Monotonic catalogue version, bumped by a database trigger. */
  version: string;
  updatedAt: string | null;
}

export interface OfficialDeckPayload {
  id: string;
  title: string;
  /** Per-language title overrides, when the catalogue provides them. */
  titleI18n?: LocalizedText;
  description?: string;
  descriptionI18n?: LocalizedText;
  tags: string[];
  /** Raw question JSON; validated with the same zod schema as plugin decks. */
  questions: unknown;
  mediaBaseUrl: string | null;
  /** Author-set whole-paper exam length, when the catalogue provides one. */
  examMinutes?: number;
  version: string;
  updatedAt: string;
}

export interface OfficialPackPayload {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  tags: string[];
  updatedAt: string;
  decks: OfficialDeckPayload[];
}

export interface OfficialCatalog {
  version: string;
  packs: OfficialPackPayload[];
}

export interface OfficialContentService {
  getManifest(): Promise<OfficialManifest>;
  /** `version` is the manifest version already fetched by the caller, when known. */
  getCatalog(version?: string): Promise<OfficialCatalog>;
}

/** A deck uploaded by the signed-in learner; only that account can read it. */
export interface UserDeck {
  id: string;
  /** Stable `pluginId::deckId`; progress keys keep working across devices. */
  clientKey: string;
  pluginId: string;
  deckId: string;
  title: string;
  description: string | null;
  tags: string[];
  questions: Question[];
  /** Deck-set exam length; null means the app estimates from the questions. */
  examMinutes: number | null;
  /** Optional single-file plugin module (custom types/importers). */
  entrySource: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDeckInput {
  clientKey: string;
  pluginId: string;
  deckId: string;
  title: string;
  description?: string;
  tags: string[];
  questions: Question[];
  examMinutes?: number | null;
  entrySource?: string | null;
}

export interface UserDeckService {
  list(): Promise<UserDeck[]>;
  upsert(input: UserDeckInput): Promise<UserDeck>;
  /**
   * Delete by row id. `clientKey` is the stable `plugin::deck` key: when the id
   * is stale (the row was re-created elsewhere), the delete is retried by key
   * instead of silently matching nothing.
   */
  remove(id: string, clientKey?: string): Promise<void>;
}

/**
 * A learner-created group of decks. It stores deck keys (`pluginId::deckId`)
 * rather than copies, so a deck keeps its own progress and may belong to more
 * than one collection. `id` is generated on the device and stable across the
 * local cache and the cloud row.
 */
export interface UserCollection {
  id: string;
  name: string;
  description: string | null;
  deckKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserCollectionInput {
  id: string;
  name: string;
  description?: string | null;
  deckKeys: string[];
}

export interface UserCollectionsService {
  list(): Promise<UserCollection[]>;
  upsert(input: UserCollectionInput): Promise<UserCollection>;
  remove(id: string): Promise<void>;
}

/** Private image storage for the signed-in account. */
export interface UserMediaUsage {
  /** Deck JSON plus stored images. */
  bytes: number;
  /** Bytes occupied by user_decks rows (text, questions JSON, module code). */
  deckBytes: number;
  /** Bytes occupied by the private image bucket. */
  storageBytes: number;
  limit: number;
}

export interface UserMediaService {
  usage(): Promise<UserMediaUsage>;
  /** A short-lived, authenticated URL for one object path. */
  signedUrl(path: string): Promise<string | null>;
  signedUrls(paths: readonly string[]): Promise<ReadonlyMap<string, string>>;
  remove(paths: readonly string[]): Promise<void>;
  /** Best-effort cleanup before an account is deleted. */
  removeAll(): Promise<void>;
}

/** A reference to an official deck the learner added to their own library. */
export interface OfficialDeckRef {
  packId: string;
  deckId: string;
  addedAt: string;
}

/**
 * The Plaza is a public catalogue; this service only records which catalogue
 * decks belong to the signed-in learner's own library.
 */
export interface UserLibraryService {
  list(): Promise<OfficialDeckRef[]>;
  add(packId: string, deckId: string): Promise<OfficialDeckRef>;
  remove(packId: string, deckId: string): Promise<void>;
}

/** A private progress row; the JSON is validated by the app's normalizer. */
export interface UserProgressSnapshot {
  progress: unknown;
  updatedAt: string;
}

export interface UserProgressService {
  get(): Promise<UserProgressSnapshot | null>;
  /**
   * Conditional write. `baseUpdatedAt` is the `updated_at` the caller last saw,
   * or `null` when it believes there is no row yet. Returns `null` when another
   * device wrote first, so the caller can pull, merge and retry.
   */
  push(
    progress: unknown,
    baseUpdatedAt: string | null,
    userId: string,
  ): Promise<UserProgressSnapshot | null>;
  /** Fires when this account's progress row changes; returns an unsubscribe. */
  subscribe(userId: string, onChange: () => void): () => void;
}

export interface Backend {
  readonly configured: boolean;
  readonly status: BackendConfigStatus;
  readonly reason: string | null;
  readonly url: string | null;
  readonly auth: AuthService;
  readonly profiles: ProfileService;
  readonly official: OfficialContentService;
  readonly userDecks: UserDeckService;
  readonly userCollections: UserCollectionsService;
  readonly userMedia: UserMediaService;
  readonly userLibrary: UserLibraryService;
  readonly userProgress: UserProgressService;
}
