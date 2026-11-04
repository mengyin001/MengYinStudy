import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? '?';
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

export function AccountChip() {
  const { t } = useApp();
  const { state } = useAuth();
  const signedIn = state.status === 'authenticated';
  const name = state.profile?.displayName ?? state.user?.displayName ?? state.user?.email ?? '';
  const avatar = state.profile?.avatarUrl ?? state.user?.avatarUrl ?? null;
  const label = signedIn ? name || t('account.title') : t('account.signIn');

  return (
    <button
      type="button"
      className={`account-chip ${signedIn ? 'is-signed-in' : ''}`}
      onClick={() => navigate(signedIn ? '/account' : '/login')}
      title={label}
    >
      <span className="account-chip__avatar" aria-hidden="true">
        {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : initials(name || '?')}
      </span>
      <span className="account-chip__meta">
        <span className="account-chip__name">{label}</span>
        <span className="account-chip__hint">
          {signedIn ? t('account.signedInHint') : t('account.signInHint')}
        </span>
      </span>
    </button>
  );
}

export function MobileAccountButton() {
  const { t } = useApp();
  const { state } = useAuth();
  const signedIn = state.status === 'authenticated';
  const name = state.profile?.displayName ?? state.user?.displayName ?? state.user?.email ?? '';
  const avatar = state.profile?.avatarUrl ?? state.user?.avatarUrl ?? null;
  return (
    <button
      type="button"
      className="mobile-top__account"
      aria-label={signedIn ? t('account.title') : t('account.signIn')}
      onClick={() => navigate(signedIn ? '/account' : '/login')}
    >
      {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : initials(name || '?')}
    </button>
  );
}
