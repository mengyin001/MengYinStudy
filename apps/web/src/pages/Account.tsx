import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icons';
import { OfficialStatus } from '@/components/OfficialStatus';
import { Note, PageHead, Sheet } from '@/components/ui';
import { describeBackendError } from '@/i18n/backend';
import { formatDate } from '@/lib/format';
import { navigate } from '@/lib/router';
import type { BackendError } from '@/services/errors';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useUserDecks } from '@/state/UserDecksContext';
import { useUserLibrary } from '@/state/UserLibraryContext';

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]?.slice(0, 2).toUpperCase() ?? '?';
  return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
}

export function AccountPage() {
  const { t, locale, actions: appActions } = useApp();
  const { state, configured, configReason, actions } = useAuth();
  const { state: cloud } = useUserDecks();
  const { state: library } = useUserLibrary();
  const user = state.user;
  const profile = state.profile;
  const displayName = profile?.displayName ?? user?.displayName ?? user?.email ?? '';
  const [name, setName] = useState(displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<BackendError | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<BackendError | null>(null);

  useEffect(() => {
    setName(displayName);
  }, [displayName]);

  const save = async () => {
    setError(null);
    setBusy(true);
    const result = await actions.updateProfile({ displayName: name });
    setBusy(false);
    if (result.ok) appActions.notify('success', t('account.saved'));
    else setError(result.error);
  };

  const signOut = async () => {
    setBusy(true);
    const result = await actions.signOut();
    setBusy(false);
    if (result.ok) {
      appActions.notify('info', t('account.signedOut'));
      navigate('/login', { replace: true });
    } else {
      setError(result.error);
    }
  };

  const memberSince = profile?.createdAt ? Date.parse(profile.createdAt) : Number.NaN;
  const provider = user?.provider ?? 'email';
  const role = profile?.role === 'admin' ? t('account.admin') : t('account.user');
  const avatar = profile?.avatarUrl ?? user?.avatarUrl ?? null;

  // The learner types the word itself: a stray click on a destructive button
  // should not end an account, and the sheet should slow the decision down.
  const deleteWord = t('account.deleteWord');
  const canDelete = deleteTyped.trim().toUpperCase() === deleteWord.trim().toUpperCase();

  const closeDelete = () => {
    if (deleting) return;
    setDeleteOpen(false);
    setDeleteTyped('');
    setDeleteError(null);
  };

  const removeAccount = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await actions.deleteAccount();
    setDeleting(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    setDeleteOpen(false);
    setDeleteTyped('');
    appActions.notify('success', t('account.deleted'));
    navigate('/', { replace: true });
  };

  return (
    <div className="page">
      <PageHead
        title={t('account.title')}
        lede={t('account.lede')}
        actions={
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => void signOut()} disabled={busy}>
            {t('account.signOut')}
          </button>
        }
      />

      {!configured ? (
        <>
          <Note tone="warn">{t('auth.unconfiguredBody')}</Note>
          {configReason ? <p className="footnote">{configReason}</p> : null}
        </>
      ) : null}
      {state.profileError ? (
        <Note tone="warn">{describeBackendError(state.profileError, t)}</Note>
      ) : null}
      {error ? (
        <p className="notice notice--warn" role="alert">
          {describeBackendError(error, t)}
        </p>
      ) : null}
      {state.recovery ? (
        <Note tone="warn">
          {t('account.recoveryNotice')}{' '}
          <button type="button" className="text-btn" onClick={() => navigate('/reset-password')}>
            {t('account.resetPassword')}
          </button>
        </Note>
      ) : null}

      <div className="account-grid">
        <section className="panel account-panel">
          <div className="account-identity">
            <span className="account-avatar" aria-hidden="true">
              {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : initialsOf(displayName)}
            </span>
            <div className="account-identity__text">
              <h2 className="account-name">{displayName || t('account.unnamed')}</h2>
              <p className="account-email">{user?.email ?? '—'}</p>
              <p className="account-badges">
                <span className="badge badge--official">{role}</span>
                <span className="badge">{provider}</span>
                {user?.emailConfirmed ? <span className="badge badge--ok">{t('account.verified')}</span> : null}
              </p>
            </div>
          </div>

          <div className="account-form">
            <label className="field">
              <span className="field__label">{t('account.displayName')}</span>
              <input
                type="text"
                value={name}
                maxLength={80}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
              <span className="field__hint">{t('account.displayNameHint')}</span>
            </label>
            <div className="actions-row">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void save()}
                disabled={busy || name.trim().length === 0 || name.trim() === displayName}
              >
                <Icon name="check" size={13} strokeWidth={1.8} />
                {busy ? t('auth.working') : t('account.save')}
              </button>
            </div>
          </div>

          <dl className="account-kv">
            <div>
              <dt>{t('account.role')}</dt>
              <dd>{role}</dd>
            </div>
            <div>
              <dt>{t('account.provider')}</dt>
              <dd>{provider}</dd>
            </div>
            <div>
              <dt>{t('account.memberSince')}</dt>
              <dd>
                {Number.isFinite(memberSince) ? formatDate(memberSince, locale) : '—'}
              </dd>
            </div>
            <div>
              <dt>{t('account.cloudDecks')}</dt>
              <dd>{cloud.decks.length}</dd>
            </div>
            <div>
              <dt>{t('account.officialDecks')}</dt>
              <dd>{library.refs.length}</dd>
            </div>
          </dl>
        </section>

        <section className="panel account-panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('account.backend')}</h2>
            <span className="panel__more">{configured ? t('account.connected') : t('account.notConnected')}</span>
          </div>
          <OfficialStatus detailed />
          <div className="account-notes">
            <p className="footnote">{t('account.backendHint')}</p>
            <p className="footnote">{t('account.localNote')}</p>
          </div>
        </section>
      </div>

      <Note>{t('account.securityNote')}</Note>

      <section className="panel account-danger">
        <div className="panel__head">
          <h2 className="panel__title">{t('account.deleteTitle')}</h2>
        </div>
        <p className="footnote">{t('account.deleteBody')}</p>
        <div className="actions-row">
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => setDeleteOpen(true)}
            disabled={busy || deleting}
          >
            {t('account.deleteAction')}
          </button>
        </div>
      </section>

      <Sheet
        open={deleteOpen}
        title={t('account.deleteTitle')}
        onClose={closeDelete}
        footer={
          <>
            <button type="button" className="btn btn--quiet" onClick={closeDelete} disabled={deleting}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void removeAccount()}
              disabled={!canDelete || deleting}
            >
              {deleting ? t('account.deleting') : t('account.deleteConfirm')}
            </button>
          </>
        }
      >
        <p>{t('account.deleteSheetBody')}</p>
        <ul className="delete-list">
          <li>{t('account.deleteItemProfile')}</li>
          <li>{t('account.deleteItemDecks')}</li>
          <li>{t('account.deleteItemProgress')}</li>
          <li>{t('account.deleteItemLibrary')}</li>
        </ul>
        <p className="footnote">{t('account.deleteKeep')}</p>
        <label className="field">
          <span className="field__label">{t('account.deleteTypeLabel', { word: deleteWord })}</span>
          <input
            type="text"
            value={deleteTyped}
            onChange={(event) => setDeleteTyped(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={deleteWord}
          />
        </label>
        {deleteError ? (
          <Note tone="warn">{describeBackendError(deleteError, t)}</Note>
        ) : null}
      </Sheet>
    </div>
  );
}
