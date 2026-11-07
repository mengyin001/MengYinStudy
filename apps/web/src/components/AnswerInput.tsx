import type { Answer, GradeResult, Question } from '@mengyin/core';
import { CodeAnswer } from './CodeAnswer';
import { Icon } from './Icons';
import { QuestionImage } from './QuestionImage';
import { rendererKindOf } from '@/domain/answers';
import { useApp } from '@/state/AppContext';

interface Props {
  question: Question;
  answer: Answer;
  locked: boolean;
  reveal: boolean;
  result: GradeResult | null;
  /** Code execution is disabled in exams. */
  canRun: boolean;
  onChange: (answer: Answer) => void;
  onCodeRunningChange?: (running: boolean) => void;
}

const LETTERS = 'ABCDEFGHIJ';

function selectedIdsOf(answer: Answer): string[] {
  if (answer.kind === 'single') return answer.optionId ? [answer.optionId] : [];
  if (answer.kind === 'multi') return answer.optionIds;
  if (answer.kind === 'custom' && Array.isArray(answer.value)) {
    return answer.value.filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function textValueOf(answer: Answer): string {
  if (answer.kind === 'fill' || answer.kind === 'short') return answer.value;
  if (answer.kind === 'custom' && typeof answer.value === 'string') return answer.value;
  return '';
}

function numberValueOf(answer: Answer): string {
  if (answer.kind !== 'custom') return '';
  const value = answer.value;
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '';
}

function choiceState(
  question: Question,
  optionId: string,
  selected: boolean,
  reveal: boolean,
): string {
  const classes = ['choice'];
  if (selected) classes.push('is-selected');
  if (reveal) {
    const key = question.answer;
    const correct =
      key.kind === 'single' ? key.optionId === optionId : key.kind === 'multi' ? key.optionIds.includes(optionId) : false;
    if (correct) classes.push('is-correct');
    else if (selected) classes.push('is-wrong');
  }
  return classes.join(' ');
}

export function AnswerInput({
  question,
  answer,
  locked,
  reveal,
  result,
  canRun,
  onChange,
  onCodeRunningChange,
}: Props) {
  const { t } = useApp();
  const kind = rendererKindOf(question);
  // Only mark correct/wrong once this question has actually been graded.
  // `reveal` alone is true for the whole practice session.
  const graded = reveal && result !== null;

  if (question.type === 'code') {
    return (
      <CodeAnswer
        question={question}
        answer={answer}
        locked={locked}
        canRun={canRun}
        onChange={onChange}
        {...(onCodeRunningChange ? { onRunningChange: onCodeRunningChange } : {})}
      />
    );
  }

  if (question.type === 'boolean') {
    const value = answer.kind === 'boolean' ? answer.value : null;
    const key = question.answer;
    const correct = key.kind === 'boolean' ? key.value : null;
    return (
      <div className="tf-row">
        {[true, false].map((option) => {
          const selected = value === option;
          const state = graded && correct !== null ? (correct === option ? 'is-correct' : selected ? 'is-wrong' : '') : '';
          return (
            <button
              key={String(option)}
              type="button"
              disabled={locked}
              className={`tf ${selected ? 'is-selected' : ''} ${state}`}
              onClick={() => onChange({ kind: 'boolean', value: option })}
            >
              <Icon name={option ? 'check' : 'x'} size={15} strokeWidth={1.8} />
              {option ? t('answer.true') : t('answer.false')}
            </button>
          );
        })}
      </div>
    );
  }

  if (kind === 'choice' || kind === 'multichoice') {
    const options = question.options ?? [];
    const multi = kind === 'multichoice';
    const selectedIds = selectedIdsOf(answer);
    const toggle = (optionId: string) => {
      if (multi) {
        const current = selectedIdsOf(answer);
        const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
        onChange(answer.kind === 'multi' ? { kind: 'multi', optionIds: next } : { kind: 'custom', value: next });
      } else {
        onChange(answer.kind === 'single' ? { kind: 'single', optionId } : { kind: 'custom', value: optionId });
      }
    };

    return (
      <div className="choice-block">
        {multi ? <p className="choice-hint">{t('practice.multiHint')}</p> : null}
        <div className="choice-list" role={multi ? 'group' : 'radiogroup'}>
          {options.map((option, index) => {
            const selected = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={selected}
                disabled={locked}
                className={choiceState(question, option.id, selected, graded)}
                onClick={() => toggle(option.id)}
              >
                <span className="choice__key">{LETTERS[index] ?? index + 1}</span>
                <span className="choice__text">
                  {option.text}
                  {option.media?.length ? (
                    <span className="choice__media">
                      {option.media.map((media, index) => (
                        <QuestionImage key={`${media.type}-${index}`} media={media} loading="lazy" />
                      ))}
                    </span>
                  ) : null}
                </span>
                <span className="choice__mark">
                  {multi ? (
                    <span className={`choice__box ${selected ? 'is-checked' : ''}`}>
                      {selected ? <Icon name="check" size={9} strokeWidth={2.6} /> : null}
                    </span>
                  ) : selected ? (
                    <Icon name="check" size={13} strokeWidth={2} />
                  ) : null}
                </span>
              </button>
            );
          })}
          {result?.status === 'partial' && reveal ? (
            <p className="field__hint" style={{ paddingTop: 'var(--s2)' }}>
              {t('practice.partialHint')}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (kind === 'number') {
    return (
      <label className="field">
        <span className="field__label">{t('practice.yourAnswer')}</span>
        <input
          type="number"
          inputMode="decimal"
          value={numberValueOf(answer)}
          disabled={locked}
          onChange={(event) =>
            onChange({ kind: 'custom', value: event.target.value === '' ? '' : Number(event.target.value) })
          }
          autoFocus
        />
      </label>
    );
  }

  const isShort = question.type === 'short';
  return (
    <label className="field">
      <span className="field__label">{t('practice.yourAnswer')}</span>
      {isShort ? (
        <textarea
          rows={4}
          value={textValueOf(answer)}
          disabled={locked}
          placeholder={t('practice.writeAnswer')}
          onChange={(event) => onChange({ kind: 'short', value: event.target.value, selfGrade: null })}
        />
      ) : (
        <input
          type="text"
          value={textValueOf(answer)}
          disabled={locked}
          placeholder={t('practice.answerPlaceholder')}
          autoComplete="off"
          autoFocus
          onChange={(event) => onChange({ kind: 'fill', value: event.target.value })}
        />
      )}
    </label>
  );
}
