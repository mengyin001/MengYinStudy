import { useMemo, useState } from 'react';
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
import { OfficialStatus } from '@/components/OfficialStatus';
import { Empty, Meter, PageHead, Sheet } from '@/components/ui';
import type { DeckView } from '@/domain/library';
import { questionTypeLabel } from '@/domain/registry';
import type { MessageKey } from '@/i18n/messages';
import { pct, shorten } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';

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
  const { state, deckViews, pluginNames, guestDeckKeys, officialDeckKeys, cloudDeckKeys, t, actions } =
    useApp();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [modeDeck, setModeDeck] = useState<string | null>(null);
  const [removeKey, setRemoveKey] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const mastery = useMemo(() => masteryMap(state.progress.attempts), [state.progress.attempts]);

  const counts = useMemo(
    () => ({
      all: deckViews.length,
      due: deckViews.filter((view) => view.dueCount > 0).length,
      mistakes: deckViews.filter((view) => view.mistakeCount > 0).length,
      new: deckViews.filter((view) => view.seen === 0).length,
    }),
    [deckViews],
  );

  const visible = useMemo(() => {
    const text = query.trim().toLowerCase();
    return deckViews.filter((view) => {
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
  }, [deckViews, filter, pluginNames, query]);

  const selectedView = selected ? deckViews.find((view) => view.deck.key === selected) : undefined;
  const modeView = modeDeck ? deckViews.find((view) => view.deck.key === modeDeck) : undefined;
  const removeView = removeKey ? deckViews.find((view) => view.deck.key === removeKey) : undefined;
  const totalQuestions = deckViews.reduce((sum, view) => sum + view.total, 0);

  const confirmRemove = async () => {
    if (!removeKey) return;
    setRemoving(true);
    await actions.deleteDeck(removeKey);
    setRemoving(false);
    setRemoveKey(null);
    setSelected(null);
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
        lede={t('lib.subtitle', { decks: deckViews.length, questions: totalQuestions })}
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
                {t('lib.previewMeta', {
                  n: selectedView.total,
                  seen: selectedView.seen,
                  accuracy: pct(selectedView.ratio),
                })}
              </span>
              <div className="deck-row__actions">
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
    </div>
  );
}
