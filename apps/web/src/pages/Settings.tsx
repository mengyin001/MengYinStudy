import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icons';
import { Meter, NumField, PageHead, Seg, Sheet, Switch } from '@/components/ui';
import { formatBytes } from '@/lib/format';
import { appStore } from '@/lib/storage';
import { APP_NAME, APP_VERSION } from '@/lib/version';
import { backend } from '@/services';
import type { UserMediaUsage } from '@/services/types';
import { USER_MEDIA_LIMIT_BYTES } from '@/services/supabase/userMedia';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';

export function SettingsPage() {
  const { state, entries, plugins, sync, t, actions } = useApp();
  const { state: auth } = useAuth();
  const settings = state.progress.settings;
  const importInput = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [mediaUsage, setMediaUsage] = useState<UserMediaUsage | null>(null);

  useEffect(() => {
    let active = true;
    if (!auth.user) {
      setMediaUsage(null);
      return () => {
        active = false;
      };
    }
    backend.userMedia
      .usage()
      .then((usage) => {
        if (active) setMediaUsage(usage);
      })
      .catch(() => {
        if (active) setMediaUsage(null);
      });
    return () => {
      active = false;
    };
  }, [auth.user]);

  const storageKind =
    appStore.kind === 'indexeddb' ? t('settings.storageIndexedDb') : t('settings.storageMemory');

  return (
    <div className="page">
      <PageHead title={t('settings.title')} lede={t('settings.subtitle')} />

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('settings.appearance')}</h2>
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.language')}</span>
            </div>
            <Seg
              value={settings.locale}
              onChange={(locale) => actions.updateSettings({ locale })}
              label={t('settings.language')}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-Hant', label: '繁體中文' },
              ]}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.theme')}</span>
            </div>
            <Seg
              value={settings.theme}
              onChange={(theme) => actions.updateSettings({ theme })}
              label={t('settings.theme')}
              options={[
                { value: 'system', label: t('settings.themeSystem') },
                { value: 'light', label: t('settings.themeLight') },
                { value: 'dark', label: t('settings.themeDark') },
              ]}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.fontSize')}</span>
            </div>
            <Seg
              value={settings.fontScale}
              onChange={(fontScale) => actions.updateSettings({ fontScale })}
              label={t('settings.fontSize')}
              options={[
                { value: 'cozy', label: t('settings.fontCozy') },
                { value: 'normal', label: t('settings.fontNormal') },
                { value: 'large', label: t('settings.fontLarge') },
              ]}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('settings.practice')}</h2>
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.reveal')}</span>
              <span className="setting__hint">{t('settings.revealHint')}</span>
            </div>
            <Switch
              checked={settings.revealInPractice}
              onChange={(revealInPractice) => actions.updateSettings({ revealInPractice })}
              label={t('settings.reveal')}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.autoNext')}</span>
              <span className="setting__hint">{t('settings.autoNextHint')}</span>
            </div>
            <Switch
              checked={settings.autoNext}
              onChange={(autoNext) => actions.updateSettings({ autoNext })}
              label={t('settings.autoNext')}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.timer')}</span>
            </div>
            <Switch
              checked={settings.showTimer}
              onChange={(showTimer) => actions.updateSettings({ showTimer })}
              label={t('settings.timer')}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.shuffle')}</span>
              <span className="setting__hint">{t('settings.shuffleHint')}</span>
            </div>
            <Switch
              checked={settings.shuffleOptions}
              onChange={(shuffleOptions) => actions.updateSettings({ shuffleOptions })}
              label={t('settings.shuffle')}
            />
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('settings.goals')}</h2>
        </div>

        <div className="setting">
          <div className="setting__text">
            <span className="setting__label">{t('settings.dailyTarget')}</span>
            <span className="setting__hint">{t('settings.dailyTargetHint')}</span>
          </div>
          <NumField
            label={t('settings.dailyTarget')}
            value={settings.dailyTarget}
            min={5}
            max={300}
            step={5}
            onChange={(dailyTarget) => actions.updateSettings({ dailyTarget })}
          />
        </div>

        <div className="setting">
          <div className="setting__text">
            <span className="setting__label">{t('settings.examLength')}</span>
            <span className="setting__hint">{t('settings.examLengthHint')}</span>
          </div>
        </div>

        <div className="setting">
          <div className="setting__text">
            <span className="setting__label">{t('settings.autoNextMs')}</span>
          </div>
          <NumField
            label={t('settings.autoNextMs')}
            value={settings.autoNextMs}
            min={300}
            max={4000}
            step={100}
            suffix="ms"
            onChange={(autoNextMs) => actions.updateSettings({ autoNextMs })}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('settings.data')}</h2>
          <span className="panel__more">{t('settings.storage', { kind: appStore.kind })}</span>
        </div>

        <div className="actions-row">
          <button type="button" className="btn btn--sm" onClick={() => actions.exportData()}>
            <Icon name="download" size={13} strokeWidth={1.6} />
            {t('settings.export')}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => importInput.current?.click()}>
            <Icon name="upload" size={13} strokeWidth={1.6} />
            {t('settings.import')}
          </button>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => actions.syncNow()}
            disabled={!auth.user || sync.phase === 'syncing'}
          >
            <Icon name="rotate" size={13} strokeWidth={1.6} />
            {sync.phase === 'syncing' ? t('settings.syncSyncing') : t('settings.syncNow')}
          </button>
          <button type="button" className="btn btn--danger btn--sm" onClick={() => setResetOpen(true)}>
            {t('settings.reset')}
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void actions.importData(file);
              event.target.value = '';
            }}
          />
        </div>

        <p className="footnote" style={{ marginTop: 'var(--s2)' }}>
          {t('settings.dataHint')}
        </p>
        <p className="footnote">{auth.user ? t('settings.syncHint') : t('settings.syncSignedOut')}</p>
        {auth.user ? (
          <p className="footnote">
            <span
              className={`badge ${
                sync.phase === 'error' ? 'badge--bad' : sync.phase === 'idle' ? 'badge--ok' : ''
              }`}
            >
              {sync.phase === 'error'
                ? t('settings.syncFailed')
                : sync.phase === 'syncing'
                  ? t('settings.syncSyncing')
                  : sync.phase === 'idle'
                    ? t('settings.syncIdle')
                    : t('settings.syncWaiting')}
            </span>
            {sync.phase === 'error' && sync.error ? <span> {sync.error}</span> : null}
          </p>
        ) : (
          <p className="footnote">{t('settings.guestProgressHint')}</p>
        )}

        {auth.user ? (
          <div className="setting" style={{ marginTop: 'var(--s3)' }}>
            <div className="setting__text">
              <span className="setting__label">{t('settings.cloudMedia')}</span>
              <span className="setting__hint">
                {t('settings.cloudMediaHint', {
                  used: formatBytes(mediaUsage?.bytes ?? 0),
                  limit: formatBytes(mediaUsage?.limit ?? USER_MEDIA_LIMIT_BYTES),
                })}
              </span>
            </div>
            <span className="setting__value">
              {formatBytes(mediaUsage?.bytes ?? 0)} /{' '}
              {formatBytes(mediaUsage?.limit ?? USER_MEDIA_LIMIT_BYTES)}
            </span>
          </div>
        ) : null}
        {auth.user && mediaUsage ? (
          <>
            <Meter value={mediaUsage.limit > 0 ? mediaUsage.bytes / mediaUsage.limit : 0} accent />
            <p className="footnote">
              {t('settings.cloudMediaBreakdown', {
                text: formatBytes(mediaUsage.deckBytes),
                images: formatBytes(mediaUsage.storageBytes),
              })}
            </p>
          </>
        ) : null}
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('settings.shortcuts')}</h2>
          </div>
          <div className="shortcut-table">
            <div className="shortcut-table__row">
              <kbd>1</kbd>–<kbd>9</kbd>
              <span>{t('settings.shortcutChoose')}</span>
            </div>
            <div className="shortcut-table__row">
              <kbd>Enter</kbd>
              <span>{t('settings.shortcutEnter')}</span>
            </div>
            <div className="shortcut-table__row">
              <kbd>←</kbd>
              <kbd>→</kbd>
              <span>{t('settings.shortcutMove')}</span>
            </div>
            <div className="shortcut-table__row">
              <kbd>F</kbd>
              <span>{t('settings.shortcutFlag')}</span>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('settings.about')}</h2>
            <span className="panel__more">v{APP_VERSION}</span>
          </div>
          <div className="about">
            <div className="about__row">
              <span className="about__key">{t('settings.aboutApp')}</span>
              <span>{APP_NAME}</span>
            </div>
            <div className="about__row">
              <span className="about__key">{t('settings.aboutQuestions')}</span>
              <span>
                {t('settings.questionsValue', {
                  n: entries.length,
                  m: plugins.length,
                })}
              </span>
            </div>
            <div className="about__row">
              <span className="about__key">{t('settings.aboutAttempts')}</span>
              <span>{state.progress.attempts.length}</span>
            </div>
            <div className="about__row">
              <span className="about__key">{t('settings.aboutStorage')}</span>
              <span>{storageKind}</span>
            </div>
            <div className="about__row">
              <span className="about__key">{t('settings.legal')}</span>
              <span className="about__links">
                <a href="#/privacy">{t('legal.privacy')}</a>
                <span aria-hidden="true">·</span>
                <a href="#/terms">{t('legal.terms')}</a>
              </span>
            </div>
          </div>
        </section>
      </div>

      <Sheet
        open={resetOpen}
        title={t('settings.resetTitle')}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--quiet" onClick={() => setResetOpen(false)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                actions.resetProgress();
                setResetOpen(false);
              }}
            >
              {t('settings.resetConfirm')}
            </button>
          </>
        }
      >
        <p>{t('settings.resetBody')}</p>
      </Sheet>

    </div>
  );
}
