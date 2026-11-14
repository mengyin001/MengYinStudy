import { useState } from 'react';
import { describeBackendError } from '@/i18n/backend';
import { formatDate } from '@/lib/format';
import { useApp } from '@/state/AppContext';
import { useOfficialContent } from '@/state/OfficialContentContext';
import { Icon } from './Icons';

/**
 * One-line status strip for the official catalogue. Used on Decks, Plugins and
 * Account so the sync state is never hidden behind a settings page.
 */
export function OfficialStatus({ detailed = false }: { detailed?: boolean }) {
  const { t, locale, actions } = useApp();
  const { state, retry } = useOfficialContent();
  const [busy, setBusy] = useState(false);

  const sync = async () => {
    if (busy || state.status === 'syncing') return;
    setBusy(true);
    const result = await retry();
    setBusy(false);
    if (result.ok) actions.notify('success', t('official.checked'));
    else actions.notify('error', describeBackendError(result.error, t));
  };

  const status = state.status;
  const tone = status === 'ready' ? 'ok' : status === 'stale' || status === 'error' ? 'warn' : 'neutral';
  const detail = state.syncedAt
    ? t('official.lastSync', { date: formatDate(state.syncedAt, locale) })
    : t('official.neverSynced');

  let label: string;
  if (status === 'disabled') {
    label =
      state.packs.length > 0 ? t('official.cache') : t('official.disabled');
  } else if (status === 'syncing') label = t('official.syncing');
  else if (status === 'error') label = t('official.failed');
  else if (status === 'stale') label = t('official.stale');
  else if (status === 'loading' || status === 'idle') label = t('official.loading');
  else if (state.packs.length === 0) label = t('official.bundled');
  else if (state.source === 'network') label = t('official.network');
  else if (state.source === 'cache') label = t('official.cache');
  else label = t('official.bundled');

  const buttonLabel = status === 'error' || status === 'stale' ? t('common.retry') : t('official.check');

  return (
    <div className={`official-bar official-bar--${tone}`}>
      <span className={`official-bar__dot official-bar__dot--${tone}`} aria-hidden="true" />
      <div className="official-bar__text">
        <span className="official-bar__label">{label}</span>
        {detailed || status === 'error' || status === 'stale' ? (
          <span className="official-bar__meta">
            {status === 'error' && state.error
              ? describeBackendError(state.error, t)
              : status === 'stale' && state.error
                ? `${detail} · ${describeBackendError(state.error, t)}`
                : detail}
          </span>
        ) : null}
        {state.issues.length > 0 ? (
          <span className="official-bar__meta official-bar__meta--warn">
            {t('official.issues', { n: state.issues.length })}
          </span>
        ) : null}
      </div>
      {status !== 'disabled' ? (
        <button
          type="button"
          className="btn btn--quiet btn--sm official-bar__action"
          onClick={() => void sync()}
          disabled={busy || status === 'syncing'}
        >
          <Icon name="refresh" size={12} strokeWidth={1.6} />
          {status === 'syncing' ? t('official.syncing') : buttonLabel}
        </button>
      ) : null}
    </div>
  );
}
