import { useMemo, useState } from 'react';
import { flaggedEntries, missedEntries, type QuestionEntry } from '@mengyin/core';
import { Icon } from '@/components/Icons';
import { Empty, PageHead } from '@/components/ui';
import { describeAnswer } from '@/domain/answers';
import type { MessageKey } from '@/i18n/messages';
import { formatDate } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';

type Tab = 'mistakes' | 'flagged';

export function MistakesPage() {
  const { state, entries, t, locale, actions } = useApp();
  const [tab, setTab] = useState<Tab>('mistakes');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [noteKey, setNoteKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const attempts = state.progress.attempts;

  const lastAttempt = useMemo(() => {
    const map = new Map<string, (typeof attempts)[number]>();
    for (const attempt of attempts) map.set(attempt.questionKey, attempt);
    return map;
  }, [attempts]);

  const missed = useMemo(() => missedEntries(entries, attempts), [entries, attempts]);
  const flagged = useMemo(() => flaggedEntries(entries, state.progress.flags), [entries, state.progress.flags]);
  const list = tab === 'mistakes' ? missed : flagged;

  const attemptCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const attempt of attempts) counts.set(attempt.questionKey, (counts.get(attempt.questionKey) ?? 0) + 1);
    return counts;
  }, [attempts]);

  const startReview = () => {
    if (list.length === 0) return;
    actions.startSession({
      mode: 'review',
      entries: list,
      label: tab === 'mistakes' ? t('review.tab.mistakes', { n: list.length }) : t('review.tab.flagged', { n: list.length }),
    });
  };

  return (
    <div className="page">
      <PageHead
        title={t('review.title')}
        lede={t('review.subtitle')}
        actions={
          <button type="button" className="btn btn--primary" onClick={startReview} disabled={list.length === 0}>
            {t('review.reviewAll', { n: list.length })}
          </button>
        }
      />

      <div className="toolbar">
        <div className="filters" role="group">
          <button
            type="button"
            className={`filter ${tab === 'mistakes' ? 'is-active' : ''}`}
            onClick={() => setTab('mistakes')}
          >
            {t('review.tab.mistakes', { n: missed.length })}
          </button>
          <button
            type="button"
            className={`filter ${tab === 'flagged' ? 'is-active' : ''}`}
            onClick={() => setTab('flagged')}
          >
            {t('review.tab.flagged', { n: flagged.length })}
          </button>
        </div>
        <span className="footnote">{tab === 'mistakes' ? t('review.hintMistakes') : t('review.hintFlagged')}</span>
      </div>

      {list.length === 0 ? (
        <Empty
          title={tab === 'mistakes' ? t('review.emptyMistakes') : t('review.emptyFlagged')}
          body={tab === 'mistakes' ? t('review.emptyMistakesBody') : t('review.emptyFlaggedBody')}
          action={
            <button type="button" className="text-btn" onClick={() => navigate('/library')}>
              {t('review.goDecks')}
            </button>
          }
        />
      ) : (
        <div className="review">
          {list.map((entry: QuestionEntry) => {
            const attempt = lastAttempt.get(entry.key);
            const open = openKey === entry.key;
            const statusKey: MessageKey =
              attempt?.status === 'partial' ? 'review.statusPartial' : attempt ? 'review.statusWrong' : 'review.statusFlagged';
            const statusClass = attempt?.status === 'partial' ? 'badge--warn' : attempt ? 'badge--bad' : '';
            const count = attemptCount.get(entry.key) ?? 0;

            return (
              <div className="review__item" key={entry.key}>
                <button
                  type="button"
                  className="review__head"
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : entry.key)}
                >
                  <span className={`badge ${statusClass}`}>{t(statusKey)}</span>
                  <span className="review__prompt">
                    <span className="row__title">{entry.question.prompt}</span>
                    <span className="row__meta">
                      {t('review.deckLine', {
                        deck: entry.deck.title,
                        date: formatDate(attempt?.at ?? Date.now(), locale),
                        n: count,
                      })}
                    </span>
                  </span>
                  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} strokeWidth={1.6} />
                </button>

                {open ? (
                  <div className="review__body">
                    <div className="pairs">
                      <div className="pairs__row">
                        <span className="pairs__key">{t('review.lastAnswer')}</span>
                        <span className="pairs__val">{attempt?.given ?? '—'}</span>
                      </div>
                      <div className="pairs__row">
                        <span className="pairs__key">{t('verdict.correctAnswer')}</span>
                        <span className="pairs__val pairs__val--ok">{describeAnswer(entry.question)}</span>
                      </div>
                    </div>

                    {entry.question.explanation ? <p className="explain">{entry.question.explanation}</p> : null}

                    {state.progress.notes[entry.key] && noteKey !== entry.key ? (
                      <p className="footnote">
                        {t('review.note')} · {state.progress.notes[entry.key]}
                      </p>
                    ) : null}

                    {noteKey === entry.key ? (
                      <div className="field">
                        <textarea
                          className="note-area"
                          rows={3}
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          placeholder={t('review.notePlaceholder')}
                        />
                        <div className="actions-row">
                          <button
                            type="button"
                            className="btn btn--sm"
                            onClick={() => {
                              actions.setQuestionNote(entry.key, noteDraft);
                              setNoteKey(null);
                            }}
                          >
                            {t('review.saveNote')}
                          </button>
                          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setNoteKey(null)}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="results__actions">
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() => {
                          setNoteKey(entry.key);
                          setNoteDraft(state.progress.notes[entry.key] ?? '');
                        }}
                      >
                        {t('review.addNote')}
                      </button>
                      <button type="button" className="text-btn" onClick={() => actions.toggleQuestionFlag(entry.key)}>
                        {state.progress.flags[entry.key] ? t('review.unflag') : t('review.flag')}
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => actions.startSession({ mode: 'review', entries: [entry], label: entry.deck.title })}
                      >
                        {t('review.studyOne')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
