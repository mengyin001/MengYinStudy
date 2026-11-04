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

function redirectTo(): string | null {
  return authRedirectUrl() || null;
}

export function createSupabaseAuthService(client: SupabaseClientLike): AuthService {
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
      try {
        const { data, error } = await client.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: target,
            ...(provider === 'google' ? { queryParams: { prompt: 'select_account' } } : {}),
          },
        });
        if (error) throw error;
        return ok({ url: data.url ?? null });
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
