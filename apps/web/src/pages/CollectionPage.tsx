import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icons';
import { CollectionEditorSheet } from '@/components/CollectionSheets';
import { Empty, Meter, Note, PageHead, Sheet } from '@/components/ui';
import { buildCollectionView } from '@/domain/collections';
import type { DeckView } from '@/domain/library';
import { questionTypeLabel } from '@/domain/registry';
import { describeBackendError } from '@/i18n/backend';
import type { MessageKey } from '@/i18n/messages';
import { formatDate, pct, shorten } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useCollections } from '@/state/CollectionsContext';

export function CollectionPage({ collectionId }: { collectionId: string }) {
  const { t, locale, actions, deckViews, pluginNames } = useApp();
  const { state, authenticated, actions: collectionActions } = useCollections();
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addSelection, setAddSelection] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const collection = useMemo(
    () => state.collections.find((item) => item.id === collectionId) ?? null,
    [collectionId, state.collections],
  );
  const viewByKey = useMemo(() => new Map(deckViews.map((item) => [item.deck.key, item])), [deckViews]);
  const view = useMemo(
    () => (collection ? buildCollectionView(collection, viewByKey) : null),
    [collection, viewByKey],
  );
  const previewView = previewKey ? viewByKey.get(previewKey) : undefined;

  const availableDecks = useMemo(() => {
    if (!collection) return [];
    const inCollection = new Set(collection.deckKeys);
    const text = addQuery.trim().toLowerCase();
    return deckViews.filter((item) => {
      if (inCollection.has(item.deck.key)) return false;
      if (!text) return true;
      return [item.deck.title, item.deck.description ?? '', item.deck.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(text);
    });
  }, [addQuery, collection, deckViews]);

  const unit = (n: number, one: MessageKey, many: MessageKey) =>
    t(n === 1 ? one : many, { n });
  const back = () => navigate('/library');

  const openAdd = () => {
    setAddQuery('');
    setAddSelection(new Set());
    setAddOpen(true);
  };

  const addDecks = async () => {
    if (!collection || addSelection.size === 0) return;
    const result = await collectionActions.addDecks(collection.id, [...addSelection]);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    if (addSelection.size === 1) {
      actions.notify('success', t('collections.addedDecksOne'));
    } else {
      actions.notify('success', t('collections.addedDecks', { n: addSelection.size }));
    }
    setAddOpen(false);
    setAddSelection(new Set());
  };

  const removeDeck = async (deckKey: string) => {
    if (!collection) return;
    const result = await collectionActions.removeDeck(collection.id, deckKey);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    actions.notify('success', t('collections.removedDeck'));
  };

  const clearMissing = async () => {
    if (!collection || !view) return;
    const result = await collectionActions.setDecks(
      collection.id,
      view.decks.map((item) => item.deck.key),
    );
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    actions.notify('success', t('collections.clearedMissing'));
  };

  const startDeck = (deckView: DeckView) => {
    actions.startSession({
      mode: 'practice',
      entries: deckView.entries,
      label: deckView.deck.title,
    });
  };

  const backButton = (
    <button type="button" className="btn btn--quiet btn--sm" onClick={back}>
      <Icon name="chevronLeft" size={13} strokeWidth={1.6} />
      {t('collections.back')}
    </button>
  );

  if (!state.ready) {
    return (
      <div className="page collection-page">
        <PageHead title={t('collections.eyebrow')} actions={backButton} />
        <p className="footnote">{t('collections.loading')}</p>
      </div>
    );
  }

  if (!collection || !view) {
    return (
      <div className="page collection-page">
        <PageHead
          title={!authenticated ? t('collections.eyebrow') : t('collections.notFound')}
          actions={backButton}
        />
        {!authenticated ? (
          <Empty
            title={t('collections.signInHint')}
            action={
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => navigate(`/login?next=${encodeURIComponent(`/collections/${collectionId}`)}`)}
              >
                {t('collections.signIn')}
              </button>
            }
          />
        ) : (
          <Empty
            title={t('collections.notFound')}
            body={t('collections.notFoundHint')}
            action={
              <button type="button" className="btn btn--primary btn--sm" onClick={back}>
                {t('collections.back')}
              </button>
            }
          />
        )}
      </div>
    );
  }

  const previewFooter = previewView ? (
    <>
      <span className="sheet__hint">
        {t('lib.previewMeta', {
          n: previewView.total,
          seen: previewView.seen,
          accuracy: pct(previewView.ratio),
        })}
      </span>
      <div className="sheet__actions">
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPreviewKey(null)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary btn--sm" onClick={() => startDeck(previewView)}>
          {t('common.study')}
        </button>
      </div>
    </>
  ) : null;

  return (
    <div className="page collection-page">
      <PageHead
        eyebrow={t('collections.eyebrow')}
        title={collection.name}
        lede={t('collections.lede', {
          decks: unit(view.decks.length, 'plaza.deckCountOne', 'plaza.deckCount'),
          questions: unit(view.questionCount, 'plaza.questionCountOne', 'plaza.questionCount'),
        })}
        actions={
          <>
            <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
              <Icon name="plus" size={13} strokeWidth={1.8} />
              {t('collections.addDecks')}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditOpen(true)}>
              {t('collections.edit')}
            </button>
            {backButton}
          </>
        }
      />

      {state.error ? (
        <Note tone="warn">
          {t('collections.loadError')} · {describeBackendError(state.error, t)}
        </Note>
      ) : null}

      {collection.description ? <p className="collection-desc">{collection.description}</p> : null}
      <p className="collection-sync">
        <Icon name="check" size={12} strokeWidth={2} />
        {t('collections.shared')}
        <span>· {t('collections.updated', { date: formatDate(Date.parse(collection.updatedAt), locale) })}</span>
      </p>

      <section className="metrics">
        <div className="metric">
          <span className="metric__label">{t('collections.metricDecks')}</span>
          <span className="metric__value">{view.decks.length}</span>
          <span className="metric__hint">{unit(view.questionCount, 'plaza.questionCountOne', 'plaza.questionCount')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('collections.metricStudied')}</span>
          <span className="metric__value">
            {view.questionCount === 0 ? '—' : `${view.studied}/${view.questionCount}`}
          </span>
          {view.questionCount === 0 ? <span /> : <span className="metric__hint">{pct(view.ratio)}</span>}
        </div>
        <div className="metric">
          <span className="metric__label">{t('collections.metricDue')}</span>
          <span className="metric__value">{view.dueCount}</span>
          <span className="metric__hint">{t('stats.due7Hint')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('collections.metricAccuracy')}</span>
          <span className="metric__value">{view.decks.length === 0 ? '—' : pct(view.accuracy)}</span>
          <span className="metric__hint">{t('collections.accuracyHint')}</span>
        </div>
      </section>

      {view.missing.length > 0 ? (
        <Note tone="warn">
          {view.missing.length === 1
            ? t('collections.missingOne')
            : t('collections.missing', { n: view.missing.length })}{' '}
          <button type="button" className="text-btn" onClick={() => void clearMissing()}>
            {t('collections.clearMissing')}
          </button>
        </Note>
      ) : null}

      {view.decks.length === 0 ? (
        <Empty
          title={t('collections.emptyCollection')}
          body={t('collections.emptyCollectionHint')}
          action={
            <button type="button" className="btn btn--primary btn--sm" onClick={openAdd}>
              {t('collections.addDecks')}
            </button>
          }
        />
      ) : (
        <div className="deck-table">
          <div className="deck-table__head">
            <span>{t('lib.col.deck')}</span>
            <span>{t('lib.col.studied')}</span>
            <span>{t('lib.col.due')}</span>
            <span>{t('lib.col.accuracy')}</span>
            <span />
          </div>
          <ul>
            {view.decks.map((deckView) => (
              <li className="deck-row" key={deckView.deck.key}>
                <div className="deck-row__main">
                  <button
                    type="button"
                    className="deck-row__title"
                    onClick={() => setPreviewKey(deckView.deck.key)}
                  >
                    {deckView.deck.title}
                  </button>
                  <span className="deck-row__sub">
                    {pluginNames.get(deckView.deck.pluginId) ?? deckView.deck.pluginId} ·{' '}
                    {deckView.total} {t('common.questions')}
                    {deckView.deck.tags.length > 0
                      ? ` · ${deckView.deck.tags.slice(0, 3).join(' · ')}`
                      : ''}
                  </span>
                </div>
                <div className="deck-row__stats">
                  <div className="deck-row__cell">
                    <span className="deck-row__meter">
                      <Meter value={deckView.total === 0 ? 0 : deckView.seen / deckView.total} />
                    </span>
                    <span>
                      {deckView.seen}/{deckView.total}
                    </span>
                  </div>
                  <div className="deck-row__cell">
                    {deckView.dueCount > 0 ? (
                      <span className="due-count">{deckView.dueCount}</span>
                    ) : (
                      <span>—</span>
                    )}
                    <span className="deck-row__unit">{t('common.due')}</span>
                  </div>
                  <div className="deck-row__cell">
                    {deckView.attempts > 0 ? (
                      <span className="deck-row__acc">{pct(deckView.ratio)}</span>
                    ) : (
                      <span>—</span>
                    )}
                    <span className="deck-row__unit">{t('lib.col.accuracy')}</span>
                  </div>
                </div>
                <div className="deck-row__actions">
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setPreviewKey(deckView.deck.key)}
                  >
                    {t('common.preview')}
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => startDeck(deckView)}>
                    {t('common.study')}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('collections.removeDeck')}
                    title={t('collections.removeDeck')}
                    disabled={state.busy}
                    onClick={() => void removeDeck(deckView.deck.key)}
                  >
                    <Icon name="x" size={13} strokeWidth={1.8} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet
        open={addOpen}
        title={t('collections.addDecksTitle', { name: collection.name })}
        onClose={() => setAddOpen(false)}
        wide
        footer={
          <>
            <span className="sheet__hint">
              {t('collections.selectedCount', { n: addSelection.size })}
            </span>
            <div className="sheet__actions">
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setAddOpen(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={addSelection.size === 0 || state.busy}
                onClick={() => void addDecks()}
              >
                {state.busy ? t('collections.adding') : t('collections.addSelected', { n: addSelection.size })}
              </button>
            </div>
          </>
        }
      >
        <label className="search-field">
          <Icon name="search" size={14} strokeWidth={1.6} />
          <input
            type="search"
            value={addQuery}
            onChange={(event) => setAddQuery(event.target.value)}
            placeholder={t('collections.searchDecks')}
            aria-label={t('collections.searchDecks')}
          />
        </label>
        {availableDecks.length === 0 ? (
          <Empty
            title={deckViews.length === 0 ? t('collections.noLibraryDecks') : t('collections.noAvailableDecks')}
          />
        ) : (
          <div className="picker-list">
            {availableDecks.map((deckView) => {
              const checked = addSelection.has(deckView.deck.key);
              return (
                <label className={`picker-row ${checked ? 'is-on' : ''}`} key={deckView.deck.key}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={state.busy}
                    onChange={() => {
                      setAddSelection((current) => {
                        const next = new Set(current);
                        if (next.has(deckView.deck.key)) next.delete(deckView.deck.key);
                        else next.add(deckView.deck.key);
                        return next;
                      });
                    }}
                  />
                  <span className="picker-row__icon" aria-hidden="true">
                    <Icon name="book" size={14} strokeWidth={1.6} />
                  </span>
                  <span className="picker-row__body">
                    <span className="picker-row__name">{deckView.deck.title}</span>
                    <span className="picker-row__meta">
                      {deckView.total} {t('common.questions')}
                      {deckView.deck.tags.length > 0 ? ` · ${deckView.deck.tags.slice(0, 3).join(' · ')}` : ''}
                    </span>
                  </span>
                  <Icon name={checked ? 'check' : 'plus'} size={14} strokeWidth={1.8} />
                </label>
              );
            })}
          </div>
        )}
      </Sheet>

      <Sheet
        open={!!previewView}
        title={previewView?.deck.title ?? ''}
        onClose={() => setPreviewKey(null)}
        wide
        footer={previewFooter}
      >
        {previewView ? (
          <>
            {previewView.deck.description ? <p>{previewView.deck.description}</p> : null}
            {previewView.deck.tags.length > 0 ? (
              <p className="eyebrow">{previewView.deck.tags.join(' · ')}</p>
            ) : null}
            <div className="preview-list">
              {previewView.entries.slice(0, 12).map((entry, index) => (
                <div className="preview-row" key={entry.key}>
                  <span className="preview-row__index">{index + 1}</span>
                  <span className="preview-row__prompt">{shorten(entry.question.prompt, 90)}</span>
                  <span className="preview-row__meta">
                    {questionTypeLabel(entry.question.type, t)}
                  </span>
                </div>
              ))}
            </div>
            {previewView.entries.length > 12 ? (
              <p className="footnote">
                {t('plaza.previewMore', { n: previewView.entries.length - 12 })}
              </p>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <CollectionEditorSheet
        open={editOpen}
        initial={collection}
        busy={state.busy}
        onClose={() => setEditOpen(false)}
        onSave={async (input) => {
          const result = await collectionActions.update(collection.id, input);
          if (!result.ok) {
            actions.notify('error', describeBackendError(result.error, t));
            return false;
          }
          actions.notify('success', t('collections.saved'));
          return true;
        }}
        onDelete={async () => {
          const result = await collectionActions.remove(collection.id);
          if (!result.ok) {
            actions.notify('error', describeBackendError(result.error, t));
            return;
          }
          actions.notify('success', t('collections.deleted'));
          setEditOpen(false);
          back();
        }}
      />
    </div>
  );
}
