import {
  codeSpecOf,
  codeValueOf,
  describeCodeAnswer,
  type Answer,
  type Question,
} from '@mengyin/core';
import type { Translate } from '@/i18n/messages';
import { questionTypes } from './registry';

export type AnswerMode = 'text' | 'number' | 'choice' | 'multichoice';

export function rendererKindOf(question: Question): AnswerMode {
  switch (question.type) {
    case 'single':
    case 'boolean':
      return 'choice';
    case 'multi':
      return 'multichoice';
    case 'fill':
    case 'short':
      return 'text';
    default:
      return questionTypes.get(question.type)?.rendererKind ?? 'text';
  }
}

function defaultCustomValue(kind: AnswerMode | undefined): unknown {
  if (kind === 'multichoice') return [];
  if (kind === 'number') return '';
  return '';
}

export function createEmptyAnswer(question: Question): Answer {
  switch (question.type) {
    case 'single':
      return { kind: 'single', optionId: null };
    case 'multi':
      return { kind: 'multi', optionIds: [] };
    case 'boolean':
      return { kind: 'boolean', value: null };
    case 'fill':
      return { kind: 'fill', value: '' };
    case 'short':
      return { kind: 'short', value: '', selfGrade: null };
    case 'code':
      return { kind: 'custom', value: { snippet: '' } };
    default: {
      const definition = questionTypes.get(question.type);
      return {
        kind: 'custom',
        value: definition?.defaultAnswer?.() ?? defaultCustomValue(definition?.rendererKind),
      };
    }
  }
}

export function optionText(question: Question, optionId: string): string {
  return question.options?.find((option) => option.id === optionId)?.text ?? optionId;
}

/** Text of the correct answer, for the feedback panel. */
export function describeAnswer(question: Question, t?: Translate): string {
  if (question.type === 'code') return describeCodeAnswer(question) || '—';
  const key = question.answer;
  switch (key.kind) {
    case 'single':
      return optionText(question, key.optionId);
    case 'multi':
      return key.optionIds.map((id) => optionText(question, id)).join('；');
    case 'boolean':
      return key.value ? (t?.('answer.true') ?? '正確') : (t?.('answer.false') ?? '錯誤');
    case 'fill':
      return key.accept.join(' / ');
    case 'short':
      return key.model;
    default: {
      const definition = questionTypes.get(question.type);
      return definition?.describeAnswer?.(question) ?? '由插件評分';
    }
  }
}

export function describeGiven(question: Question, answer: Answer | null, t?: Translate): string {
  const unanswered = t?.('answer.unanswered') ?? '未作答';
  if (!answer) return unanswered;
  if (question.type === 'code') {
    const spec = codeSpecOf(question);
    const value = codeValueOf(answer);
    if (!spec || !value) return unanswered;
    const filled = spec.blanks
      .map((blank) => ({
        label: blank.label ?? (spec.blanks.length === 1 ? '' : blank.id),
        value: (value.values[blank.id] ?? '').trim(),
      }))
      .filter((item) => item.value.length > 0);
    if (filled.length === 0) return unanswered;
    if (spec.blanks.length === 1) return filled[0]?.value ?? unanswered;
    return filled.map((item) => `${item.label}: ${item.value}`).join('\n');
  }
  switch (answer.kind) {
    case 'single':
      return answer.optionId ? optionText(question, answer.optionId) : unanswered;
    case 'multi':
      return answer.optionIds.length > 0
        ? answer.optionIds.map((id) => optionText(question, id)).join('；')
        : unanswered;
    case 'boolean':
      if (answer.value === null) return unanswered;
      return answer.value ? (t?.('answer.true') ?? '正確') : (t?.('answer.false') ?? '錯誤');
    case 'fill':
    case 'short':
      return answer.value.trim() ? answer.value : unanswered;
    case 'custom': {
      const value = answer.value;
      if (Array.isArray(value)) return value.length > 0 ? value.join('、') : unanswered;
      return value === null || value === undefined || value === '' ? unanswered : String(value);
    }
    default:
      return unanswered;
  }
}

/** Short label for lists: strips long prompts. */
export function answerSummary(question: Question, answer: Answer | null, t?: Translate): string {
  const text = describeGiven(question, answer, t);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
