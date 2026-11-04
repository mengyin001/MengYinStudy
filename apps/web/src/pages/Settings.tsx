import { useEffect, useRef, useState } from 'react';
import { isAiConfigured } from '@/ai/config';
import { testConnection } from '@/ai/client';
import { Icon } from '@/components/Icons';
import { Note, NumField, PageHead, Seg, Sheet, Switch } from '@/components/ui';
import { appStore } from '@/lib/storage';
import { navigate } from '@/lib/router';
import { APP_NAME, APP_VERSION } from '@/lib/version';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';

export function SettingsPage() {
  const { state, entries, plugins, sync, t, actions } = useApp();
  const { state: auth } = useAuth();
  const settings = state.progress.settings;
  const importInput = useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState(state.aiConfig);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    setAiDraft(state.aiConfig);
  }, [state.aiConfig]);

  const testAi = async () => {
    if (!auth.user) {
      actions.notify('info', t('settings.aiSignIn'));
      return;
    }
    if (!isAiConfigured(aiDraft)) {
      actions.notify('info', t('settings.aiNotConfigured'));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const { model } = await testConnection(aiDraft);
      setTestResult({ ok: true, message: t('settings.aiOk', { model }) });
    } catch (error) {
      setTestResult({
        ok: false,
        message: t('settings.aiFail', {
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    } finally {
      setTesting(false);
    }
  };

  const saveAi = () => {
    if (!auth.user) {
      actions.notify('info', t('settings.aiSignIn'));
      return;
    }
    actions.updateAiConfig(aiDraft);
    actions.notify('success', t('settings.aiSaved'));
  };

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
          <h2 className="panel__title">{t('settings.ai')}</h2>
          <span className="panel__more">v{APP_VERSION}</span>
        </div>
        <p className="footnote">{t('settings.aiHint')}</p>

        {!auth.user ? (
          <>
            <Note tone="warn">{t('settings.aiSignInBody')}</Note>
            <div className="actions-row">
              <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/login?next=/settings')}>
                {t('auth.signIn')}
              </button>
            </div>
          </>
        ) : (
          <>
        <div className="ai-form">
          <label className="field">
            <span className="field__label">{t('settings.aiBaseUrl')}</span>
            <input
              type="text"
              value={aiDraft.baseUrl}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setAiDraft({ ...aiDraft, baseUrl: event.target.value })}
            />
            <span className="field__hint">{t('settings.aiBaseUrlHint')}</span>
          </label>

          <label className="field">
            <span className="field__label">{t('settings.aiKey')}</span>
            <input
              type="password"
              value={aiDraft.apiKey}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setAiDraft({ ...aiDraft, apiKey: event.target.value })}
            />
            <span className="field__hint">{t('settings.aiKeyHint')}</span>
          </label>

          <label className="field">
            <span className="field__label">{t('settings.aiModel')}</span>
            <input
              type="text"
              value={aiDraft.model}
              placeholder="gpt-4o-mini"
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => setAiDraft({ ...aiDraft, model: event.target.value })}
            />
          </label>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.aiTemperature')}</span>
            </div>
            <NumField
              label={t('settings.aiTemperature')}
              value={aiDraft.temperature}
              min={0}
              max={2}
              step={0.1}
              onChange={(temperature) => setAiDraft({ ...aiDraft, temperature })}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.aiMaxTokens')}</span>
              <span className="setting__hint">{t('settings.aiMaxTokensHint')}</span>
            </div>
            <NumField
              label={t('settings.aiMaxTokens')}
              value={aiDraft.maxTokens}
              min={256}
              max={16_000}
              step={256}
              onChange={(maxTokens) => setAiDraft({ ...aiDraft, maxTokens })}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('settings.aiJsonMode')}</span>
              <span className="setting__hint">{t('settings.aiJsonModeHint')}</span>
            </div>
            <Switch
              checked={aiDraft.jsonMode}
              onChange={(jsonMode) => setAiDraft({ ...aiDraft, jsonMode })}
              label={t('settings.aiJsonMode')}
            />
          </div>
        </div>

        <Note>{t('settings.aiCodeNote')}</Note>

        <div className="actions-row">
          <button type="button" className="btn btn--primary btn--sm" onClick={saveAi}>
            {t('settings.aiSave')}
          </button>
          <button type="button" className="btn btn--sm" onClick={() => void testAi()} disabled={testing}>
            <Icon name="rotate" size={13} strokeWidth={1.6} />
            {testing ? t('settings.aiTesting') : t('settings.aiTest')}
          </button>
          {testResult ? (
            <span className={`badge ${testResult.ok ? 'badge--ok' : 'badge--bad'}`}>{testResult.message}</span>
          ) : null}
        </div>
          </>
        )}
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
