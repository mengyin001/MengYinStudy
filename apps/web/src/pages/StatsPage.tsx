import { useMemo, useState } from 'react';
import { computeStats, computeStreak, DAY_MS, startOfDay } from '@mengyin/core';
import { StreakFlame } from '@/components/StreakFlame';
import { Empty, Meter, PageHead } from '@/components/ui';
import { tagStats } from '@/domain/library';
import type { MessageKey } from '@/i18n/messages';
import { formatDuration, formatShortDay, pct } from '@/lib/format';
import { streakLabel } from '@/lib/streakLabel';
import { useApp } from '@/state/AppContext';

export function StatsPage() {
  const { state, entries, deckViews, t, locale } = useApp();
  const attempts = state.progress.attempts;

  const stats = useMemo(() => computeStats(attempts, 14), [attempts]);
  const streak = useMemo(() => computeStreak(attempts), [attempts]);
  const tags = useMemo(() => tagStats(entries, attempts), [entries, attempts]);
  const [showAllTags, setShowAllTags] = useState(false);

  const trainedTags = useMemo(() => tags.filter((tag) => tag.attempts > 0), [tags]);
  const visibleTags = showAllTags ? tags : trainedTags.slice(0, 12);

  const forecast = useMemo(() => {
    const cards = state.progress.cards;
    const today = startOfDay(Date.now());
    const buckets = Array.from({ length: 7 }, (_, index) => ({ date: today + index * DAY_MS, count: 0 }));
    for (const card of Object.values(cards)) {
      const dayIndex = Math.floor((startOfDay(card.dueAt) - today) / DAY_MS);
      if (dayIndex < 0) {
        const bucket = buckets[0];
        if (bucket) bucket.count += 1;
      } else if (dayIndex < 7) {
        const bucket = buckets[dayIndex];
        if (bucket) bucket.count += 1;
      }
    }
    return buckets;
  }, [state.progress.cards]);

  const maxDay = Math.max(1, ...stats.days.map((day) => day.attempts));
  const maxForecast = Math.max(1, ...forecast.map((day) => day.count));
  const firstDay = stats.days[0];
  const lastDay = stats.days[stats.days.length - 1];
  const dayStart = (date: string | undefined) =>
    date ? new Date(`${date}T00:00:00`).getTime() : Date.now();

  if (attempts.length === 0) {
    return (
      <div className="page">
        <PageHead title={t('stats.title')} lede={t('stats.subtitle', { n: 0, time: formatDuration(0, locale) })} />
        <Empty title={t('stats.emptyTitle')} body={t('stats.emptyBody')} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHead
        title={t('stats.title')}
        lede={t('stats.subtitle', { n: attempts.length, time: formatDuration(stats.ms, locale) })}
        actions={
          <span className="badge">
            <StreakFlame
              current={streak.current}
              best={streak.best}
              size={13}
              label={streakLabel(streak.current, streak.best, t)}
            />{' '}
            {t('stats.streak', { current: streak.current, best: streak.best })}
          </span>
        }
      />

      <section className="metrics">
        <div className="metric">
          <span className="metric__label">{t('stats.overall')}</span>
          <span className="metric__value">{pct(stats.ratio)}</span>
          <span className="metric__hint">{t('stats.fullyCorrect', { n: stats.correct })}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('stats.studied')}</span>
          <span className="metric__value">{Object.keys(state.progress.cards).length}</span>
          <span className="metric__hint">{t('stats.studiedHint')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('stats.avgTime')}</span>
          <span className="metric__value">{Math.round(stats.ms / attempts.length / 1000)}s</span>
          <span className="metric__hint">{t('stats.avgTimeHint')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('stats.today')}</span>
          <span className="metric__value">{stats.days[stats.days.length - 1]?.attempts ?? 0}</span>
          <span className="metric__hint">{t('stats.todayHint', { n: state.progress.settings.dailyTarget })}</span>
        </div>
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('stats.last14')}</h2>
          </div>
          <div className="chart">
            {stats.days.map((day) => (
              <div className="chart__col" key={day.date} title={`${day.date}: ${day.attempts}`}>
                <div
                  className={`chart__bar ${day.attempts === 0 ? 'chart__bar--empty' : ''}`}
                  style={{ height: `${Math.max(2, (day.attempts / maxDay) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="chart__axis">
            <span>{formatShortDay(dayStart(firstDay?.date), locale)}</span>
            <span>{formatShortDay(dayStart(lastDay?.date), locale)}</span>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('stats.due7')}</h2>
            <span className="panel__more">{t('stats.due7Hint')}</span>
          </div>
          <div className="forecast">
            {forecast.map((day, index) => (
              <div className="forecast__row" key={day.date}>
                <span className="forecast__day">{index === 0 ? t('stats.today') : t('stats.dayN', { n: index })}</span>
                <Meter value={day.count / maxForecast} accent={day.count > 0} />
                <span className="forecast__count">{day.count}</span>
              </div>
            ))}
          </div>
          <p className="footnote" style={{ marginTop: 'var(--s2)' }}>
            {t('stats.due7Foot')}
          </p>
        </section>
      </div>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('stats.tags')}</h2>
          <div className="filters">
            <span className="panel__more">{t('stats.tagsTrained', { n: trainedTags.length })}</span>
            <button type="button" className="text-btn" onClick={() => setShowAllTags((value) => !value)}>
              {showAllTags ? t('stats.showTrained') : t('stats.showAll')}
            </button>
          </div>
        </div>

        {visibleTags.length === 0 ? (
          <Empty title={t('stats.tagsEmpty')} />
        ) : (
          <div className="tagbars">
            {visibleTags.map((tag) => (
              <div className="tagbars__row" key={tag.tag}>
                <span className="tagbars__name">{tag.tag}</span>
                <Meter value={tag.ratio} accent={tag.ratio >= 0.8} />
                <span className="tagbars__val">
                  {tag.attempts === 0 ? t('stats.notPractised') : pct(tag.ratio)} · {tag.questions}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('stats.decks')}</h2>
          <span className="panel__more">{t('stats.progressCol')}</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t('stats.deckCol')}</th>
              <th>{t('stats.progressCol')}</th>
              <th>{t('stats.answersCol')}</th>
              <th>{t('stats.accuracyCol')}</th>
            </tr>
          </thead>
          <tbody>
            {deckViews
              .filter((view) => view.attempts > 0)
              .sort((a, b) => b.attempts - a.attempts)
              .map((view) => (
                <tr key={view.deck.key}>
                  <td>
                    <span className="table__title">{view.deck.title}</span>
                    <span className="table__sub">{view.deck.pluginId}</span>
                  </td>
                  <td>
                    <span className="table__meter">
                      <Meter value={view.total === 0 ? 0 : view.seen / view.total} />
                      <span>
                        {view.seen}/{view.total}
                      </span>
                    </span>
                  </td>
                  <td className="num">{view.attempts}</td>
                  <td className="num">{pct(view.ratio)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">{t('stats.modes')}</h2>
        </div>
        <div className="modes">
          {Object.entries(stats.byMode).map(([mode, count]) => (
            <div className="modes__item" key={mode}>
              <span className="modes__value">{count}</span>
              <span className="modes__label">{t(`mode.${mode}` as MessageKey)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
