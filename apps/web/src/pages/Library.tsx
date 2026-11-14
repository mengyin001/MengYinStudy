import { useEffect, useMemo, useRef, useState } from 'react';
import {
  dueEntries,
  examMinutesForDeck,
  masteryMap,
  missedEntries,
  strengthOf,
  type Deck,
  type QuestionEntry,
  type StudyMode,
} from '@mengyin/core';
import { Icon } from '@/components/Icons';
import { CollectionEditorSheet, CollectionPickerSheet } from '@/components/CollectionSheets';
import { DeckEditorSheet } from '@/components/DeckEditorSheet';
import { OfficialStatus } from '@/components/OfficialStatus';
import { Empty, Meter, Note, PageHead, Sheet } from '@/components/ui';
import {
  OFFICIAL_PACK_COLLECTION_PREFIX,
  buildCollectionView,
  collectionsContainingDeck,
  isOfficialPackCollection,
} from '@/domain/collections';
import type { DeckView } from '@/domain/library';
import { questionTypeLabel } from '@/domain/registry';
import { describeBackendError } from '@/i18n/backend';
import { isAiDeck } from '@/domain/deckOrigin';
import type { MessageKey } from '@/i18n/messages';
import { pct, shorten } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useCollections } from '@/state/CollectionsContext';
import { useOfficialContent } from '@/state/OfficialContentContext';

type Filter = 'all' | 'due' | 'mistakes' | 'new';

interface ModeOption {
  mode: StudyMode;
  entries: QuestionEntry[];
  count: number;
  disabled: boolean;
  /** Exam only: the length this deck carries or estimates. */
  minutes?: number;
}

export function LibraryPage() {
  const {
    state,
    deckViews,
    pluginNames,
    guestDeckKeys,
    officialDeckKeys,
    cloudDeckKeys,
    editableDeckKeys,
    t,
    actions,
  } = useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [modeDeck, setModeDeck] = useState<string | null>(null);
  const [editDeckKey, setEditDeckKey] = useState<string | null>(null);
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDeckKey, setPendingDeckKey] = useState<string | null>(null);
  const [pickDeckKey, setPickDeckKey] = useState<string | null>(null);
  const {
    state: collectionsState,
    authenticated: collectionsAuthenticated,
    actions: collectionActions,
  } = useCollections();
  const { state: officialState } = useOfficialContent();
  const { state: auth } = useAuth();
  const ensuredPackCollections = useRef(new Set<string>());

  /**
   * Existing libraries may already contain a whole official pack without the
   * matching collection. Create it once so those decks move into "My
   * collections" instead of sitting in the flat deck list.
   */
  useEffect(() => {
    if (!collectionsAuthenticated || !collectionsState.ready || !auth.user) return;
    for (const pack of officialState.packs) {
      const id = `${auth.user.id}:${OFFICIAL_PACK_COLLECTION_PREFIX}${pack.manifest.id}`;
      if (collectionsState.collections.some((item) => item.id === id)) continue;
      if (ensuredPackCollections.current.has(id)) continue;
      const deckKeys = pack.decks.map((deck) => deck.key);
      if (deckKeys.length === 0) continue;
      if (!deckKeys.every((key) => officialDeckKeys.has(key))) continue;

      ensuredPackCollections.current.add(id);
      void collectionActions
        .create({
          id,
          name: pack.manifest.name,
          description: pack.manifest.description ?? null,
          deckKeys,
        })
        .then((result) => {
          if (!result.ok) ensuredPackCollections.current.delete(id);
        });
    }
  }, [
    auth.user,
    collectionActions,
    collectionsAuthenticated,
    collectionsState.collections,
    collectionsState.ready,
    officialDeckKeys,
    officialState.packs,
  ]);

  // A deck that belongs to a collection is browsed from that collection, not
  // from the flat deck list.
  const collectionDeckKeys = useMemo(() => {
    const hidden = new Set<string>();
    for (const collection of collectionsState.collections) {
      for (const key of collection.deckKeys) hidden.add(key);
    }
    return hidden;
  }, [collectionsState.collections]);
  const libraryDeckViews = useMemo(
    () => deckViews.filter((view) => !collectionDeckKeys.has(view.deck.key)),
    [deckViews, collectionDeckKeys],
  );

  const mastery = useMemo(() => masteryMap(state.progress.attempts), [state.progress.attempts]);
  const collectionViewByKey = useMemo(
    () => new Map(deckViews.map((view) => [view.deck.key, view])),
    [deckViews],
  );
  const collectionViews = useMemo(
    () =>
      collectionsState.collections.map((collection) =>
        buildCollectionView(collection, collectionViewByKey),
      ),
    [collectionViewByKey, collectionsState.collections],
  );
  const pickView = pickDeckKey ? collectionViewByKey.get(pickDeckKey) : undefined;
  const pickSelection = useMemo(
    () =>
      pickDeckKey
        ? collectionsContainingDeck(collectionsState.collections, pickDeckKey)
            .filter((item) => !isOfficialPackCollection(item.id))
            .map((item) => item.id)
        : [],
    [collectionsState.collections, pickDeckKey],
  );
  const unit = (n: number, one: MessageKey, many: MessageKey) =>
    t(n === 1 ? one : many, { n });

  const counts = useMemo(
    () => ({
      all: libraryDeckViews.length,
      due: libraryDeckViews.filter((view) => view.dueCount > 0).length,
      mistakes: libraryDeckViews.filter((view) => view.mistakeCount > 0).length,
      new: libraryDeckViews.filter((view) => view.seen === 0).length,
    }),
    [libraryDeckViews],
  );

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return libraryDeckViews.filter((view) => {
      if (filter === 'due' && view.dueCount === 0) return false;
      if (filter === 'mistakes' && view.mistakeCount === 0) return false;
      if (filter === 'new' && view.seen > 0) return false;
      if (!text) return true;
      const haystack = [
        view.deck.title,
        view.deck.description ?? '',
        view.deck.tags.join(' '),
        pluginNames.get(view.deck.pluginId) ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(text);
    });
  }, [libraryDeckViews, filter, pluginNames, query]);

  const selectedView = selected ? deckViews.find((view) => view.deck.key === selected) : undefined;
  const modeView = modeDeck ? deckViews.find((view) => view.deck.key === modeDeck) : undefined;
  const editView = editDeckKey ? deckViews.find((view) => view.deck.key === editDeckKey) : undefined;
  const removeView = removeKey ? deckViews.find((view) => view.deck.key === removeKey) : undefined;
  const totalQuestions = libraryDeckViews.reduce((sum, view) => sum + view.total, 0);

  const confirmRemove = async () => {
    if (!removeKey) return;
    setRemoving(true);
    await actions.deleteDeck(removeKey);
    setRemoving(false);
    setRemoveKey(null);
    setSelected(null);
  };

  const createCollection = async (input: { name: string; description: string | null }) => {
    const result = await collectionActions.create(input);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return false;
    }
    const created = result.value;
    let addFailed = false;
    if (pendingDeckKey) {
      const added = await collectionActions.addDecks(created.id, [pendingDeckKey]);
      if (!added.ok) {
        actions.notify('error', describeBackendError(added.error, t));
        addFailed = true;
      }
      setPendingDeckKey(null);
    }
    if (!addFailed) actions.notify('success', t('collections.created'));
    navigate(`/collections/${encodeURIComponent(created.id)}`);
    return true;
  };

  const saveCollectionPick = async (collectionIds: string[]) => {
    if (!pickDeckKey) return false;
    const result = await collectionActions.setDeckMembership(pickDeckKey, collectionIds);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return false;
    }
    actions.notify('success', t('collections.pickSaved'));
    return true;
  };

  const modeOptions = (view: DeckView): ModeOption[] => {
    const due = dueEntries(view.entries, state.progress.cards);
    const missed = missedEntries(view.entries, state.progress.attempts);
    const all = view.entries;
    return [
      { mode: 'practice', entries: all, count: all.length, disabled: all.length === 0 },
      { mode: 'drill', entries: all, count: all.length, disabled: all.length === 0 },
      {
        mode: 'exam',
        entries: all,
        count: all.length,
        disabled: all.length === 0,
        ...(all.length === 0 ? {} : { minutes: examMinutesForDeck(view.deck) }),
      },
      { mode: 'srs', entries: due, count: due.length, disabled: due.length === 0 },
      { mode: 'review', entries: missed, count: missed.length, disabled: missed.length === 0 },
    ];
  };

  const openModes = (view: DeckView) => {
    setSelected(null);
    setModeDeck(view.deck.key);
  };

  const startMode = (view: DeckView, option: ModeOption) => {
    if (option.disabled) return;
    actions.startSession({
      mode: option.mode,
      entries: option.entries,
      label: `${view.deck.title} · ${t(`mode.${option.mode}` as MessageKey)}`,
      ...(option.minutes === undefined ? {} : { timeLimitMs: option.minutes * 60_000 }),
    });
    setModeDeck(null);
  };

  const filterLabel: Record<Filter, MessageKey> = {
    all: 'lib.filter.all',
    due: 'lib.filter.due',
    mistakes: 'lib.filter.mistakes',
    new: 'lib.filter.new',
  };

  return (
    <div className="page">
      <PageHead
        title={t('lib.title')}
        lede={t('lib.subtitle', { decks: libraryDeckViews.length, questions: totalQuestions })}
        actions={
          <>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => navigate('/plaza')}>
              <Icon name="compass" size={13} strokeWidth={1.6} />
              {t('lib.openPlaza')}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => void actions.reloadPlugins()}>
              <Icon name="refresh" size={13} strokeWidth={1.6} />
              {t('lib.rescan')}
            </button>
          </>
        }
      />

      <OfficialStatus />

      <section className="collection-shelf-block">
        <div className="panel__head">
          <h2 className="panel__title">{t('collections.my')}</h2>
          {collectionsAuthenticated ? (
            <button type="button" className="panel__more" onClick={() => setCreateOpen(true)}>
              {t('collections.new')} →
            </button>
          ) : null}
        </div>

        {collectionsState.error ? (
          <Note tone="warn">
            {t('collections.loadError')} · {describeBackendError(collectionsState.error, t)}
          </Note>
        ) : null}

        {!collectionsAuthenticated ? (
          <div className="collection-empty">
            <p className="empty__body">{t('collections.signInHint')}</p>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => navigate('/login?next=/library')}
            >
              {t('collections.signIn')}
            </button>
          </div>
        ) : !collectionsState.ready ? (
          <p className="footnote">{t('collections.loading')}</p>
        ) : collectionViews.length === 0 ? (
          <div className="collection-empty">
            <div>
              <p className="empty__title">{t('collections.empty')}</p>
              <p className="empty__body">{t('collections.emptyHint')}</p>
            </div>
            <button type="button" className="btn btn--sm" onClick={() => setCreateOpen(true)}>
              {t('collections.new')}
            </button>
          </div>
        ) : (
          <div className="collection-shelf">
            {collectionViews.map((collectionView) => (
              <button
                type="button"
                className="collection-card"
                key={collectionView.collection.id}
                title={collectionView.collection.name}
                onClick={() =>
                  navigate(`/collections/${encodeURIComponent(collectionView.collection.id)}`)
                }
              >
                <span
                  className="collection-card__crest"
                  data-tone={collectionView.tone}
                  aria-hidden="true"
                >
                  {collectionView.crest}
                </span>
                <span className="collection-card__name">{collectionView.collection.name}</span>
                <span className="collection-card__meta">
                  {unit(collectionView.decks.length, 'plaza.deckCountOne', 'plaza.deckCount')}
                  {' · '}
                  {unit(collectionView.questionCount, 'plaza.questionCountOne', 'plaza.questionCount')}
                </span>
                <span className="collection-card__meter">
                  <Meter value={collectionView.ratio} accent />
                </span>
                <span className="collection-card__foot">
                  <span>{pct(collectionView.ratio)}</span>
                  <Icon name="chevronRight" size={13} strokeWidth={1.6} />
                </span>
              </button>
            ))}
            <button
              type="button"
              className="collection-card collection-card--new"
              onClick={() => setCreateOpen(true)}
            >
              <Icon name="plus" size={17} strokeWidth={1.6} />
              <span>{t('collections.new')}</span>
            </button>
          </div>
        )}
      </section>

      <div className="toolbar">
        <label className="search-field">
          <Icon name="search" size={14} strokeWidth={1.6} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('lib.search')}
            aria-label={t('lib.search')}
          />
        </label>

        <div className="filters" role="group" aria-label={t('lib.col.deck')}>
          {(Object.keys(filterLabel) as Filter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`filter ${filter === key ? 'is-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {t(filterLabel[key])}
              <span className="filter__count">{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty
          title={t('lib.empty')}
          body={t('lib.emptyHint')}
          action={
            <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/plaza')}>
              {t('lib.openPlaza')}
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
            {visible.map((view) => {
              const deck: Deck = view.deck;
              const ratio = view.total === 0 ? 0 : view.seen / view.total;
              return (
                <li className="deck-row" key={deck.key}>
                  <div className="deck-row__main">
                    <button type="button" className="deck-row__title" onClick={() => setSelected(deck.key)}>
                      {deck.title}
                    </button>
                    <span className="deck-row__sub">
                      {guestDeckKeys.has(deck.key) ? (
                        <span className="badge">{t('lib.guestBadge')}</span>
                      ) : null}
                      {isAiDeck(deck) ? (
                        <span className="badge badge--ai">{t('lib.aiBadge')}</span>
                      ) : null}
                      {officialDeckKeys.has(deck.key) ? (
                        <span className="badge badge--official">{t('official.badge')}</span>
                      ) : null}
                      {cloudDeckKeys.has(deck.key) ? (
                        <span className="badge badge--cloud">{t('plugins.cloud')}</span>
                      ) : null}
                      {pluginNames.get(deck.pluginId) ?? deck.pluginId} · {view.total}{' '}
                      {t('common.questions')}
                      {deck.tags.length > 0 ? ` · ${deck.tags.slice(0, 3).join(' · ')}` : ''}
                    </span>
                  </div>
                  <div className="deck-row__stats">
                    <div className="deck-row__cell">
                      <span className="deck-row__meter">
                        <Meter value={ratio} />
                      </span>
                      <span>
                        {view.seen}/{view.total}
                      </span>
                    </div>
                    <div className="deck-row__cell">
                      {view.dueCount > 0 ? <span className="due-count">{view.dueCount}</span> : <span>—</span>}
                      <span className="deck-row__unit">{t('common.due')}</span>
                    </div>
                    <div className="deck-row__cell">
                      {view.attempts > 0 ? <span className="deck-row__acc">{pct(view.ratio)}</span> : <span>—</span>}
                      <span className="deck-row__unit">{t('lib.col.accuracy')}</span>
                    </div>
                  </div>
                  <div className="deck-row__actions">
                    <button type="button" className="text-btn" onClick={() => setSelected(deck.key)}>
                      {t('common.preview')}
                    </button>
                    <button type="button" className="btn btn--sm" onClick={() => openModes(view)}>
                      {t('common.study')}
                    </button>
                    {editableDeckKeys.has(deck.key) ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={t('lib.editDeck')}
                        title={t('lib.editDeck')}
                        onClick={() => setEditDeckKey(deck.key)}
                      >
                        <Icon name="note" size={13} strokeWidth={1.6} />
                      </button>
                    ) : null}
                    {!guestDeckKeys.has(deck.key) ? (
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={t('lib.remove')}
                        title={t('lib.remove')}
                        onClick={() => setRemoveKey(deck.key)}
                      >
                        <Icon name="trash" size={13} strokeWidth={1.6} />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Sheet
        open={!!selectedView}
        title={selectedView?.deck.title ?? ''}
        onClose={() => setSelected(null)}
        wide
        footer={
          selectedView ? (
            <>
              <span className="sheet__hint">
                {isAiDeck(selectedView.deck) ? (
                  <span className="badge badge--ai">{t('lib.aiBadge')}</span>
                ) : null}
                {t('lib.previewMeta', {
                  n: selectedView.total,
                  seen: selectedView.seen,
                  accuracy: pct(selectedView.ratio),
                })}
              </span>
              <div className="deck-row__actions">
                {editableDeckKeys.has(selectedView.deck.key) ? (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      setSelected(null);
                      setEditDeckKey(selectedView.deck.key);
                    }}
                  >
                    {t('lib.editDeck')}
                  </button>
                ) : null}
                {collectionsAuthenticated ? (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      setSelected(null);
                      setPickDeckKey(selectedView.deck.key);
                    }}
                  >
                    {t('collections.addToCollection')}
                  </button>
                ) : null}
                {!guestDeckKeys.has(selectedView.deck.key) ? (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => {
                      setSelected(null);
                      setRemoveKey(selectedView.deck.key);
                    }}
                  >
                    {t('lib.remove')}
                  </button>
                ) : null}
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSelected(null)}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => openModes(selectedView)}
                >
                  {t('modes.title')}
                </button>
              </div>
            </>
          ) : null
        }
      >
        {selectedView ? (
          <>
            {selectedView.deck.description ? <p>{selectedView.deck.description}</p> : null}
            {selectedView.deck.tags.length > 0 ? (
              <p className="eyebrow">{selectedView.deck.tags.join(' · ')}</p>
            ) : null}
            <div className="preview-list">
              {selectedView.entries.map((entry, index) => {
                const strength = strengthOf(mastery.get(entry.key));
                const flagged = state.progress.flags[entry.key];
                return (
                  <div className="preview-row" key={entry.key}>
                    <span className="preview-row__index">{index + 1}</span>
                    <span className="preview-row__prompt">{shorten(entry.question.prompt, 90)}</span>
                    <span className="preview-row__meta">
                      <span>{questionTypeLabel(entry.question.type, t)}</span>
                      <span>·</span>
                      <span>{t(`strength.${strength.tone}` as MessageKey)}</span>
                      {flagged ? <Icon name="flag" size={12} strokeWidth={1.6} /> : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={!!modeView}
        title={modeView?.deck.title ?? ''}
        onClose={() => setModeDeck(null)}
        footer={
          <>
            <span className="sheet__hint">
              {modeView ? t('modes.count', { n: modeView.total }) : ''}
            </span>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setModeDeck(null)}>
              {t('common.cancel')}
            </button>
          </>
        }
      >
        {modeView ? (
          <>
            <p className="lede">{t('modes.title')}</p>
            <div className="mode-list">
              {modeOptions(modeView).map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  className="mode-option"
                  disabled={option.disabled}
                  onClick={() => startMode(modeView, option)}
                >
                  <span className="mode-option__main">
                    <span className="mode-option__title">{t(`mode.${option.mode}` as MessageKey)}</span>
                    <span className="mode-option__hint">
                      {t(`mode.${option.mode}Hint` as MessageKey)}
                    </span>
                  </span>
                  <span className="mode-option__count">
                    {t('modes.count', { n: option.count })}
                    {option.mode === 'exam' && option.minutes !== undefined
                      ? ` · ${option.minutes} ${t('modes.min')}`
                      : ''}
                  </span>
                  <Icon name="chevronRight" size={14} strokeWidth={1.6} />
                </button>
              ))}
            </div>
          </>
        ) : null}
      </Sheet>
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

      <CollectionPickerSheet
        open={!!pickDeckKey}
        deckTitle={pickView?.deck.title ?? ''}
        collections={collectionsState.collections.filter(
          (item) => !isOfficialPackCollection(item.id),
        )}
        initialSelected={pickSelection}
        busy={collectionsState.busy}
        onClose={() => setPickDeckKey(null)}
        onSave={saveCollectionPick}
        onCreate={() => {
          setPendingDeckKey(pickDeckKey);
          setPickDeckKey(null);
          setCreateOpen(true);
        }}
      />

      <CollectionEditorSheet
        open={createOpen}
        initial={null}
        busy={collectionsState.busy}
        onClose={() => {
          setCreateOpen(false);
          setPendingDeckKey(null);
        }}
        onSave={createCollection}
      />

      <DeckEditorSheet
        open={!!editView}
        deck={editView?.deck ?? null}
        onClose={() => setEditDeckKey(null)}
        onSave={(edit) => {
          if (!editDeckKey) return Promise.resolve(false);
          return actions.updateDeck(editDeckKey, edit);
        }}
      />
    </div>
  );
}
