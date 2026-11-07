import { useMemo } from 'react';
import {
  computeStats,
  computeStreak,
  dueEntries,
  masteryMap,
  missedEntries,
  mulberry32,
  sample,
  startOfDay,
} from '@mengyin/core';
import { Empty, Meter, PageHead } from '@/components/ui';
import { formatDuration, formatLongDate, pct } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useBilling } from '@/state/BillingContext';

export function DashboardPage() {
  const { state, entries, deckViews, t, locale, actions } = useApp();
  const { plan, points } = useBilling();
  const progress = state.progress;
  const now = Date.now();

  const summary = useMemo(() => {
    const attempts = progress.attempts;
    const today = startOfDay(now);
    const todayAttempts = attempts.filter((attempt) => attempt.at >= today);
    const mastery = masteryMap(attempts);
    let mastered = 0;
    for (const entry of entries) {
      const record = mastery.get(entry.key);
      if (record && record.attempts >= 2 && record.ratio >= 0.8) mastered += 1;
    }
    const ratio =
      attempts.length === 0 ? 0 : attempts.reduce((sum, attempt) => sum + attempt.ratio, 0) / attempts.length;
    return {
      streak: computeStreak(attempts, now),
      todayCount: todayAttempts.length,
      mastered,
      ratio,
      total: attempts.length,
    };
  }, [entries, now, progress.attempts]);

  const due = useMemo(() => dueEntries(entries, progress.cards, now), [entries, progress.cards, now]);
  const mistakes = useMemo(() => missedEntries(entries, progress.attempts), [entries, progress.attempts]);

  const lastDeck = useMemo(() => {
    const sorted = [...deckViews].filter((view) => view.lastAt > 0).sort((a, b) => b.lastAt - a.lastAt);
    return sorted[0];
  }, [deckViews]);

  const recentSessions = useMemo(() => [...progress.sessions].slice(-4).reverse(), [progress.sessions]);

  const otherDecks = useMemo(
    () =>
      [...deckViews]
        .filter((view) => view.lastAt > 0 && view.deck.key !== lastDeck?.deck.key)
        .sort((a, b) => b.lastAt - a.lastAt)
        .slice(0, 3),
    [deckViews, lastDeck],
  );

  const activity = useMemo(() => computeStats(progress.attempts, 14, now).days, [progress.attempts, now]);
  const maxDay = Math.max(1, ...activity.map((day) => day.attempts));

  const startRandom = () => {
    const picked = sample(entries, 10, mulberry32(now));
    actions.startSession({ mode: 'random', entries: picked, label: t('mode.random') });
  };

  const startDue = () => {
    actions.startSession({ mode: 'srs', entries: due, label: t('mode.srs') });
  };

  // Plans live at the top right of Today rather than in the left navigation.
  const planButton = (
    <button type="button" className="btn btn--sm" onClick={() => navigate('/pricing')}>
      {t(`plan.${plan.id}`)} · {t('billing.pointsShort', { n: points })}
    </button>
  );

  if (entries.length === 0) {
    return (
      <div className="page">
        <PageHead
          eyebrow={formatLongDate(now, locale)}
          title={t('dash.title')}
          actions={planButton}
        />
        <Empty
          title={t('dash.emptyTitle')}
          body={t('dash.emptyBody')}
          action={
            <button type="button" className="btn btn--primary" onClick={() => navigate('/plaza')}>
              {t('dash.openPlaza')}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        eyebrow={formatLongDate(now, locale)}
        title={t('dash.title')}
        lede={t('dash.lede', {
          due: due.length,
          weak: mistakes.length,
          streak: summary.streak.current,
        })}
        actions={
          <>
            {planButton}
            <button type="button" className="btn btn--quiet" onClick={startRandom}>
              {t('dash.random')}
            </button>
            <button type="button" className="btn btn--primary" onClick={startDue} disabled={due.length === 0}>
              {due.length > 0 ? t('dash.startReview', { count: due.length }) : t('dash.nothingDue')}
            </button>
          </>
        }
      />

      <section className="metrics">
        <div className="metric">
          <span className="metric__label">{t('dash.metric.due')}</span>
          <span className="metric__value">{due.length}</span>
          <span className="metric__hint">{t('dash.metric.dueHint')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('dash.metric.mistakes')}</span>
          <span className="metric__value">{mistakes.length}</span>
          <span className="metric__hint">{t('dash.metric.mistakesHint')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('dash.metric.mastered')}</span>
          <span className="metric__value">{summary.mastered}</span>
          <span className="metric__hint">{t('dash.metric.masteredHint')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('dash.metric.accuracy')}</span>
          <span className="metric__value">{pct(summary.ratio)}</span>
          <span className="metric__hint">{t('dash.metric.accuracyHint', { n: summary.total })}</span>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('dash.continue')}</h2>
            <button type="button" className="panel__more" onClick={() => navigate('/library')}>
              {t('dash.allDecks')} →
            </button>
          </div>

          {lastDeck ? (
            <div className="continue">
              <div>
                <p className="continue__deck">{lastDeck.deck.title}</p>
                <p className="continue__meta">
                  {t('dash.continueMeta', {
                    seen: lastDeck.seen,
                    total: lastDeck.total,
                    accuracy: pct(lastDeck.ratio),
                  })}
                </p>
              </div>
              <Meter value={lastDeck.total === 0 ? 0 : lastDeck.seen / lastDeck.total} accent />
              <div className="continue__actions">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() =>
                    actions.startSession({
                      mode: 'practice',
                      entries: lastDeck.entries,
                      label: lastDeck.deck.title,
                    })
                  }
                >
                  {t('common.study')}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={() =>
                    actions.startSession({
                      mode: 'exam',
                      entries: lastDeck.entries,
                      label: `${lastDeck.deck.title} · ${t('mode.exam')}`,
                      limit: 20,
                    })
                  }
                >
                  {t('lib.test20')}
                </button>
              </div>

              {otherDecks.length > 0 ? (
                <ul className="rows">
                  {otherDecks.map((view) => (
                    <li className="row" key={view.deck.key}>
                      <div className="row__main">
                        <span className="row__title">{view.deck.title}</span>
                        <span className="row__meta">
                          {t('dash.continueMeta', {
                            seen: view.seen,
                            total: view.total,
                            accuracy: pct(view.ratio),
                          })}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="text-btn"
                        onClick={() =>
                          actions.startSession({
                            mode: 'practice',
                            entries: view.entries,
                            label: view.deck.title,
                          })
                        }
                      >
                        {t('common.study')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <Empty
              title={t('dash.noContinue')}
              body={t('dash.noContinueHint')}
              action={
                <button type="button" className="text-btn" onClick={() => navigate('/library')}>
                  {t('dash.browse')}
                </button>
              }
            />
          )}
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('dash.recent')}</h2>
            <button type="button" className="panel__more" onClick={() => navigate('/stats')}>
              {t('nav.stats')} →
            </button>
          </div>

          {recentSessions.length === 0 ? (
            <Empty title={t('dash.noSessions')} body={t('dash.noSessionsHint')} />
          ) : (
            <ul className="rows">
              {recentSessions.map((session) => (
                <li className="row" key={session.id}>
                  <div className="row__main">
                    <span className="row__title">{session.label}</span>
                    <span className="row__meta">
                      {session.total} {t('common.questions')} · {formatDuration(session.msSpent, locale)}
                    </span>
                  </div>
                  <span className="row__score">{session.score}%</span>
                </li>
              ))}
            </ul>
          )}

          <p className="footnote" style={{ marginTop: 'var(--s3)' }}>
            {t('dash.todayLog', { n: summary.todayCount })}
          </p>

          <div className="panel__head" style={{ marginTop: 'var(--s4)' }}>
            <h2 className="panel__title" style={{ fontSize: 'var(--t-md)' }}>
              {t('stats.last14')}
            </h2>
          </div>
          <div className="chart chart--compact">
            {activity.map((day) => (
              <div className="chart__col" key={day.date} title={`${day.date}: ${day.attempts}`}>
                <div
                  className={`chart__bar ${day.attempts === 0 ? 'chart__bar--empty' : ''}`}
                  style={{ height: `${Math.max(2, (day.attempts / maxDay) * 100)}%` }}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
