import {
  codeSpecOf,
  codeValueOf,
  describeCodeAnswer,
  type Answer,
  type Question,
} from '@mengyin/core';
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
export function describeAnswer(question: Question): string {
  if (question.type === 'code') return describeCodeAnswer(question) || '—';
  const key = question.answer;
  switch (key.kind) {
    case 'single':
      return optionText(question, key.optionId);
    case 'multi':
      return key.optionIds.map((id) => optionText(question, id)).join('；');
    case 'boolean':
      return key.value ? '正確' : '錯誤';
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

export function describeGiven(question: Question, answer: Answer | null): string {
  if (!answer) return '未作答';
  if (question.type === 'code') {
    const spec = codeSpecOf(question);
    const value = codeValueOf(answer);
    if (!spec || !value) return '未作答';
    const filled = spec.blanks
      .map((blank) => ({
        label: blank.label ?? (spec.blanks.length === 1 ? '' : blank.id),
        value: (value.values[blank.id] ?? '').trim(),
      }))
      .filter((item) => item.value.length > 0);
    if (filled.length === 0) return '未作答';
    if (spec.blanks.length === 1) return filled[0]?.value ?? '未作答';
    return filled.map((item) => `${item.label}: ${item.value}`).join('\n');
  }
  switch (answer.kind) {
    case 'single':
      return answer.optionId ? optionText(question, answer.optionId) : '未作答';
    case 'multi':
      return answer.optionIds.length > 0
        ? answer.optionIds.map((id) => optionText(question, id)).join('；')
        : '未作答';
    case 'boolean':
      return answer.value === null ? '未作答' : answer.value ? '正確' : '錯誤';
    case 'fill':
    case 'short':
      return answer.value.trim() ? answer.value : '未作答';
    case 'custom': {
      const value = answer.value;
      if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '未作答';
      return value === null || value === undefined || value === '' ? '未作答' : String(value);
    }
    default:
      return '未作答';
  }
}

/** Short label for lists: strips long prompts. */
export function answerSummary(question: Question, answer: Answer | null): string {
  const text = describeGiven(question, answer);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
