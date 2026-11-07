import { useEffect, useMemo, useState } from 'react';
import { startOfDay, type Deck } from '@mengyin/core';
import { Icon } from '@/components/Icons';
import { Empty, Meter, Note, PageHead, Seg, Sheet } from '@/components/ui';
import {
  buildPlazaPacks,
  collectTags,
  filterPlazaPacks,
  packProgress,
  sortPlazaPacks,
  type DeckProgressLookup,
  type PlazaDeckView,
  type PlazaPackView,
  type PlazaSort,
} from '@/domain/plaza';
import { entriesForDeck, type DeckView } from '@/domain/library';
import { questionTypeLabel } from '@/domain/registry';
import { describeBackendError } from '@/i18n/backend';
import type { MessageKey } from '@/i18n/messages';
import { formatDate, pct, shorten } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useOfficialContent } from '@/state/OfficialContentContext';
import { officialDeckKey, useUserLibrary } from '@/state/UserLibraryContext';

interface HeroView {
  pack: PlazaPackView;
  deckView: PlazaDeckView;
  added: boolean;
  started: boolean;
  view: DeckView | null;
}

export function PlazaPage() {
  const { state, t, locale, actions, deckViews, officialDeckKeys } = useApp();
  const { state: auth } = useAuth();
  const { state: official, sync } = useOfficialContent();
  const { state: library, keys, actions: libraryActions } = useUserLibrary();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<PlazaSort>('recommended');
  const [working, setWorking] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const packs = useMemo(() => buildPlazaPacks(official.packs), [official.packs]);
  const tags = useMemo(() => collectTags(packs, 6), [packs]);
  const viewByKey = useMemo(
    () => new Map<string, DeckProgressLookup>(deckViews.map((view) => [view.deck.key, view])),
    [deckViews],
  );
  const progressByPack = useMemo(
    () => new Map(packs.map((pack) => [pack.id, packProgress(pack, keys, viewByKey)])),
    [packs, keys, viewByKey],
  );

  const addedViews = useMemo(
    () => deckViews.filter((view) => officialDeckKeys.has(view.deck.key)),
    [deckViews, officialDeckKeys],
  );

  const totals = useMemo(() => {
    let decks = 0;
    let questions = 0;
    let added = 0;
    let studied = 0;
    for (const pack of packs) {
      decks += pack.deckCount;
      questions += pack.questionCount;
      const progress = progressByPack.get(pack.id);
      if (!progress) continue;
      added += progress.added;
      studied += progress.studied;
    }
    return { decks, questions, added, studied };
  }, [packs, progressByPack]);

  const todayCount = useMemo(() => {
    const start = startOfDay(Date.now());
    return state.progress.attempts.filter((attempt) => attempt.at >= start).length;
  }, [state.progress.attempts]);
  const dailyTarget = Math.max(1, state.progress.settings.dailyTarget);
  const goalRatio = Math.min(1, todayCount / dailyTarget);
  const goalMet = todayCount >= dailyTarget;

  const hero = useMemo<HeroView | null>(() => {
    if (packs.length === 0) return null;

    const active = [...addedViews].sort((a, b) => b.lastAt - a.lastAt)[0];
    if (active) {
      for (const pack of packs) {
        const deckView = pack.decks.find((item) => item.deck.key === active.deck.key);
        if (!deckView) continue;
        return {
          pack,
          deckView,
          added: true,
          started: active.attempts > 0,
          view: active,
        };
      }
    }

    const nextPack =
      packs.find((pack) => (progressByPack.get(pack.id)?.added ?? 0) < pack.deckCount) ?? packs[0];
    if (!nextPack) return null;
    const progress = progressByPack.get(nextPack.id);
    const deckView = progress?.nextDeck ?? nextPack.decks[0];
    if (!progress || !deckView) return null;
    return {
      pack: nextPack,
      deckView,
      added: keys.has(deckView.deck.key),
      started: false,
      view: null,
    };
  }, [addedViews, keys, packs, progressByPack]);

  const visiblePacks = useMemo(
    () => sortPlazaPacks(filterPlazaPacks(packs, { query, tag }), sort),
    [packs, query, sort, tag],
  );

  const sheetPack = sheetId ? (packs.find((pack) => pack.id === sheetId) ?? null) : null;
  const sheetProgress = sheetPack ? progressByPack.get(sheetPack.id) : undefined;
  const filtering = query.trim().length > 0 || tag !== null;
  const busy = working !== null || library.busy;
  const unit = (n: number, one: MessageKey, many: MessageKey) =>
    t(n === 1 ? one : many, { n });
  const packsLabel = unit(packs.length, 'plaza.packCountOne', 'plaza.packCount');
  const addedDecksLabel = unit(totals.added, 'plaza.deckCountOne', 'plaza.deckCount');

  useEffect(() => {
    if (tag && !tags.some((option) => option.tag === tag)) setTag(null);
  }, [tag, tags]);

  const login = () => navigate('/login?next=/plaza');

  const closeSheet = () => {
    setSheetId(null);
    setPreviewKey(null);
  };

  const openSheet = (packId: string) => {
    setSheetId(packId);
    setPreviewKey(null);
  };

  const startDeck = (deck: Deck) => {
    const entries = entriesForDeck(deck);
    if (entries.length === 0) {
      actions.notify('info', t('toast.nothing'));
      return;
    }
    closeSheet();
    actions.startSession({ mode: 'practice', entries, label: deck.title });
  };

  const startNext = (pack: PlazaPackView) => {
    const progress = progressByPack.get(pack.id);
    const next = progress?.nextDeck ?? pack.decks[0] ?? null;
    if (next) startDeck(next.deck);
  };

  const addDeck = async (packId: string, deckId: string) => {
    if (!auth.user) {
      login();
      return;
    }
    const key = officialDeckKey(packId, deckId);
    setWorking(key);
    const result = await libraryActions.add(packId, deckId);
    setWorking(null);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    actions.notify('success', t('plaza.addedToast'));
  };

  const addPack = async (pack: PlazaPackView, deckIds: readonly string[]) => {
    if (!auth.user) {
      login();
      return;
    }
    if (deckIds.length === 0) return;
    setWorking(`pack:${pack.id}`);
    const result = await libraryActions.addMany(pack.id, deckIds);
    setWorking(null);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    const { added, failed } = result.value;
    if (failed > 0) {
      actions.notify('error', t('plaza.batchPartialToast', { added, failed }));
      return;
    }
    actions.notify(
      'success',
      added > 1 ? t('plaza.batchAddedToast', { n: added }) : t('plaza.addedToast'),
    );
  };

  const removeDeck = async (packId: string, deckId: string) => {
    if (!auth.user) {
      login();
      return;
    }
    const key = officialDeckKey(packId, deckId);
    setWorking(key);
    const result = await libraryActions.remove(packId, deckId);
    setWorking(null);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    actions.notify('success', t('plaza.removedToast'));
  };

  const addPackAndStart = async (pack: PlazaPackView, deck: PlazaDeckView) => {
    if (!auth.user) {
      login();
      return;
    }
    const missing = pack.decks.filter((item) => !keys.has(item.deck.key));
    if (missing.length === 0) {
      startDeck(deck.deck);
      return;
    }

    setWorking(`pack:${pack.id}`);
    const result = await libraryActions.addMany(
      pack.id,
      missing.map((item) => item.deck.id),
    );
    setWorking(null);
    if (!result.ok) {
      actions.notify('error', describeBackendError(result.error, t));
      return;
    }
    const value = result.value;
    if (value.failed > 0) {
      actions.notify('error', t('plaza.batchPartialToast', { added: value.added, failed: value.failed }));
    }
    const first = pack.decks.find((item) => value.addedDeckIds.includes(item.deck.id));
    if (first) startDeck(first.deck);
  };

  const heroAction = () => {
    if (!hero) return;
    if (!auth.user) {
      login();
      return;
    }
    if (hero.added) startDeck(hero.deckView.deck);
    else void addPackAndStart(hero.pack, hero.deckView);
  };

  const cardAction = (pack: PlazaPackView) => {
    const progress = progressByPack.get(pack.id);
    const missing = pack.decks.filter((item) => !keys.has(item.deck.key));
    const batchKey = `pack:${pack.id}`;

    if (missing.length > 0) {
      const label = !auth.user
        ? t('plaza.signInToAdd')
        : missing.length === pack.deckCount
          ? missing.length === 1
            ? t('plaza.addOne')
            : t('plaza.addAll', { n: missing.length })
          : missing.length === 1
            ? t('plaza.addRestOne')
            : t('plaza.addRest', { n: missing.length });
      return (
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          onClick={() => (auth.user ? void addPack(pack, missing.map((item) => item.deck.id)) : login())}
        >
          <Icon name={auth.user ? 'plus' : 'arrowRight'} size={12} strokeWidth={2} />
          {working === batchKey ? t('plaza.adding') : label}
        </button>
      );
    }

    const label = progress?.complete
      ? t('plaza.reviewPack')
      : progress?.started
        ? t('plaza.continuePack')
        : t('lib.startStudy');
    return (
      <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => startNext(pack)}>
        {label}
      </button>
    );
  };

  const sortOptions: { value: PlazaSort; label: string }[] = [
    { value: 'recommended', label: t('plaza.sort.recommended') },
    { value: 'newest', label: t('plaza.sort.newest') },
    { value: 'questions', label: t('plaza.sort.questions') },
  ];

  return (
    <div className="page">
      <PageHead
        title={t('plaza.title')}
        lede={
          packs.length > 0
            ? t('plaza.lede', {
                packs: packsLabel,
                decks: unit(totals.decks, 'plaza.deckCountOne', 'plaza.deckCount'),
                questions: unit(totals.questions, 'plaza.questionCountOne', 'plaza.questionCount'),
              })
            : t('plaza.subtitle')
        }
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

      {official.status === 'disabled' ? <Note tone="warn">{t('plaza.offline')}</Note> : null}
      {official.error ? (
        <Note tone="warn">
          {t('official.failed')} · {describeBackendError(official.error, t)}
        </Note>
      ) : null}
      {official.issues.length > 0 ? (
        <Note tone="warn">{t('official.issues', { n: official.issues.length })}</Note>
      ) : null}
      {library.error ? (
        <Note tone="warn">
          {t('plaza.libraryError')} · {describeBackendError(library.error, t)}
        </Note>
      ) : null}

      {!official.ready ? <p className="footnote">{t('plaza.loading')}</p> : null}

      {official.ready && hero ? (
        <section className="plaza-hero">
          <div className="plaza-hero__main">
            <p className="eyebrow">
              {hero.added
                ? hero.started
                  ? t('plaza.continue')
                  : t('plaza.nextDeck')
                : t('plaza.startHere')}
            </p>
            <p className="plaza-hero__pack">{hero.pack.name}</p>
            <h2 className="plaza-hero__title">{hero.deckView.deck.title}</h2>
            <p className="plaza-hero__meta">
              {hero.started && hero.view
                ? t('plaza.continueMeta', {
                    seen: hero.view.seen,
                    total: hero.view.total,
                    accuracy: pct(hero.view.ratio),
                  })
                : t(
                    hero.deckView.deck.questions.length === 1
                      ? 'plaza.unitMetaOne'
                      : 'plaza.unitMeta',
                    {
                      n: hero.deckView.deck.questions.length,
                      minutes: hero.deckView.minutes,
                    },
                  )}
            </p>
            <div className="plaza-hero__meter">
              <Meter
                value={
                  hero.started && hero.view && hero.view.total > 0
                    ? hero.view.seen / hero.view.total
                    : 0
                }
                accent
              />
            </div>
            <div className="plaza-hero__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={heroAction}
              >
                {!auth.user
                  ? t('plaza.signInToAdd')
                  : hero.added
                    ? hero.started
                      ? t('plaza.continueCta')
                      : t('lib.startStudy')
                    : t('plaza.startCta')}
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => openSheet(hero.pack.id)}>
                {t('plaza.viewPack')}
              </button>
            </div>
          </div>

          <aside className="plaza-hero__side">
            <p className="eyebrow">{t('plaza.progressTitle')}</p>
            <dl className="plaza-stats">
              <div className="plaza-stats__row">
                <dt>{t('plaza.progressAdded')}</dt>
                <dd>
                  {totals.added}/{totals.decks}
                </dd>
              </div>
              <div className="plaza-stats__row">
                <dt>{t('plaza.progressStudied')}</dt>
                <dd>
                  {totals.studied}/{totals.questions}
                </dd>
              </div>
            </dl>
            <div className="plaza-goal">
              <div className="plaza-goal__head">
                <span>{t('plaza.dailyGoal')}</span>
                <span className="plaza-goal__value">
                  {todayCount}/{dailyTarget}
                </span>
              </div>
              <Meter value={goalRatio} accent />
              {goalMet ? <span className="badge badge--ok">{t('plaza.dailyDone')}</span> : null}
            </div>
          </aside>
        </section>
      ) : null}

      {!auth.user ? <Note>{t('plaza.guestNote')}</Note> : null}

      {official.ready && packs.length > 0 ? (
        <>
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
              {filtering
                ? t('plaza.showing', { shown: visiblePacks.length, total: packsLabel })
                : t('plaza.count', { packs: packsLabel, added: addedDecksLabel })}
              {official.version ? ` · ${t('plaza.catalogueVersion', { version: official.version })}` : ''}
            </span>
          </div>

          {packs.length >= 2 && (tags.length > 1 || packs.length >= 3) ? (
            <div className="plaza-filterbar">
              {tags.length > 1 ? (
                <div className="filters" role="group" aria-label={t('plaza.categories')}>
                  <button
                    type="button"
                    className={`filter ${tag === null ? 'is-active' : ''}`}
                    onClick={() => setTag(null)}
                  >
                    {t('common.all')}
                    <span className="filter__count">{packs.length}</span>
                  </button>
                  {tags.map((option) => (
                    <button
                      key={option.tag}
                      type="button"
                      className={`filter ${tag === option.tag ? 'is-active' : ''}`}
                      onClick={() => setTag(tag === option.tag ? null : option.tag)}
                    >
                      {option.tag}
                      <span className="filter__count">{option.count}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span />
              )}
              {packs.length >= 3 ? (
                <div className="plaza-sort">
                  <span className="plaza-sort__label">{t('plaza.sort')}</span>
                  <Seg
                    value={sort}
                    options={sortOptions}
                    onChange={setSort}
                    label={t('plaza.sort')}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {visiblePacks.length === 0 ? (
            <Empty
              title={t('plaza.noResults')}
              body={t('plaza.noResultsHint')}
              action={
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    setQuery('');
                    setTag(null);
                  }}
                >
                  {t('plaza.clearFilters')}
                </button>
              }
            />
          ) : (
            <section className="course-list" aria-label={t('plaza.title')}>
              {visiblePacks.map((pack) => {
                const progress = progressByPack.get(pack.id);
                const seen = progress?.studied ?? 0;
                const questions = progress?.questions ?? pack.questionCount;
                return (
                  <article className="course" key={pack.id}>
                    <span
                      className="course__crest"
                      data-tone={pack.tone}
                      aria-hidden="true"
                    >
                      {pack.crest}
                    </span>

                    <div className="course__body">
                      <div className="course__head">
                        <button
                          type="button"
                          className="course__name"
                          onClick={() => openSheet(pack.id)}
                        >
                          {pack.name}
                        </button>
                        <span className="badge badge--official">{t('official.badge')}</span>
                        <span className="course__version">v{pack.version}</span>
                        {progress?.complete ? (
                          <span className="badge badge--ok">{t('plaza.complete')}</span>
                        ) : null}
                      </div>

                      {pack.description ? <p className="course__desc">{pack.description}</p> : null}

                      <div className="course__meta">
                        <span>{unit(pack.deckCount, 'plaza.deckCountOne', 'plaza.deckCount')}</span>
                        <span>
                          {unit(pack.questionCount, 'plaza.questionCountOne', 'plaza.questionCount')}
                        </span>
                        <span>{t('plaza.minutes', { n: pack.minutes })}</span>
                        <span>{t(`plaza.level.${pack.level}` as MessageKey)}</span>
                        {pack.author ? <span>{t('plugins.by', { author: pack.author })}</span> : null}
                        {pack.updatedAt > 0 ? (
                          <span>{t('plaza.updated', { date: formatDate(pack.updatedAt, locale) })}</span>
                        ) : null}
                      </div>

                      <p className="course__syllabus">
                        <span className="course__syllabus-label">{t('plaza.syllabus')}</span>
                        {pack.decks
                          .slice(0, 4)
                          .map(({ deck }) => deck.title)
                          .join(' · ')}
                        {pack.deckCount > 4 ? ` +${pack.deckCount - 4}` : ''}
                      </p>

                      {progress && progress.added > 0 ? (
                        <div className="course__progress">
                          <Meter value={questions > 0 ? seen / questions : 0} accent />
                          <span className="course__progress-text">
                            {progress.started
                              ? t('plaza.continueMeta', {
                                  seen,
                                  total: questions,
                                  accuracy: pct(progress.accuracy),
                                })
                              : t('plaza.pathMeta', {
                                  added: progress.added,
                                  total: progress.total,
                                })}
                          </span>
                        </div>
                      ) : null}

                      <div className="course__foot">
                        {pack.deckCount > 1 ? (
                          <div className="course__path" aria-hidden="true">
                            {pack.decks.map(({ deck }) => {
                              const added = keys.has(deck.key);
                              const started = (viewByKey.get(deck.key)?.attempts ?? 0) > 0;
                              return (
                                <span
                                  key={deck.key}
                                  title={deck.title}
                                  className={`course__path-dot ${added ? 'is-added' : ''} ${
                                    started ? 'is-started' : ''
                                  }`}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <span />
                        )}
                        <div className="course__actions">
                          <button
                            type="button"
                            className="text-btn"
                            onClick={() => openSheet(pack.id)}
                          >
                            {t('plaza.viewPack')}
                          </button>
                          {cardAction(pack)}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </>
      ) : null}

      {official.ready && packs.length === 0 ? (
        <Empty
          title={t('plaza.empty')}
          body={official.status === 'disabled' ? t('plaza.offlineHint') : t('plaza.emptyHint')}
        />
      ) : null}

      <Sheet
        open={!!sheetPack}
        title={sheetPack?.name ?? ''}
        onClose={closeSheet}
        wide
        footer={
          sheetPack && sheetProgress ? (
            <>
              <span className="sheet__hint">
                {t('plaza.sheetHint', {
                  added: sheetProgress.added,
                  total: sheetProgress.total,
                  studied: sheetProgress.studied,
                  questions: sheetProgress.questions,
                })}
              </span>
              <div className="sheet__actions">
                <button type="button" className="btn btn--quiet btn--sm" onClick={closeSheet}>
                  {t('common.cancel')}
                </button>
                {cardAction(sheetPack)}
              </div>
            </>
          ) : null
        }
      >
        {sheetPack && sheetProgress ? (
          <div className="pack-sheet">
            <header className="pack-sheet__head">
              <span className="course__crest" data-tone={sheetPack.tone} aria-hidden="true">
                {sheetPack.crest}
              </span>
              <div className="pack-sheet__intro">
                {sheetPack.description ? <p>{sheetPack.description}</p> : null}
                <div className="course__meta">
                  <span>{unit(sheetPack.deckCount, 'plaza.deckCountOne', 'plaza.deckCount')}</span>
                  <span>
                    {unit(sheetPack.questionCount, 'plaza.questionCountOne', 'plaza.questionCount')}
                  </span>
                  <span>{t('plaza.minutes', { n: sheetPack.minutes })}</span>
                  <span>{t(`plaza.level.${sheetPack.level}` as MessageKey)}</span>
                  {sheetPack.author ? (
                    <span>{t('plugins.by', { author: sheetPack.author })}</span>
                  ) : null}
                  {sheetPack.updatedAt > 0 ? (
                    <span>
                      {t('plaza.updated', {
                        date: formatDate(sheetPack.updatedAt, locale),
                      })}
                    </span>
                  ) : null}
                </div>
                {sheetPack.tags.length > 0 ? (
                  <p className="pack-sheet__tags">{sheetPack.tags.join(' · ')}</p>
                ) : null}
              </div>
            </header>

            <div className="pack-sheet__progress">
              <div className="pack-sheet__progress-head">
                <span>{t('plaza.pathMeta', { added: sheetProgress.added, total: sheetProgress.total })}</span>
                <span>{pct(sheetProgress.questions > 0 ? sheetProgress.studied / sheetProgress.questions : 0)}</span>
              </div>
              <Meter
                value={
                  sheetProgress.questions > 0
                    ? sheetProgress.studied / sheetProgress.questions
                    : 0
                }
                accent
              />
            </div>

            <div className="panel__head">
              <h3 className="panel__title">{t('plaza.path')}</h3>
            </div>

            <ol className="path">
              {sheetPack.decks.map((deckView, index) => {
                const deck = deckView.deck;
                const added = keys.has(deck.key);
                const view = viewByKey.get(deck.key);
                const expanded = previewKey === deck.key;
                const unitBusy = working === deck.key;
                const started = (view?.attempts ?? 0) > 0;
                const complete = !!view && view.total > 0 && view.seen >= view.total;
                return (
                  <li
                    className={`path__unit ${added ? 'is-added' : ''} ${
                      started ? 'is-started' : ''
                    } ${complete ? 'is-complete' : ''}`}
                    key={deck.key}
                  >
                    <span className="path__node" aria-hidden="true">
                      {complete ? (
                        <Icon name="check" size={12} strokeWidth={2} />
                      ) : (
                        String(index + 1).padStart(2, '0')
                      )}
                    </span>
                    <div className="path__body">
                      <div className="path__head">
                        <button
                          type="button"
                          className="path__title"
                          aria-expanded={expanded}
                          onClick={() => setPreviewKey(expanded ? null : deck.key)}
                        >
                          {deck.title}
                        </button>
                        {added ? <span className="badge badge--ok">{t('plaza.unitAdded')}</span> : null}
                      </div>
                      <p className="path__meta">
                        {t(deck.questions.length === 1 ? 'plaza.unitMetaOne' : 'plaza.unitMeta', {
                          n: deck.questions.length,
                          minutes: deckView.minutes,
                        })}
                        {deck.tags.length > 0 ? ` · ${deck.tags.slice(0, 3).join(' · ')}` : ''}
                      </p>
                      {view && view.attempts > 0 ? (
                        <div className="path__progress">
                          <Meter value={view.total > 0 ? view.seen / view.total : 0} />
                          <span className="path__progress-text">
                            {t('plaza.continueMeta', {
                              seen: view.seen,
                              total: view.total,
                              accuracy: pct(view.ratio),
                            })}
                          </span>
                        </div>
                      ) : null}
                      {expanded ? (
                        <div className="path__preview">
                          {deck.description ? <p className="path__desc">{deck.description}</p> : null}
                          <p className="eyebrow">{t('plaza.sample')}</p>
                          <div className="preview-list">
                            {deck.questions.slice(0, 3).map((question, questionIndex) => (
                              <div className="preview-row" key={question.id}>
                                <span className="preview-row__index">{questionIndex + 1}</span>
                                <span className="preview-row__prompt">
                                  {shorten(question.prompt, 90)}
                                </span>
                                <span className="preview-row__meta">
                                  {questionTypeLabel(question.type, t)}
                                </span>
                              </div>
                            ))}
                          </div>
                          {deck.questions.length > 3 ? (
                            <p className="footnote">
                              {t('plaza.previewMore', { n: deck.questions.length - 3 })}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="path__actions">
                      {added ? (
                        <>
                          <button type="button" className="text-btn" onClick={() => startDeck(deck)}>
                            {t('common.study')}
                          </button>
                          <button
                            type="button"
                            className="text-btn"
                            disabled={busy || unitBusy}
                            onClick={() => void removeDeck(sheetPack.id, deck.id)}
                          >
                            {t('lib.remove')}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn--sm"
                          disabled={busy || unitBusy}
                          onClick={() =>
                            auth.user ? void addDeck(sheetPack.id, deck.id) : login()
                          }
                        >
                          {unitBusy ? t('plaza.adding') : auth.user ? t('plaza.add') : t('plaza.signInToAdd')}
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={t('common.preview')}
                        title={t('common.preview')}
                        aria-expanded={expanded}
                        onClick={() => setPreviewKey(expanded ? null : deck.key)}
                      >
                        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} strokeWidth={1.6} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
