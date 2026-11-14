import type { Answer, GradeResult, Question } from '@mengyin/core';
import { describeAnswer, describeGiven } from '@/domain/answers';
import { questionTypeLabel } from '@/domain/registry';
import type { MessageKey } from '@/i18n/messages';
import { useApp } from '@/state/AppContext';

const TONE: Record<string, { cls: string; key: MessageKey }> = {
  correct: { cls: 'verdict--ok', key: 'verdict.correct' },
  partial: { cls: 'verdict--part', key: 'verdict.partial' },
  incorrect: { cls: 'verdict--bad', key: 'verdict.incorrect' },
  pending: { cls: '', key: 'verdict.pending' },
};

export function FeedbackPanel({
  question,
  answer,
  result,
  showExplanation = true,
}: {
  question: Question;
  answer: Answer | null;
  result: GradeResult;
  /** Drill mode hides the explanation on correct answers to keep the loop fast. */
  showExplanation?: boolean;
}) {
  const { t } = useApp();
  const tone = TONE[result.status] ?? TONE.pending;
  if (!tone) return null;

  return (
    <section className={`verdict ${tone.cls}`} aria-live="polite">
      <p className="verdict__label">{t(tone.key)}</p>

      <div className="pairs">
        <div className="pairs__row">
          <span className="pairs__key">{t('verdict.yourAnswer')}</span>
          <span className={`pairs__val ${question.type === 'code' ? 'pairs__val--code' : ''}`}>
            {describeGiven(question, answer, t)}
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

      {showExplanation && question.explanation ? <p className="explain">{question.explanation}</p> : null}

      <div className="verdict__foot">
        <span className="eyebrow">{questionTypeLabel(question.type, t)}</span>
        {question.tags.length > 0 ? <span className="eyebrow">{question.tags.join(' · ')}</span> : null}
      </div>
    </section>
  );
}
