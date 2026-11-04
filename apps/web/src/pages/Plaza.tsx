import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icons';
import { Empty, Note, PageHead } from '@/components/ui';
import { describeBackendError } from '@/i18n/backend';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useOfficialContent } from '@/state/OfficialContentContext';
import { officialDeckKey, useUserLibrary } from '@/state/UserLibraryContext';

export function PlazaPage() {
  const { t, actions } = useApp();
  const { state: auth } = useAuth();
  const { state: official, sync } = useOfficialContent();
  const { state: library, keys, actions: libraryActions } = useUserLibrary();
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  const visiblePacks = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return official.packs;
    return official.packs.filter((pack) => {
      const haystack = [
        pack.manifest.name,
        pack.manifest.description ?? '',
        pack.manifest.tags.join(' '),
        ...pack.decks.flatMap((deck) => [deck.title, deck.description ?? '', deck.tags.join(' ')]),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(text);
    });
  }, [official.packs, query]);

  const change = async (packId: string, deckId: string, add: boolean) => {
    if (!auth.user) {
      navigate('/login?next=/plaza');
      return;
    }
    const key = officialDeckKey(packId, deckId);
    setWorking(key);
    const result = add
      ? await libraryActions.add(packId, deckId)
      : await libraryActions.remove(packId, deckId);
    setWorking(null);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    actions.notify(
      'success',
      add ? t('plaza.addedToast') : t('plaza.removedToast'),
    );
  };

  return (
    <div className="page">
      <PageHead
        title={t('plaza.title')}
        lede={t('plaza.subtitle')}
        actions={
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            onClick={() => void sync(true)}
            disabled={official.status === 'syncing' || official.status === 'disabled'}
          >
            <Icon name="refresh" size={13} strokeWidth={1.6} />
            {official.status === 'syncing' ? t('official.syncing') : t('official.check')}
          </button>
        }
      />

      {!auth.user ? <Note>{t('plaza.guestNote')}</Note> : <Note>{t('plaza.memberNote')}</Note>}
      {official.status === 'disabled' ? <Note tone="warn">{t('plaza.offline')}</Note> : null}
      {official.error ? (
        <Note tone="warn">
          {t('official.failed')} · {describeBackendError(official.error, t)}
        </Note>
      ) : null}
      {library.error ? (
        <Note tone="warn">
          {t('plaza.libraryError')} · {describeBackendError(library.error, t)}
        </Note>
      ) : null}

      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" size={14} strokeWidth={1.6} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('plaza.search')}
            aria-label={t('plaza.search')}
          />
        </label>
        <span className="panel__more">
          {t('plaza.count', { packs: official.packs.length, added: keys.size })}
        </span>
      </div>

      {visiblePacks.length === 0 ? (
        <Empty
          title={t('plaza.empty')}
          body={official.status === 'disabled' ? t('plaza.offlineHint') : t('plaza.emptyHint')}
        />
      ) : (
        <div className="plugin-list">
          {visiblePacks.map((pack) => {
            const questions = pack.decks.reduce(
              (sum, deck) => sum + deck.questions.length,
              0,
            );
            return (
              <article className="plugin" key={pack.manifest.id}>
                <div className="plugin__head">
                  <h3 className="plugin__name">{pack.manifest.name}</h3>
                  <span className="badge badge--official">{t('official.badge')}</span>
                  <span className="plugin__meta">
                    {pack.manifest.id} · v{pack.manifest.version}
                  </span>
                </div>
                {pack.manifest.description ? (
                  <p className="plugin__desc">{pack.manifest.description}</p>
                ) : null}
                <div className="plugin__stats">
                  <span>{t('plaza.deckCount', { n: pack.decks.length })}</span>
                  <span>{t('plaza.questionCount', { n: questions })}</span>
                  {pack.manifest.author ? (
                    <span>{t('plugins.by', { author: pack.manifest.author })}</span>
                  ) : null}
                  {pack.manifest.tags.length > 0 ? (
                    <span>{pack.manifest.tags.slice(0, 4).join(' · ')}</span>
                  ) : null}
                </div>

                <div className="rows">
                  {pack.decks.map((deck) => {
                    const key = officialDeckKey(pack.manifest.id, deck.id);
                    const added = keys.has(key);
                    const busy = working === key || library.busy;
                    return (
                      <div className="row" key={key}>
                        <div className="row__main">
                          <span className="row__title">{deck.title}</span>
                          <span className="row__meta">
                            {deck.questions.length} {t('common.questions')}
                            {deck.tags.length > 0 ? ` · ${deck.tags.slice(0, 3).join(' · ')}` : ''}
                          </span>
                        </div>
                        {added ? (
                          <>
                            <span className="badge badge--ok">{t('plaza.added')}</span>
                            <button
                              type="button"
                              className="text-btn"
                              disabled={busy}
                              onClick={() => void change(pack.manifest.id, deck.id, false)}
                            >
                              {t('lib.remove')}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--sm"
                            disabled={busy}
                            onClick={() => void change(pack.manifest.id, deck.id, true)}
                          >
                            <Icon name={auth.user ? 'plus' : 'arrowRight'} size={12} strokeWidth={2} />
                            {auth.user ? t('plaza.add') : t('plaza.signInToAdd')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!auth.user ? (
        <div className="actions-row">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/login?next=/plaza')}>
            {t('auth.signIn')}
          </button>
          <span className="footnote">{t('plaza.guestHint')}</span>
        </div>
      ) : null}
    </div>
  );
}
