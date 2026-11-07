import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { backend } from '@/services';
import { clearDraft } from '@/ai/draft';
import { BackendError, toBackendError, type ServiceResult } from '@/services/errors';
import type {
  AuthEvent,
  AuthSession,
  AuthUser,
  OAuthProvider,
  Profile,
  ProfilePatch,
  SignUpInput,
  SignUpResult,
} from '@/services/types';
import { navigate } from '@/lib/router';
import {
  forgetNewAccount,
  isFreshAccount,
  rememberedNewAccount,
  rememberNewAccount,
} from './newAccount';

const RECOVERY_MARKER = 'mengyin:recovery';
const RECOVERY_TTL_MS = 30 * 60_000;
const OAUTH_RETURN = 'mengyin:oauth-return';
/** How often a visible, signed-in tab re-checks that its account still exists. */
const SESSION_CHECK_MS = 60_000;
const AUTH_QUERY_KEYS = ['code', 'error', 'error_code', 'error_description', 'state', 'type', 'token_hash'];

function hasFreshRecoveryMarker(): boolean {
  const raw = sessionStorage.getItem(RECOVERY_MARKER);
  if (!raw) return false;
  const at = Number(raw);
  return Number.isFinite(at) && Date.now() - at < RECOVERY_TTL_MS;
}

function markRecovery(): void {
  sessionStorage.setItem(RECOVERY_MARKER, String(Date.now()));
}

interface AuthState {
  ready: boolean;
  status: 'loading' | 'anonymous' | 'authenticated';
  user: AuthUser | null;
  profile: Profile | null;
  recovery: boolean;
  /**
   * The account was created on this browser (sign-up or first OAuth sign-in),
   * so its one-time guest-practice adoption has not been claimed yet.
   */
  newAccount: boolean;
  error: BackendError | null;
  profileError: BackendError | null;
}

type AuthAction =
  | { type: 'session'; session: AuthSession; newAccount: boolean }
  | { type: 'anonymous'; error?: BackendError }
  | { type: 'profile'; profile: Profile | null; error: BackendError | null }
  | { type: 'recovery' }
  | { type: 'end-recovery' }
  | { type: 'consume-new-account' }
  | { type: 'error'; error: BackendError | null }
  | { type: 'clear-error' };

const initialState: AuthState = {
  ready: false,
  status: 'loading',
  user: null,
  profile: null,
  recovery: false,
  newAccount: false,
  error: null,
  profileError: null,
};

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'session': {
      const sameUser = state.user?.id === action.session.user.id;
      return {
        ...state,
        ready: true,
        status: 'authenticated',
        user: action.session.user,
        profile: sameUser ? state.profile : null,
        profileError: sameUser ? state.profileError : null,
        // A token refresh for the same user must not re-open adoption after it
        // has been consumed; a different user gets a fresh decision.
        newAccount: sameUser ? state.newAccount : action.newAccount,
        error: null,
      };
    }
    case 'anonymous':
      return {
        ...state,
        ready: true,
        status: 'anonymous',
        user: null,
        profile: null,
        recovery: false,
        newAccount: false,
        profileError: null,
        error: action.error ?? null,
      };
    case 'profile':
      return { ...state, profile: action.profile, profileError: action.error };
    case 'recovery':
      return { ...state, recovery: true, ready: true };
    case 'end-recovery':
      return { ...state, recovery: false };
    case 'consume-new-account':
      return { ...state, newAccount: false };
    case 'error':
      return { ...state, error: action.error, ready: true };
    case 'clear-error':
      return { ...state, error: null };
    default:
      return state;
  }
}

export interface AuthActions {
  signIn(email: string, password: string): Promise<ServiceResult<AuthSession>>;
  signUp(input: SignUpInput): Promise<ServiceResult<SignUpResult>>;
  signInWithOAuth(provider: OAuthProvider): Promise<ServiceResult<{ url: string | null }>>;
  signOut(): Promise<ServiceResult>;
  /** Delete the signed-in account for good; resolves after the app is signed out. */
  deleteAccount(): Promise<ServiceResult>;
  requestPasswordReset(email: string): Promise<ServiceResult>;
  updatePassword(password: string): Promise<ServiceResult>;
  resendConfirmation(email: string): Promise<ServiceResult>;
  updateProfile(patch: ProfilePatch): Promise<ServiceResult<Profile>>;
  refreshProfile(): Promise<void>;
  /** Mark the new account's one-time guest-practice adoption as spent. */
  consumeNewAccount(): void;
  clearError(): void;
  endRecovery(): void;
  reportError(error: BackendError): void;
}

export interface AuthContextValue {
  state: AuthState;
  configured: boolean;
  configReason: string | null;
  actions: AuthActions;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function currentHashPath(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/';
}

function cleanAuthQuery(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of AUTH_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  if (!url.hash) url.hash = '#/';
  window.history.replaceState(null, '', url.href);
}

function readCallbackError(): BackendError | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const description = params.get('error_description') ?? params.get('error');
  if (!description) return null;
  const code = params.get('error_code');
  const mapped =
    code === 'otp_expired' || code === 'flow_state_expired'
      ? new BackendError('link-expired', description)
      : new BackendError('unknown', description);
  cleanAuthQuery();
  return mapped;
}

function fallbackProfile(user: AuthUser): Profile {
  const now = new Date().toISOString();
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: 'user',
    createdAt: user.createdAt ?? now,
    updatedAt: now,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const activeUser = useRef<string | null>(null);
  const sessionCheckBusy = useRef(false);

  const applySession = useCallback(async (session: AuthSession | null, event: AuthEvent) => {
    if (event === 'password-recovery') {
      dispatch({ type: 'recovery' });
      sessionStorage.removeItem(RECOVERY_MARKER);
      cleanAuthQuery();
      navigate('/reset-password', { replace: true });
    }

    if (!session) {
      if (event === 'password-recovery') return;
      activeUser.current = null;
      dispatch({ type: 'anonymous' });
      return;
    }

    activeUser.current = session.user.id;

    let newAccount = false;
    if (event === 'signed-in' || event === 'initial') {
      const target = sessionStorage.getItem(OAUTH_RETURN);
      if (target) {
        sessionStorage.removeItem(OAUTH_RETURN);
        // OAuth has no local sign-up call to observe: a return into an account
        // created moments ago is that account's first sign-in.
        if (isFreshAccount(session.user)) rememberNewAccount(session.user.id);
        if (target.startsWith('/')) navigate(target, { replace: true });
      }
      // The marker survives email confirmation; OAuth was marked just above.
      newAccount = rememberedNewAccount(session.user.id);
    }
    dispatch({ type: 'session', session, newAccount });

    try {
      const profile = await backend.profiles.getProfile(session.user.id);
      if (activeUser.current !== session.user.id) return;
      dispatch({
        type: 'profile',
        profile: profile ?? fallbackProfile(session.user),
        error: profile ? null : new BackendError('profile-missing', 'Profile row was not created.'),
      });
    } catch (error) {
      if (activeUser.current !== session.user.id) return;
      dispatch({
        type: 'profile',
        profile: fallbackProfile(session.user),
        error: toBackendError(error),
      });
    }
  }, []);

  /**
   * Re-check the stored session with the auth server. Local storage can still
   * hold a token for an account that was deleted on another device, and
   * `getSession()` never asks the server, so a refresh alone would keep showing
   * that account. Only a server-rejected session is dropped; network and server
   * failures leave the learner signed in and able to study offline.
   */
  const verifySession = useCallback(async () => {
    const userId = activeUser.current;
    if (!userId || !backend.configured || sessionCheckBusy.current) return;
    sessionCheckBusy.current = true;
    try {
      const result = await backend.auth.validateSession();
      if (activeUser.current !== userId) return;
      const invalid = result.ok ? result.value === null : result.error.code === 'unauthorized';
      if (!invalid) return;

      // The auth user is gone (or the refresh token is dead): drop the local copy
      // too, otherwise the next refresh restores the same ghost account.
      await backend.auth.signOut();
      if (activeUser.current !== null && activeUser.current !== userId) return;
      activeUser.current = null;
      dispatch({ type: 'anonymous', error: result.ok ? undefined : result.error });
    } finally {
      sessionCheckBusy.current = false;
    }
  }, []);

  useEffect(() => {
    let active = true;

    if (!backend.configured) {
      dispatch({
        type: 'anonymous',
        error: new BackendError('unconfigured', backend.reason ?? 'Not configured.'),
      });
      return () => {
        active = false;
      };
    }

    const callbackError = readCallbackError();

    const unsubscribe = backend.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      void applySession(session, event);
    });

    void (async () => {
      let restored = false;
      try {
        const session = await backend.auth.getSession();
        restored = Boolean(session);
        if (!active) return;
        const hinted = hasFreshRecoveryMarker();
        if (hinted && session) {
          dispatch({ type: 'recovery' });
          navigate('/reset-password', { replace: true });
        }
        await applySession(session, 'initial');
        // The code has been exchanged (or rejected); do not leave it in the
        // address bar where a refresh would try to redeem it again.
        cleanAuthQuery();
        // Do not block the first paint on a network round trip: offline study
        // must still boot. A deleted account is signed out a moment later.
        if (session) void verifySession();
      } catch (error) {
        if (!active) return;
        dispatch({ type: 'anonymous', error: toBackendError(error) });
      }
      if (active && callbackError) {
        dispatch({ type: 'error', error: callbackError });
        if (!restored) navigate('/login', { replace: true });
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [applySession, verifySession]);

  // A deleted account has no server-side session to push an event to this
  // device, so a visible tab re-checks periodically and whenever it regains
  // focus. The request is throttled: focus fires often, a check costs one GET.
  const sessionUserId = state.user?.id ?? null;
  useEffect(() => {
    if (state.status !== 'authenticated' || !sessionUserId) return;
    let checkedAt = Date.now();
    const check = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - checkedAt < SESSION_CHECK_MS) return;
      checkedAt = Date.now();
      void verifySession();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(check, SESSION_CHECK_MS);
    return () => {
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(timer);
    };
  }, [state.status, sessionUserId, verifySession]);

  const signIn = useCallback(async (email: string, password: string) => {
    sessionStorage.removeItem(RECOVERY_MARKER);
    sessionStorage.removeItem(OAUTH_RETURN);
    const result = await backend.auth.signInWithPassword(email, password);
    if (result.ok) {
      await applySession(result.value, 'signed-in');
    } else {
      dispatch({ type: 'error', error: result.error });
    }
    return result;
  }, [applySession]);

  const signUp = useCallback(async (input: SignUpInput) => {
    sessionStorage.removeItem(RECOVERY_MARKER);
    sessionStorage.removeItem(OAUTH_RETURN);
    const result = await backend.auth.signUp(input);
    if (!result.ok) {
      dispatch({ type: 'error', error: result.error });
      return result;
    }
    // Remember the new account even when a confirmation email is required: the
    // marker is what lets it adopt this browser's guest practice on first sign-in.
    if (result.value.user) rememberNewAccount(result.value.user.id);
    if (result.value.session) await applySession(result.value.session, 'signed-in');
    return result;
  }, [applySession]);

  const signInWithOAuth = useCallback(async (provider: OAuthProvider) => {
    sessionStorage.setItem(OAUTH_RETURN, currentHashPath());
    const result = await backend.auth.signInWithOAuth(provider);
    if (!result.ok) {
      sessionStorage.removeItem(OAUTH_RETURN);
      dispatch({ type: 'error', error: result.error });
    }
    return result;
  }, []);

  const signOut = useCallback(async () => {
    const result = await backend.auth.signOut();
    if (result.ok) {
      activeUser.current = null;
      clearDraft();
      sessionStorage.removeItem(RECOVERY_MARKER);
      sessionStorage.removeItem(OAUTH_RETURN);
      dispatch({ type: 'anonymous' });
    } else {
      dispatch({ type: 'error', error: result.error });
    }
    return result;
  }, []);

  const deleteAccount = useCallback(async (): Promise<ServiceResult> => {
    const userId = state.user?.id;
    // Storage objects are not covered by the database cascade; remove them while
    // the session can still authorize the private bucket.
    if (backend.configured) await backend.userMedia.removeAll().catch(() => undefined);
    const result = await backend.auth.deleteAccount();
    if (result.ok) {
      // The auth user no longer exists; the service already dropped the local
      // session. Clear the same markers signOut clears, so a later sign-in on
      // this browser cannot resume the deleted account's flow.
      if (userId) forgetNewAccount(userId);
      activeUser.current = null;
      clearDraft();
      sessionStorage.removeItem(RECOVERY_MARKER);
      sessionStorage.removeItem(OAUTH_RETURN);
      dispatch({ type: 'anonymous' });
    } else {
      dispatch({ type: 'error', error: result.error });
    }
    return result;
  }, [state.user]);

  const requestPasswordReset = useCallback(async (email: string) => {
    markRecovery();
    const result = await backend.auth.requestPasswordReset(email);
    if (!result.ok) {
      sessionStorage.removeItem(RECOVERY_MARKER);
      dispatch({ type: 'error', error: result.error });
    }
    return result;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const result = await backend.auth.updatePassword(password);
    if (!result.ok) {
      dispatch({ type: 'error', error: result.error });
      return result;
    }
    sessionStorage.removeItem(RECOVERY_MARKER);
    cleanAuthQuery();
    dispatch({ type: 'end-recovery' });
    return result;
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const result = await backend.auth.resendConfirmation(email);
    if (!result.ok) dispatch({ type: 'error', error: result.error });
    return result;
  }, []);

  const refreshProfile = useCallback(async () => {
    const user = state.user;
    if (!user) return;
    try {
      const profile = await backend.profiles.getProfile(user.id);
      dispatch({
        type: 'profile',
        profile: profile ?? fallbackProfile(user),
        error: profile ? null : new BackendError('profile-missing', 'Profile row was not created.'),
      });
    } catch (error) {
      dispatch({
        type: 'profile',
        profile: fallbackProfile(user),
        error: toBackendError(error),
      });
    }
  }, [state.user]);

  const updateProfile = useCallback(
    async (patch: ProfilePatch): Promise<ServiceResult<Profile>> => {
      const user = state.user;
      if (!user) {
        return { ok: false, error: new BackendError('unauthorized', 'Sign in to edit your profile.') };
      }
      try {
        const profile = await backend.profiles.updateProfile(user.id, patch);
        dispatch({ type: 'profile', profile, error: null });
        return { ok: true, value: profile };
      } catch (error) {
        const mapped = toBackendError(error);
        dispatch({ type: 'error', error: mapped });
        return { ok: false, error: mapped };
      }
    },
    [state.user],
  );

  const consumeNewAccount = useCallback(() => {
    const userId = state.user?.id;
    if (userId) forgetNewAccount(userId);
    dispatch({ type: 'consume-new-account' });
  }, [state.user]);

  const actions = useMemo<AuthActions>(
    () => ({
      signIn,
      signUp,
      signInWithOAuth,
      signOut,
      deleteAccount,
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      updateProfile,
      refreshProfile,
      consumeNewAccount,
      clearError: () => dispatch({ type: 'clear-error' }),
      endRecovery: () => {
        sessionStorage.removeItem(RECOVERY_MARKER);
        dispatch({ type: 'end-recovery' });
      },
      reportError: (error: BackendError) => dispatch({ type: 'error', error }),
    }),
    [
      signIn,
      signUp,
      signInWithOAuth,
      signOut,
      deleteAccount,
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      updateProfile,
      refreshProfile,
      consumeNewAccount,
    ],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      configured: backend.configured,
      configReason: backend.reason,
      actions,
    }),
    [state, actions],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
