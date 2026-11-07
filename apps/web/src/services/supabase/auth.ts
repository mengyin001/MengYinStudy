import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { authRedirectUrl } from '../config';
import { BackendError, ok, fail, toBackendError, type ServiceResult } from '../errors';
import type {
  AuthEvent,
  AuthService,
  AuthSession,
  AuthUser,
  OAuthProvider,
  SignUpInput,
  SignUpResult,
} from '../types';
import type { SupabaseClientLike } from './client';
import { createProviderDirectory } from './oauthProviders';

export interface SupabaseAuthOptions {
  /**
   * Project URL and publishable key. When both are present the service fetches
   * `/auth/v1/settings` first, so an unconfigured provider is reported in the
   * app instead of as a raw JSON error page after the browser has left.
   */
  url?: string;
  key?: string;
  fetchImpl?: typeof fetch;
  /** Override for the redirect target; defaults to `authRedirectUrl()`. */
  redirectTo?: () => string | null;
  /** Override for the browser navigation; defaults to `window.location.assign`. */
  navigate?: (url: string) => void;
  providerTtlMs?: number;
  now?: () => number;
}

function metaString(user: User, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = user.user_metadata?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function mapAuthUser(user: User): AuthUser {
  const provider =
    typeof user.app_metadata?.provider === 'string'
      ? user.app_metadata.provider
      : Array.isArray(user.app_metadata?.providers) && typeof user.app_metadata.providers[0] === 'string'
        ? user.app_metadata.providers[0]
        : null;

  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at ?? user.confirmed_at),
    displayName: metaString(user, ['display_name', 'full_name', 'name', 'preferred_username', 'user_name']),
    avatarUrl: metaString(user, ['avatar_url', 'picture']),
    provider,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

export function mapAuthSession(session: Session): AuthSession {
  return {
    user: mapAuthUser(session.user),
    expiresAt: typeof session.expires_at === 'number' ? session.expires_at : null,
  };
}

export function mapAuthEvent(event: AuthChangeEvent): AuthEvent | null {
  switch (event) {
    case 'INITIAL_SESSION':
      return 'initial';
    case 'SIGNED_IN':
      return 'signed-in';
    case 'SIGNED_OUT':
      return 'signed-out';
    case 'TOKEN_REFRESHED':
      return 'token-refreshed';
    case 'USER_UPDATED':
      return 'user-updated';
    case 'PASSWORD_RECOVERY':
      return 'password-recovery';
    default:
      return null;
  }
}

function normalizeTarget(target: string | null): string | null {
  return target && target.trim() ? target : null;
}

function defaultNavigate(url: string): void {
  if (typeof window === 'undefined') return;
  window.location.assign(url);
}

export function createSupabaseAuthService(
  client: SupabaseClientLike,
  options: SupabaseAuthOptions = {},
): AuthService {
  const redirectTo = (): string | null =>
    options.redirectTo ? normalizeTarget(options.redirectTo()) : authRedirectUrl() || null;
  const navigate = options.navigate ?? defaultNavigate;
  const providers =
    options.url && options.key
      ? createProviderDirectory({
          url: options.url,
          key: options.key,
          fetchImpl: options.fetchImpl,
          ttlMs: options.providerTtlMs,
          now: options.now,
        })
      : null;

  const withRedirect = (): { emailRedirectTo?: string } => {
    const target = redirectTo();
    return target ? { emailRedirectTo: target } : {};
  };

  return {
    async getSession() {
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        return data.session ? mapAuthSession(data.session) : null;
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async getAccessToken() {
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        return data.session?.access_token ?? null;
      } catch (error) {
        throw toBackendError(error);
      }
    },

    async validateSession(): Promise<ServiceResult<AuthUser | null>> {
      try {
        const { data, error } = await client.auth.getUser();
        if (error) {
          // The client dropped an already-missing session itself; that is a
          // signed-out state, not a failure worth showing the learner.
          if ((error as { name?: string }).name === 'AuthSessionMissingError') {
            return ok(null);
          }
          throw error;
        }
        return ok(data.user ? mapAuthUser(data.user) : null);
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    onAuthStateChange(listener) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        const mapped = mapAuthEvent(event);
        if (!mapped) return;
        listener(mapped, session ? mapAuthSession(session) : null);
      });
      return () => data.subscription.unsubscribe();
    },

    async signInWithPassword(email, password): Promise<ServiceResult<AuthSession>> {
      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        if (!data.session) throw new BackendError('unauthorized', 'Sign-in returned no session.');
        return ok(mapAuthSession(data.session));
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async signUp(input: SignUpInput): Promise<ServiceResult<SignUpResult>> {
      try {
        const { data, error } = await client.auth.signUp({
          email: input.email.trim(),
          password: input.password,
          options: {
            data: { display_name: input.displayName.trim() },
            ...withRedirect(),
          },
        });
        if (error) throw error;
        return ok({
          session: data.session ? mapAuthSession(data.session) : null,
          user: data.user ? mapAuthUser(data.user) : null,
          needsConfirmation: !data.session,
        });
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async signInWithOAuth(provider: OAuthProvider): Promise<ServiceResult<{ url: string | null }>> {
      const target = redirectTo();
      if (!target) {
        return fail(
          new BackendError(
            'unconfigured',
            'OAuth needs an http(s) page; it is not available from a file:// window.',
          ),
        );
      }

      // A disabled provider would otherwise send the whole tab to a raw JSON
      // page from GoTrue. Ask the project first and keep the error in the UI.
      if (providers) {
        const enabled = await providers.isEnabled(provider);
        if (enabled === false) {
          return fail(
            new BackendError(
              'provider-disabled',
              `${provider} sign-in is not enabled for this Supabase project.`,
            ),
          );
        }
      }

      try {
        const { data, error } = await client.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: target,
            // Build the URL here so the navigation below is the single place
            // that leaves the app: a failure stays inside the sign-in form.
            skipBrowserRedirect: true,
            ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
          },
        });
        if (error) throw error;
        if (!data.url) {
          throw new BackendError('unknown', 'Supabase did not return an authorisation URL.');
        }
        navigate(data.url);
        return ok({ url: data.url });
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async signOut(): Promise<ServiceResult> {
      try {
        const { error } = await client.auth.signOut();
        if (error) {
          // Offline or the refresh token is already gone: still drop the local
          // session so the next learner does not inherit it.
          const local = await client.auth.signOut({ scope: 'local' });
          if (local.error) throw error;
        }
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async deleteAccount(): Promise<ServiceResult> {
      try {
        // RLS keeps `authenticated` out of auth.users; the database exposes a
        // narrow SECURITY DEFINER function instead. It deletes `auth.uid()`
        // only, and the profile, decks, library and progress rows cascade.
        const { error } = await client.rpc('delete_account');
        if (error) throw error;
        // The auth user is gone, so the refresh token can never be redeemed
        // again. Drop the local copy too, otherwise the app keeps showing an
        // account that no longer exists.
        await client.auth.signOut({ scope: 'local' });
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async requestPasswordReset(email): Promise<ServiceResult> {
      try {
        const target = redirectTo();
        const { error } = await client.auth.resetPasswordForEmail(
          email.trim(),
          target ? { redirectTo: target } : {},
        );
        if (error) throw error;
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async updatePassword(password): Promise<ServiceResult> {
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      }
    },

    async resendConfirmation(email): Promise<ServiceResult> {
      try {
        const { error } = await client.auth.resend({
          type: 'signup',
          email: email.trim(),
          options: withRedirect(),
        });
        if (error) throw error;
        return ok(undefined);
      } catch (error) {
        return fail(toBackendError(error));
      }
    },
  };
}
