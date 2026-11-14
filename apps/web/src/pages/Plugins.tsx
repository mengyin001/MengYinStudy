import { useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icons';
import { OfficialStatus } from '@/components/OfficialStatus';
import { Empty, Note, PageHead, Sheet } from '@/components/ui';
import { questionTypes } from '@/domain/registry';
import { describeBackendError } from '@/i18n/backend';
import type { Translate } from '@/i18n/messages';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useOfficialContent } from '@/state/OfficialContentContext';
import { useUserDecks } from '@/state/UserDecksContext';
import type { PluginView } from '@/domain/library';

function isFeaturePlugin(plugin: PluginView): boolean {
  return Boolean(plugin.manifest.entry) || plugin.manifest.questionTypes.length > 0;
}

function FeatureCard({
  plugin,
  t,
  onRemove,
}: {
  plugin: PluginView;
  t: Translate;
  onRemove?: () => void;
}) {
  const types = plugin.manifest.questionTypes.length;
  return (
    <article className="plugin">
      <div className="plugin__head">
        <h3 className="plugin__name">{plugin.name}</h3>
        <span
          className={`badge ${
            plugin.source === 'official' ? 'badge--official' : plugin.source === 'cloud' ? 'badge--cloud' : ''
          }`}
        >
          {plugin.source === 'official'
            ? t('plugins.official')
            : plugin.source === 'cloud'
              ? t('plugins.cloud')
              : plugin.source === 'local'
                ? t('plugins.local')
                : t('plugins.builtin')}
        </span>
        {plugin.source !== 'official' ? (
          <span className="plugin__meta">v{plugin.version}</span>
        ) : null}
      </div>
      {plugin.description ? <p className="plugin__desc">{plugin.description}</p> : null}
      <div className="plugin__stats">
        <span>{types > 0 ? t('plugins.typeCount', { n: types }) : t('plugins.featureNoTypes')}</span>
        {plugin.manifest.entry ? <span>{t('plugins.runtime')}</span> : null}
        {plugin.manifest.author ? <span>{t('plugins.by', { author: plugin.manifest.author })}</span> : null}
      </div>
      <div className="plugin__foot">
        <code>{plugin.dir}/</code>
        {onRemove ? (
          <button type="button" className="text-btn" onClick={onRemove}>
            {t('plugins.removeFeature')}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function PluginsPage() {
  const {
    state,
    deckViews,
    plugins,
    guestDeckKeys,
    officialDeckKeys,
    cloudDeckKeys,
    t,
    actions,
  } = useApp();
  const { state: official } = useOfficialContent();
  const { state: auth } = useAuth();
  const { state: cloud, sources: cloudSources } = useUserDecks();
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const typeRows = useMemo(() => {
    const rows = questionTypes.list().map(({ item, pluginId }) => ({
      id: item.id,
      label: item.label,
      pluginId,
    }));
    rows.push({ id: 'code', label: t('type.code'), pluginId: 'official.code' });
    return rows;
  }, [state.local, state.bundled, official.packs, t]);

  const featurePlugins = useMemo(
    () =>
      plugins.filter(
        (plugin) =>
          isFeaturePlugin(plugin) || (plugin.source === 'cloud' && cloudSources.has(plugin.id)),
      ),
    [plugins, cloudSources],
  );
  const issues = [...state.issues, ...official.issues];
  const removeView = removeKey ? deckViews.find((view) => view.deck.key === removeKey) : undefined;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await actions.importPluginFiles(files);
  };

  const confirmRemove = async () => {
    if (!removeKey) return;
    setRemoving(true);
    await actions.deleteDeck(removeKey);
    setRemoving(false);
    setRemoveKey(null);
  };

  const sourceOf = (key: string): string => {
    if (guestDeckKeys.has(key)) return t('lib.guestBadge');
    if (officialDeckKeys.has(key)) return t('plugins.official');
    if (cloudDeckKeys.has(key)) return t('plugins.cloud');
    return t('plugins.local');
  };

  return (
    <div className="page">
      <PageHead
        title={t('plugins.title')}
        lede={t('plugins.subtitle')}
        actions={
          <>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => void actions.reloadPlugins()}>
              <Icon name="refresh" size={13} strokeWidth={1.6} />
              {t('plugins.rescan')}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => dirInput.current?.click()}>
              {t('plugins.importFolder')}
            </button>
            <button type="button" className="btn btn--sm" onClick={() => fileInput.current?.click()}>
              {t('plugins.importFile')}
            </button>
          </>
        }
      />

      <OfficialStatus detailed />

      {auth.user && !cloud.ready ? <Note>{t('plugins.cloudLoading')}</Note> : null}
      {cloud.error ? (
        <Note>
          {t('plugins.cloudError')} {describeBackendError(cloud.error, t)}
        </Note>
      ) : (
        <Note>{auth.user ? t('plugins.autoSync') : t('plugins.cloudSignedOut')}</Note>
      )}

      <input
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
        ref={(element) => {
          dirInput.current = element;
          element?.setAttribute('webkitdirectory', '');
        }}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,.csv,.tsv,.txt,application/json,text/csv"
        hidden
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {issues.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('plugins.issues', { n: issues.length })}</h2>
            <span className="panel__more">{t('plugins.issuesHint')}</span>
          </div>
          <div className="issues">
            {issues.slice(0, 12).map((issue, index) => (
              <div className="issues__item" key={`${issue.pluginId}-${index}`}>
                <span className="issues__plugin">{issue.pluginName}</span>
                <span className="issues__path">{issue.path}</span>
                <span className="issues__message">{issue.message}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('plugins.officialFeatures')}</h2>
        </div>
        <article className="plugin">
          <div className="plugin__head">
            <h3 className="plugin__name">{t('plugins.codeFeature')}</h3>
            <span className="badge badge--official">{t('plugins.official')}</span>
          </div>
          <p className="plugin__desc">{t('plugins.codeFeatureDesc')}</p>
          <div className="plugin__stats">
            <span>{t('plugins.codeLanguages')}</span>
            <span>{t('plugins.examSafe')}</span>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('plugins.features')}</h2>
          <span className="panel__more">{t('plugins.featureCount', { n: featurePlugins.length })}</span>
        </div>
        {featurePlugins.length === 0 ? (
          <Empty title={t('plugins.noFeatures')} body={t('plugins.noFeaturesHint')} />
        ) : (
          <div className="plugin-list">
            {featurePlugins.map((plugin) => (
              <FeatureCard
                key={`${plugin.source}-${plugin.id}`}
                plugin={plugin}
                t={t}
                {...(plugin.source === 'local'
                  ? { onRemove: () => void actions.removeLocalPlugin(plugin.id) }
                  : {})}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('plugins.yourDecks')}</h2>
          <span className="panel__more">
            {t('plugins.deckCount', { n: deckViews.length })}
          </span>
        </div>
        {deckViews.length === 0 ? (
          <Empty title={t('plugins.noDecks')} body={t('plugins.noDecksHint')} />
        ) : (
          <div className="rows">
            {deckViews.map((view) => (
              <div className="row" key={view.deck.key}>
                <div className="row__main">
                  <span className="row__title">{view.deck.title}</span>
                  <span className="row__meta">
                    <span className="badge">{sourceOf(view.deck.key)}</span>
                    {view.total} {t('common.questions')}
                    {view.deck.tags.length > 0 ? ` · ${view.deck.tags.slice(0, 3).join(' · ')}` : ''}
                  </span>
                </div>
                {!guestDeckKeys.has(view.deck.key) ? (
                  <button
                    type="button"
                    className="text-btn"
                    title={t('lib.remove')}
                    onClick={() => setRemoveKey(view.deck.key)}
                  >
                    {t('lib.remove')}
                  </button>
                ) : (
                  <span className="footnote">{t('lib.guestBadge')}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="footnote">{t('plugins.deckDeleteHint')}</p>
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('plugins.customTypes')}</h2>
            <span className="panel__more">{t('plugins.typesHint', { n: typeRows.length })}</span>
          </div>
          <div className="type-list">
            {typeRows.map((row) => (
              <div className="type-row" key={row.id}>
                <code>{row.id}</code>
                <span className="type-row__label">{row.label}</span>
                <span className="badge">{row.pluginId === 'builtin' ? t('plugins.builtin') : row.pluginId}</span>
              </div>
            ))}
          </div>
          <Note>{t('plugins.customTypeHint')}</Note>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('plugins.add')}</h2>
          </div>
          <ol className="steps">
            <li>{t('plugins.step1')}</li>
            <li>{t('plugins.step2')}</li>
            <li>{t('plugins.step3')}</li>
            <li>{t('plugins.step4')}</li>
          </ol>
          <pre className="code-block">{`npm run plugin:new -- my-plugin
npm run plugins:sync`}</pre>
          <p className="footnote">{t('plugins.guide')}</p>
          <p className="footnote">{t('plugins.importedNote')}</p>
        </section>
      </div>

      <Note>{t('plugins.officialHint')}</Note>

      <Sheet
        open={!!removeView}
        title={t('lib.removeTitle')}
        onClose={() => setRemoveKey(null)}
        footer={
          <>
            <button type="button" className="btn btn--quiet" onClick={() => setRemoveKey(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void confirmRemove()}
              disabled={removing}
            >
              {removing ? t('common.loading') : t('lib.removeConfirm')}
            </button>
          </>
        }
      >
        <p>{t('lib.removeBody', { name: removeView?.deck.title ?? '' })}</p>
        <p className="footnote">{t('lib.removeHint')}</p>
      </Sheet>
    </div>
  );
}
