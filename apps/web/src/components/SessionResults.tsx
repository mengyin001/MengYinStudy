import { useEffect, useMemo, useState } from 'react';
import { summarize, type Session } from '@mengyin/core';
import { Icon } from './Icons';
import { Empty, Meter } from './ui';
import { answerSummary, describeAnswer } from '@/domain/answers';
import { localizeQuestion } from '@/domain/localize';
import type { MessageKey } from '@/i18n/messages';
import { scoreSoundBand } from '@/lib/answerStreak';
import { playScoreSound } from '@/lib/answerStreakAudio';
import { formatDuration } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';

/** Score feedback is once per session, even if the results view remounts. */
const scoreSoundSessions = new Set<string>();

const STATUS: Record<string, { key: MessageKey; cls: string }> = {
  correct: { key: 'results.correct', cls: 'badge--ok' },
  partial: { key: 'results.partial', cls: 'badge--warn' },
  incorrect: { key: 'results.incorrect', cls: 'badge--bad' },
};

export function SessionResults({ session }: { session: Session }) {
  const { t, locale, actions, state } = useApp();
  const summary = useMemo(() => summarize(session), [session]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(true);

  // Give the result a moment to appear, then react to the score. The timer is
  // cleared on a real unmount, and the module-level set stops StrictMode from
  // scheduling it twice or replaying it when the same results are revisited.
  useEffect(() => {
    if (scoreSoundSessions.has(session.id)) return undefined;
    if (session.mode === 'exam' || !state.progress.settings.soundEffects) {
      scoreSoundSessions.add(session.id);
      return undefined;
    }
    const band = scoreSoundBand(summary.score);
    const timer = window.setTimeout(() => {
      if (scoreSoundSessions.has(session.id)) return;
      scoreSoundSessions.add(session.id);
      playScoreSound(band);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [session.id, session.mode, summary.score, state.progress.settings.soundEffects]);

  const wrongEntries = useMemo(() => {
    const seen = new Set<string>();
    const entries = [];
    for (const item of session.items) {
      if (!item.result || item.result.status === 'correct') continue;
      if (seen.has(item.entry.key)) continue;
      seen.add(item.entry.key);
      entries.push(item.entry);
    }
    return entries;
  }, [session.items]);

  const tags = useMemo(
    () =>
      Object.entries(summary.byTag)
        .map(([tag, value]) => ({
          tag,
          ratio: value.attempts === 0 ? 0 : value.ratio / value.attempts,
          attempts: value.attempts,
        }))
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 8),
    [summary.byTag],
  );

  const items = onlyWrong
    ? session.items.filter((item) => item.result && item.result.status !== 'correct')
    : session.items;

  const modeKey = `mode.${session.mode}` as MessageKey;

  return (
    <div className="results">
      <header className="scoreline">
        <span className="scoreline__value">{summary.score}</span>
        <span className="scoreline__label">{t('results.score')}</span>
        <span className="scoreline__meta">
          {t(modeKey)} · {t('results.correctOf', { correct: summary.correct, total: summary.total })} ·{' '}
          {formatDuration(summary.msSpent, locale)}
          {session.mode !== 'exam' && (summary.bestAnswerStreak ?? 0) >= 2 ? (
            <>
              {' · '}
              <span className="scoreline__streak">
                <Icon name="flame" size={12} strokeWidth={1.7} />
                {t('results.bestStreak', { n: summary.bestAnswerStreak ?? 0 })}
              </span>
            </>
          ) : null}
        </span>
      </header>

      <div className="breakdown">
        <div className="breakdown__item">
          <p className="breakdown__value">{summary.correct}</p>
          <p className="breakdown__label">{t('results.correct')}</p>
        </div>
        <div className="breakdown__item">
          <p className="breakdown__value">{summary.partial}</p>
          <p className="breakdown__label">{t('results.partial')}</p>
        </div>
        <div className="breakdown__item">
          <p className="breakdown__value">{summary.incorrect}</p>
          <p className="breakdown__label">{t('results.incorrect')}</p>
        </div>
        <div className="breakdown__item">
          <p className="breakdown__value">{summary.skipped}</p>
          <p className="breakdown__label">{t('results.skipped')}</p>
        </div>
      </div>

      <div className="results__actions">
        {wrongEntries.length > 0 ? (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() =>
              actions.startSession({
                mode: 'review',
                entries: wrongEntries,
                label: t('results.retryWrong', { n: wrongEntries.length }),
              })
            }
          >
            {t('results.retryWrong', { n: wrongEntries.length })}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() =>
            actions.startSession({
              mode: session.mode,
              entries: session.items.map((item) => item.entry),
              label: session.label,
            })
          }
        >
          {t('results.repeat')}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => navigate('/library')}>
          {t('results.backToDecks')}
        </button>
      </div>

      {tags.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('results.byTag')}</h2>
            <span className="panel__more">{t('results.byTagHint')}</span>
          </div>
          <div className="tagbars">
            {tags.map((tag) => (
              <div className="tagbars__row" key={tag.tag}>
                <span className="tagbars__name">{tag.tag}</span>
                <Meter value={tag.ratio} accent={tag.ratio >= 0.5} />
                <span className="tagbars__val">
                  {Math.round(tag.ratio * 100)}% · {tag.attempts}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('results.review')}</h2>
          <button type="button" className="panel__more" onClick={() => setOnlyWrong((value) => !value)}>
            {onlyWrong ? t('results.onlyMistakes') : t('results.review')}
          </button>
        </div>

        {items.length === 0 ? (
          <Empty title={t('results.allCorrect')} />
        ) : (
          <div className="review">
            {items.map((item) => {
              const status = item.skipped
                ? { key: 'results.skipped' as MessageKey, cls: '' }
                : (STATUS[item.result?.status ?? 'incorrect'] ?? STATUS.incorrect);
              if (!status) return null;
              const open = openKey === item.entry.key;
              const question = localizeQuestion(item.entry.question, locale);
              return (
                <div className="review__item" key={item.entry.key}>
                  <button
                    type="button"
                    className="review__head"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : item.entry.key)}
                  >
                    <span className={`badge ${status.cls}`}>{t(status.key)}</span>
                    <span className="review__prompt">{question.prompt}</span>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} strokeWidth={1.6} />
                  </button>

                  {open ? (
                    <div className="review__body">
                      <div className="pairs">
                        <div className="pairs__row">
                          <span className="pairs__key">{t('verdict.yourAnswer')}</span>
                          <span
                            className={`pairs__val ${question.type === 'code' ? 'pairs__val--code' : ''}`}
                          >
                            {answerSummary(question, item.answer, t)}
                          </span>
                        </div>
                        <div className="pairs__row">
                          <span className="pairs__key">{t('verdict.correctAnswer')}</span>
                          <span
                            className={`pairs__val pairs__val--ok ${question.type === 'code' ? 'pairs__val--code' : ''}`}
                          >
                            {describeAnswer(question, t)}
                          </span>
                        </div>
                      </div>
                      {question.explanation ? (
                        <p className="explain">{question.explanation}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
