import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { Note } from '@/components/ui';
import { describeBackendError } from '@/i18n/backend';
import type { BackendError } from '@/services/errors';
import type { OAuthProvider } from '@/services/types';
import { navigate, useRoute } from '@/lib/router';
import { APP_VERSION } from '@/lib/version';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';

type Mode = 'signin' | 'signup' | 'forgot';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.33-.18-1.96H12v3.71h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.27z"
      />
      <path
        fill="currentColor"
        opacity=".72"
        d="M12 22c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A10 10 0 0 0 12 22z"
      />
      <path
        fill="currentColor"
        opacity=".48"
        d="M6.41 13.9A6 6 0 0 1 6.1 12c0-.66.11-1.3.31-1.9V7.52H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.48z"
      />
      <path
        fill="currentColor"
        opacity=".32"
        d="M12 5.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.52l3.34 2.58C7.2 7.74 9.4 5.98 12 5.98z"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.86.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"
      />
    </svg>
  );
}

function OAuthButtons({ onPick, disabled }: { onPick: (provider: OAuthProvider) => void; disabled: boolean }) {
  const { t } = useApp();
  return (
    <div className="auth-oauth">
      <button type="button" className="btn auth-oauth__btn" disabled={disabled} onClick={() => onPick('google')}>
        <GoogleMark />
        {t('auth.google')}
      </button>
      <button type="button" className="btn auth-oauth__btn" disabled={disabled} onClick={() => onPick('github')}>
        <GitHubMark />
        {t('auth.github')}
      </button>
    </div>
  );
}

function PasswordField({
  value,
  onChange,
  autoComplete,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  label: string;
}) {
  const { t } = useApp();
  const [visible, setVisible] = useState(false);
  return (
    <label className="field auth-field">
      <span className="field__label">{label}</span>
      <span className="auth-password">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={8}
          maxLength={72}
        />
        <button
          type="button"
          className="auth-password__toggle text-btn"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
        >
          {visible ? t('auth.hide') : t('auth.show')}
        </button>
      </span>
    </label>
  );
}

export function AuthShell({
  mode,
  heading,
  children,
  footer,
}: {
  mode: Mode | 'reset';
  heading?: { eyebrow?: string; title: string; lede?: string };
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t, locale, actions } = useApp();
  const eyebrow = heading?.eyebrow ?? (mode === 'reset' ? t('auth.reset.eyebrow') : t(`auth.${mode}.eyebrow`));
  const title = heading?.title ?? t(`auth.${mode}.title`);
  const lede = heading?.lede ?? t(`auth.${mode}.lede`);
  return (
    <div className="auth-page">
      <div className="auth-lang">
        <button
          type="button"
          className={`lang-btn ${locale === 'en' ? 'is-active' : ''}`}
          onClick={() => actions.updateSettings({ locale: 'en' })}
        >
          EN
        </button>
        <button
          type="button"
          className={`lang-btn ${locale === 'zh-Hant' ? 'is-active' : ''}`}
          onClick={() => actions.updateSettings({ locale: 'zh-Hant' })}
        >
          繁中
        </button>
      </div>

      <aside className="auth-aside">
        <a
          className="brand auth-brand"
          href="#/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          <BrandMark className="brand__mark" />
          <span className="brand__word">{t('app.name')}</span>
        </a>

        <div className="auth-aside__body">
          <p className="eyebrow">{t('auth.eyebrow')}</p>
          <h1 className="auth-aside__title">{t('auth.asideTitle')}</h1>
          <p className="auth-aside__body-text">{t('auth.asideBody')}</p>
          <ul className="auth-points">
            <li>
              <span className="auth-points__num">01</span>
              <span>{t('auth.asidePoint1')}</span>
            </li>
            <li>
              <span className="auth-points__num">02</span>
              <span>{t('auth.asidePoint2')}</span>
            </li>
            <li>
              <span className="auth-points__num">03</span>
              <span>{t('auth.asidePoint3')}</span>
            </li>
          </ul>
        </div>

        <p className="auth-aside__foot">
          {t('app.tagline')} · v{APP_VERSION}
        </p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <header className="auth-card__head">
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p className="lede">{lede}</p>
          </header>
          {children}
        </div>
        {footer ? <div className="auth-switch">{footer}</div> : null}
      </main>
    </div>
  );
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { t } = useApp();
  const { state, configured, configReason, actions } = useAuth();
  const route = useRoute();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | BackendError | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);

  const next = route.query.get('next');
  const destination = next && next.startsWith('/') ? next : '/account';

  useEffect(() => {
    if (state.status === 'authenticated' && !state.recovery) {
      navigate(destination, { replace: true });
    }
  }, [state.status, state.recovery, destination]);

  useEffect(() => {
    if (state.recovery) navigate('/reset-password', { replace: true });
  }, [state.recovery]);

  const visibleError = configured ? (error ?? state.error) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    actions.clearError();
    setResent(false);

    const trimmedEmail = email.trim();
    if (!EMAIL.test(trimmedEmail)) {
      setError(t('auth.validation.email'));
      return;
    }

    if (mode === 'signup' && displayName.trim().length === 0) {
      setError(t('auth.validation.displayName'));
      return;
    }
    if (mode !== 'forgot') {
      if (password.length < 8) {
        setError(t('auth.validation.password'));
        return;
      }
      if (mode === 'signup' && password !== confirm) {
        setError(t('auth.validation.match'));
        return;
      }
    }

    setBusy(true);
    if (mode === 'signin') {
      const result = await actions.signIn(trimmedEmail, password);
      setBusy(false);
      if (!result.ok) setError(result.error);
      return;
    }
    if (mode === 'signup') {
      const result = await actions.signUp({
        email: trimmedEmail,
        password,
        displayName: displayName.trim(),
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error);
      } else if (result.value.needsConfirmation) {
        setPendingEmail(trimmedEmail);
      }
      return;
    }

    const result = await actions.requestPasswordReset(trimmedEmail);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setSent(true);
  };

  const oauth = async (provider: OAuthProvider) => {
    setError(null);
    actions.clearError();
    setBusy(true);
    const result = await actions.signInWithOAuth(provider);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
    }
  };

  const resend = async () => {
    if (!pendingEmail) return;
    setError(null);
    actions.clearError();
    setBusy(true);
    const result = await actions.resendConfirmation(pendingEmail);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else setResent(true);
  };

  if (pendingEmail) {
    return (
      <AuthShell
        mode="signup"
        heading={{
          eyebrow: t('auth.checkEmailEyebrow'),
          title: t('auth.checkEmailTitle'),
          lede: t('auth.checkEmailLede'),
        }}
        footer={
          <button type="button" className="text-btn" onClick={() => navigate('/login')}>
            {t('auth.backToSignIn')}
          </button>
        }
      >
        <div className="auth-done">
          <p className="auth-done__body">{t('auth.checkEmailBody', { email: pendingEmail })}</p>
          {error ? (
            <p className="notice notice--warn" role="alert">
              {typeof error === 'string' ? error : describeBackendError(error, t)}
            </p>
          ) : null}
          <div className="actions-row">
            <button type="button" className="btn btn--sm" onClick={() => void resend()} disabled={busy}>
              {busy ? t('auth.working') : t('auth.resend')}
            </button>
            {resent ? <span className="badge badge--ok">{t('auth.resendDone')}</span> : null}
          </div>
        </div>
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell
        mode="forgot"
        heading={{
          eyebrow: t('auth.resetSentEyebrow'),
          title: t('auth.resetSentTitle'),
          lede: t('auth.resetSentLede'),
        }}
        footer={
          <button type="button" className="text-btn" onClick={() => navigate('/login')}>
            {t('auth.backToSignIn')}
          </button>
        }
      >
        <div className="auth-done">
          <p className="auth-done__body">{t('auth.resetSentBody', { email: email.trim() })}</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      mode={mode}
      footer={
        mode === 'signin' ? (
          <>
            <span>{t('auth.noAccount')}</span>
            <button type="button" className="text-btn" onClick={() => navigate('/register')}>
              {t('auth.createAccount')}
            </button>
            <span className="auth-switch__sep">·</span>
            <button type="button" className="text-btn" onClick={() => navigate('/')}>
              {t('auth.guest')}
            </button>
          </>
        ) : mode === 'signup' ? (
          <>
            <span>{t('auth.haveAccount')}</span>
            <button type="button" className="text-btn" onClick={() => navigate('/login')}>
              {t('auth.signIn')}
            </button>
            <span className="auth-switch__sep">·</span>
            <button type="button" className="text-btn" onClick={() => navigate('/')}>
              {t('auth.guest')}
            </button>
          </>
        ) : (
          <button type="button" className="text-btn" onClick={() => navigate('/login')}>
            {t('auth.backToSignIn')}
          </button>
        )
      }
    >
      {!configured ? (
        <Note tone="warn">{t('auth.unconfiguredBody')}</Note>
      ) : null}
      {!configured && configReason ? <p className="footnote">{configReason}</p> : null}
      {visibleError ? (
        <p className="notice notice--warn" role="alert">
          {typeof visibleError === 'string' ? visibleError : describeBackendError(visibleError, t)}
        </p>
      ) : null}

      {mode === 'signin' || mode === 'signup' ? (
        <>
          <OAuthButtons onPick={(provider) => void oauth(provider)} disabled={!configured || busy} />
          <div className="auth-divider">
            <span>{t('auth.or')}</span>
          </div>
        </>
      ) : null}

      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        {mode === 'signup' ? (
          <label className="field auth-field">
            <span className="field__label">{t('auth.displayName')}</span>
            <input
              type="text"
              value={displayName}
              autoComplete="name"
              maxLength={80}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
        ) : null}

        <label className="field auth-field">
          <span className="field__label">{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        {mode !== 'forgot' ? (
          <PasswordField
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            label={t('auth.password')}
          />
        ) : null}

        {mode === 'signup' ? (
          <PasswordField
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            label={t('auth.confirmPassword')}
          />
        ) : null}

        {mode === 'signin' ? (
          <button type="button" className="auth-forgot text-btn" onClick={() => navigate('/forgot-password')}>
            {t('auth.forgot')}
          </button>
        ) : null}

        <button type="submit" className="btn btn--primary auth-submit" disabled={!configured || busy}>
          {busy
            ? t('auth.working')
            : mode === 'signin'
              ? t('auth.signIn')
              : mode === 'signup'
                ? t('auth.createAccount')
                : t('auth.sendReset')}
        </button>
      </form>

      <p className="auth-local-note">{t('auth.localNote')}</p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { t } = useApp();
  const { state, configured, actions } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | BackendError | null>(null);

  const canReset = state.status === 'authenticated' || state.recovery;

  if (!state.ready) {
    return (
      <div className="boot">
        <span className="boot__word">{t('app.name')}</span>
        <span className="boot__note">{t('common.loading')}</span>
      </div>
    );
  }

  if (!canReset) {
    return (
      <AuthShell
        mode="reset"
        footer={
          <button type="button" className="text-btn" onClick={() => navigate('/login')}>
            {t('auth.backToSignIn')}
          </button>
        }
      >
        <div className="auth-done">
          <p className="auth-done__title">{t('auth.resetLinkInvalidTitle')}</p>
          <p className="auth-done__body">{t('auth.resetLinkInvalidBody')}</p>
        </div>
      </AuthShell>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t('auth.validation.password'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.validation.match'));
      return;
    }
    setBusy(true);
    const result = await actions.updatePassword(password);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate('/account', { replace: true });
  };

  return (
    <AuthShell
      mode="reset"
      footer={
        <>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              actions.endRecovery();
              navigate(state.status === 'authenticated' ? '/account' : '/login');
            }}
          >
            {t('common.cancel')}
          </button>
          <span className="auth-switch__sep">·</span>
          <button type="button" className="text-btn" onClick={() => navigate('/account')}>
            {t('auth.account')}
          </button>
        </>
      }
    >
      {!configured ? <Note tone="warn">{t('auth.unconfiguredBody')}</Note> : null}
      {state.user?.email ? (
        <p className="footnote">{t('auth.resetFor', { email: state.user.email })}</p>
      ) : null}
      {error ? (
        <p className="notice notice--warn" role="alert">
          {typeof error === 'string' ? error : describeBackendError(error, t)}
        </p>
      ) : null}
      <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
        <PasswordField
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          label={t('auth.newPassword')}
        />
        <PasswordField
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          label={t('auth.confirmPassword')}
        />
        <button type="submit" className="btn btn--primary auth-submit" disabled={!configured || busy}>
          {busy ? t('auth.working') : t('auth.updatePassword')}
        </button>
      </form>
    </AuthShell>
  );
}
