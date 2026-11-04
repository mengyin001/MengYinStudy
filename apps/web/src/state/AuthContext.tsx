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

const RECOVERY_MARKER = 'mengyin:recovery';
const RECOVERY_TTL_MS = 30 * 60_000;
const OAUTH_RETURN = 'mengyin:oauth-return';
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
  error: BackendError | null;
  profileError: BackendError | null;
}

type AuthAction =
  | { type: 'session'; session: AuthSession }
  | { type: 'anonymous'; error?: BackendError }
  | { type: 'profile'; profile: Profile | null; error: BackendError | null }
  | { type: 'recovery' }
  | { type: 'end-recovery' }
  | { type: 'error'; error: BackendError | null }
  | { type: 'clear-error' };

const initialState: AuthState = {
  ready: false,
  status: 'loading',
  user: null,
  profile: null,
  recovery: false,
  error: null,
  profileError: null,
};

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'session':
      return {
        ...state,
        ready: true,
        status: 'authenticated',
        user: action.session.user,
        profile: state.user?.id === action.session.user.id ? state.profile : null,
        profileError: state.user?.id === action.session.user.id ? state.profileError : null,
        error: null,
      };
    case 'anonymous':
      return {
        ...state,
        ready: true,
        status: 'anonymous',
        user: null,
        profile: null,
        recovery: false,
        profileError: null,
        error: action.error ?? null,
      };
    case 'profile':
      return { ...state, profile: action.profile, profileError: action.error };
    case 'recovery':
      return { ...state, recovery: true, ready: true };
    case 'end-recovery':
      return { ...state, recovery: false };
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
  requestPasswordReset(email: string): Promise<ServiceResult>;
  updatePassword(password: string): Promise<ServiceResult>;
  resendConfirmation(email: string): Promise<ServiceResult>;
  updateProfile(patch: ProfilePatch): Promise<ServiceResult<Profile>>;
  refreshProfile(): Promise<void>;
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
    dispatch({ type: 'session', session });

    if (event === 'signed-in' || event === 'initial') {
      const target = sessionStorage.getItem(OAUTH_RETURN);
      if (target) {
        sessionStorage.removeItem(OAUTH_RETURN);
        if (target.startsWith('/')) navigate(target, { replace: true });
      }
    }

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
  }, [applySession]);

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
      sessionStorage.removeItem(RECOVERY_MARKER);
      sessionStorage.removeItem(OAUTH_RETURN);
      dispatch({ type: 'anonymous' });
    } else {
      dispatch({ type: 'error', error: result.error });
    }
    return result;
  }, []);

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

  const actions = useMemo<AuthActions>(
    () => ({
      signIn,
      signUp,
      signInWithOAuth,
      signOut,
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      updateProfile,
      refreshProfile,
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
      requestPasswordReset,
      updatePassword,
      resendConfirmation,
      updateProfile,
      refreshProfile,
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
