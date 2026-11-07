import { useCallback, useEffect, useRef, useState } from 'react';
import { currentItem, isAnswered, type Answer, type SelfGrade } from '@mengyin/core';
import { AnswerInput } from '@/components/AnswerInput';
import { FeedbackPanel } from '@/components/FeedbackPanel';
import { Icon } from '@/components/Icons';
import { QuestionImage } from '@/components/QuestionImage';
import { SessionResults } from '@/components/SessionResults';
import { Sheet } from '@/components/ui';
import { createEmptyAnswer } from '@/domain/answers';
import { questionTypeLabel } from '@/domain/registry';
import { canRunCode } from '@/sandbox/codeRun';
import type { MessageKey } from '@/i18n/messages';
import { formatClock } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';

export function PracticePage() {
  const { state, t, actions } = useApp();
  const session = state.session;
  const [draft, setDraft] = useState<Answer | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [pendingAuto, setPendingAuto] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [codeRunning, setCodeRunning] = useState(false);
  const startRef = useRef(Date.now());
  const autoDoneRef = useRef<Set<string>>(new Set());

  const item = session && !session.finished ? currentItem(session) : null;
  const question = item?.entry.question ?? null;
  const answered = !!item?.result;
  const reveal = !!session?.reveal;
  const drillMode = session?.mode === 'drill';

  useEffect(() => {
    if (!state.ready) return;
    if (!session) navigate('/library', { replace: true });
  }, [session, state.ready]);

  useEffect(() => {
    if (!item) return;
    setDraft(item.answer ?? createEmptyAnswer(item.entry.question));
    setHintOpen(false);
    setModelOpen(false);
    setCodeRunning(false);
    startRef.current = Date.now();
    // Reset only when the question changes, not when it is answered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.entry.key, session?.index, session?.id]);

  // A code submission can attach a run after the fact; show it in the panel.
  useEffect(() => {
    if (item?.result && item.answer) setDraft(item.answer);
  }, [item?.result, item?.answer]);

  useEffect(() => {
    if (!session || session.finished) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  const remaining =
    session?.timeLimitMs && !session.finished
      ? Math.max(0, session.timeLimitMs - (nowTick - session.startedAt))
      : null;

  useEffect(() => {
    if (remaining === 0 && session && !session.finished) actions.finishSession();
  }, [remaining, session, actions]);

  const canSubmit =
    !!draft &&
    !!question &&
    isAnswered(draft, question) &&
    !codeRunning &&
    !(question?.type === 'short' && draft.kind === 'short' && !draft.selfGrade);

  const submit = useCallback(async () => {
    if (!draft || !canSubmit) return;
    setSubmitting(true);
    try {
      await actions.submit(draft, Date.now() - startRef.current);
    } finally {
      setSubmitting(false);
    }
  }, [actions, canSubmit, draft]);

  const submitShort = useCallback(
    (selfGrade: SelfGrade) => {
      if (!draft || draft.kind !== 'short') return;
      actions.submit({ ...draft, selfGrade }, Date.now() - startRef.current);
    },
    [actions, draft],
  );

  const selectOption = useCallback(
    (index: number) => {
      if (!question || !draft || answered) return;
      if (question.type === 'boolean') {
        if (index === 0) setDraft({ kind: 'boolean', value: true });
        if (index === 1) setDraft({ kind: 'boolean', value: false });
        return;
      }
      const options = question.options ?? [];
      const option = options[index];
      if (!option) return;
      if (draft.kind === 'multi') {
        const next = draft.optionIds.includes(option.id)
          ? draft.optionIds.filter((id) => id !== option.id)
          : [...draft.optionIds, option.id];
        setDraft({ kind: 'multi', optionIds: next });
      } else if (draft.kind === 'single') {
        setDraft({ kind: 'single', optionId: option.id });
      } else if (draft.kind === 'custom') {
        setDraft({ kind: 'custom', value: option.id });
      }
    },
    [answered, draft, question],
  );

  useEffect(() => {
    if (!item?.result || item.flagged || !session) return undefined;
    const key = `${session.id}:${session.index}`;
    if (autoDoneRef.current.has(key)) return undefined;

    const drillAuto = drillMode;
    const settingAuto = state.progress.settings.autoNext && reveal && item.result.status === 'correct';
    if (!drillAuto && !settingAuto) return undefined;

    autoDoneRef.current.add(key);
    setPendingAuto(key);
    const delay = drillAuto ? 2000 : state.progress.settings.autoNextMs;
    const id = window.setTimeout(() => {
      setPendingAuto(null);
      actions.next();
    }, delay);
    return () => {
      window.clearTimeout(id);
      setPendingAuto(null);
    };
  }, [
    item,
    drillMode,
    reveal,
    session?.id,
    session?.index,
    state.progress.settings.autoNext,
    state.progress.settings.autoNextMs,
    actions,
  ]);

  /**
   * One primary action for the footer button and Enter:
   * - answered → move on
   * - exam → record the answer (if any) and move on; a blank answer just moves on
   * - other modes → submit, which then waits for the learner
   */
  const primary = useCallback(() => {
    if (submitting) return;
    const elapsed = Date.now() - startRef.current;
    if (session?.mode === 'exam') {
      if (session.index + 1 >= session.items.length) actions.finishSession(elapsed);
      else actions.next(elapsed);
      return;
    }
    if (answered) {
      actions.next(elapsed);
      return;
    }
    if (canSubmit) void submit();
  }, [actions, answered, canSubmit, session, submit, submitting]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const inTextarea = tagName === 'TEXTAREA';
      const inInput = tagName === 'INPUT' || inTextarea;

      if (event.key === 'Enter' && !inTextarea) {
        if (!item) return;
        event.preventDefault();
        primary();
        return;
      }
      if (inInput || !item) return;
      if (event.key === 'ArrowRight' && answered) {
        event.preventDefault();
        actions.next();
      } else if (event.key === 'ArrowLeft' && session && session.index > 0) {
        event.preventDefault();
        actions.prev();
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        actions.toggleFlagOnCurrent();
      } else if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        selectOption(Number(event.key) - 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions, answered, item, primary, selectOption, session]);

  if (!session) return null;

  if (session.finished) {
    return (
      <div className="session">
        <div className="session__bar">
          <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label={t('nav.today')}>
            <Icon name="chevronLeft" size={16} />
          </button>
          <div className="session__where">
            <span className="session__title">{t('results.title')}</span>
            <span className="session__meta">{session.label}</span>
          </div>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => navigate('/library')}>
            {t('results.backToDecks')}
          </button>
        </div>
        <SessionResults session={session} />
      </div>
    );
  }

  if (!item || !question) {
    return (
      <div className="session">
        <p className="lede">{t('toast.nothing')}</p>
      </div>
    );
  }

  const total = session.items.length;
  const isLast = session.index === total - 1;
  const progress = total === 0 ? 0 : (session.index + 1) / total;
  const modeKey = `mode.${session.mode}` as MessageKey;

  return (
    <div className="session">
      <div className="session__bar">
        <button type="button" className="icon-btn" onClick={() => setLeaveOpen(true)} aria-label={t('practice.leave')}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className="session__where">
          <span className="session__title">{session.label}</span>
          <span className="session__meta">
            {t(modeKey)} · {t('practice.questionOf', { index: session.index + 1, total })}
          </span>
        </div>
        {remaining !== null && state.progress.settings.showTimer ? (
          <span className={`session__timer ${remaining <= 60_000 ? 'is-urgent' : ''}`}>{formatClock(remaining)}</span>
        ) : null}
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          onClick={() => {
            if (session.mode === 'exam') setSubmitOpen(true);
            else actions.finishSession(Date.now() - startRef.current);
          }}
        >
          {session.mode === 'exam' ? t('practice.submitExam') : t('practice.end')}
        </button>
      </div>

      <div className="track">
        <div className="track__fill" style={{ width: `${progress * 100}%` }} />
      </div>

      <article className="qcard">
        <div className="qcard__meta">
          <span>{questionTypeLabel(question.type, t)}</span>
          {question.tags.length > 0 ? (
            <>
              <span className="dotsep">/</span>
              <span>{question.tags.join(' · ')}</span>
            </>
          ) : null}
          <button
            type="button"
            className={`flag-btn ${item.flagged ? 'is-on' : ''}`}
            onClick={() => actions.toggleFlagOnCurrent()}
            aria-pressed={item.flagged}
          >
            <Icon name="flag" size={12} strokeWidth={1.7} />
            {t('practice.flag')}
          </button>
        </div>

        <h2 className="qcard__prompt">{question.prompt}</h2>

        {question.media?.length ? (
          <div className="qcard__media">
            {question.media.map((media, index) => (
              <QuestionImage key={`${media.type}-${index}`} media={media} loading="eager" />
            ))}
          </div>
        ) : null}

        {question.hint && !answered ? (
          <div className="hint">
            <button type="button" onClick={() => setHintOpen((open) => !open)}>
              {hintOpen ? t('practice.hideHint') : t('practice.showHint')}
            </button>
            {hintOpen ? <p>{question.hint}</p> : null}
          </div>
        ) : null}

        {draft ? (
          <AnswerInput
            question={question}
            answer={draft}
            locked={session.mode === 'exam' ? false : answered}
            reveal={reveal && answered}
            result={item.result}
            canRun={canRunCode(session.mode)}
            onCodeRunningChange={setCodeRunning}
            onChange={(next) => {
              setDraft(next);
              if (session.mode === 'exam') actions.setAnswer(next);
            }}
          />
        ) : null}

        {question.type === 'short' && !answered && session.mode !== 'exam' ? (
          modelOpen ? (
            <div className="model">
              <span className="model__label">{t('practice.modelAnswer')}</span>
              <p className="model__text">{question.answer.kind === 'short' ? question.answer.model : ''}</p>
              <div className="selfgrade">
                <span className="selfgrade__label">{t('practice.selfGrade')}</span>
                <button type="button" className="btn btn--sm" onClick={() => submitShort('correct')}>
                  {t('practice.gradeCorrect')}
                </button>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => submitShort('partial')}>
                  {t('practice.gradePartial')}
                </button>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => submitShort('incorrect')}>
                  {t('practice.gradeWrong')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setModelOpen(true)}>
              {t('practice.showModel')}
            </button>
          )
        ) : null}

        {answered && reveal && item.result ? (
          <FeedbackPanel question={question} answer={item.answer} result={item.result} />
        ) : null}

        {pendingAuto === `${session.id}:${session.index}` ? (
          <p className="session__note">
            <Icon name="rotate" size={13} strokeWidth={1.7} />
            {t('practice.autoNext')}
          </p>
        ) : null}

        {answered && !reveal ? (
          <p className="session__note">
            <Icon name="info" size={13} strokeWidth={1.7} />
            {t('practice.recorded')}
          </p>
        ) : null}

        <div className="session__foot">
          <div className="pager">
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => actions.prev(Date.now() - startRef.current)}
              disabled={session.index === 0}
            >
              <Icon name="chevronLeft" size={13} />
              {t('practice.prev')}
            </button>
            {!answered && session.mode !== 'exam' ? (
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => actions.skipCurrent(Date.now() - startRef.current)}
              >
                {t('practice.skip')}
              </button>
            ) : null}
          </div>

          {total <= 60 ? (
            <div className="dots">
              {session.items.map((entryItem, index) => {
                const status = entryItem.result?.status;
                const classes = [
                  'dot',
                  index === session.index ? 'is-current' : '',
                  status === 'correct' ? 'is-ok' : '',
                  status === 'partial' ? 'is-part' : '',
                  status === 'incorrect' ? 'is-bad' : '',
                  !entryItem.result && entryItem.answer ? 'is-answered' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={entryItem.entry.key}
                    type="button"
                    className={classes}
                    onClick={() => actions.jump(index, Date.now() - startRef.current)}
                    aria-label={`${index + 1}`}
                  />
                );
              })}
            </div>
          ) : (
            <span className="row__value">
              {session.index + 1} / {total}
            </span>
          )}

          <div className="session__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={primary}
              disabled={submitting || (!answered && session.mode !== 'exam' && !canSubmit)}
            >
              {submitting
                ? t('code.running')
                : answered
                  ? isLast
                    ? t('practice.results')
                    : t('practice.next')
                  : session.mode === 'exam'
                    ? isLast
                      ? t('practice.submit')
                      : t('practice.next')
                    : t('practice.submit')}
              <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      </article>

      <p className="kbd-hint">{t('practice.shortcuts')}</p>

      <Sheet
        open={leaveOpen}
        title={t('practice.leaveTitle')}
        onClose={() => setLeaveOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--quiet" onClick={() => setLeaveOpen(false)}>
              {t('practice.keepGoing')}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                setLeaveOpen(false);
                actions.exitSession();
              }}
            >
              {t('practice.leave')}
            </button>
          </>
        }
      >
        <p>{t('practice.leaveBody')}</p>
      </Sheet>

      <Sheet
        open={submitOpen}
        title={t('practice.submitExamTitle')}
        onClose={() => setSubmitOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn--quiet" onClick={() => setSubmitOpen(false)}>
              {t('practice.keepGoing')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setSubmitOpen(false);
                actions.finishSession(Date.now() - startRef.current);
              }}
            >
              {t('practice.submitExamConfirm')}
            </button>
          </>
        }
      >
        <p>{t('practice.submitExamBody')}</p>
        {session.items.some((entry) => !entry.answer) ? (
          <p className="footnote">
            {t('practice.unanswered', { n: session.items.filter((entry) => !entry.answer).length })}
          </p>
        ) : null}
      </Sheet>
    </div>
  );
}
