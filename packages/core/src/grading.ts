import { gradeCode, isCodeAnswerFilled } from './code';
import type { Answer, GradeResult, Question } from './types';

/** Half-width a string so full-width Chinese input matches ASCII answers. */
export function toHalfWidth(input: string): string {
  return input.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export interface NormalizeOptions {
  ignoreCase?: boolean;
  ignoreSpaces?: boolean;
}

export function normalizeText(value: string, options: NormalizeOptions = {}): string {
  let out = toHalfWidth(value).trim();
  if (options.ignoreSpaces !== false) {
    out = out.replace(/\s+/g, ' ');
    // Chinese answers often gain or lose spaces around punctuation.
    out = out.replace(/\s*([,;:،，；：])\s*/g, '$1');
  }
  if (options.ignoreCase !== false) out = out.toLowerCase();
  return out;
}

export function isAnswered(answer: Answer | null, question?: Question): boolean {
  if (!answer) return false;
  // Code answers wrap a snippet in a custom value, so an empty object would
  // otherwise look like an answer.
  if (question?.type === 'code') return isCodeAnswerFilled(question, answer);
  switch (answer.kind) {
    case 'single':
      return answer.optionId !== null;
    case 'multi':
      return answer.optionIds.length > 0;
    case 'boolean':
      return answer.value !== null;
    case 'fill':
    case 'short':
      return answer.value.trim().length > 0;
    case 'custom':
      return answer.value !== null && answer.value !== undefined;
    default:
      return false;
  }
}

const PENDING: GradeResult = { status: 'pending', ratio: 0 };

export type CustomGrader = (question: Question, value: unknown) => GradeResult | null;

/**
 * Grade one answer. Unknown/custom question types are delegated to `custom`
 * (supplied by the plugin host) and otherwise stay pending.
 */
export function grade(
  question: Question,
  answer: Answer | null,
  custom?: CustomGrader,
): GradeResult {
  if (!answer) return PENDING;
  const key = question.answer;

  // Code questions are graded from the run recorded by the sandbox, never by
  // executing anything here. An exam paper therefore stays answer-only.
  if (question.type === 'code') return gradeCode(question, answer);

  if (answer.kind === 'custom') {
    return custom?.(question, answer.value) ?? PENDING;
  }

  switch (key.kind) {
    case 'single': {
      if (answer.kind !== 'single' || answer.optionId === null) return PENDING;
      const correct = answer.optionId === key.optionId;
      return { status: correct ? 'correct' : 'incorrect', ratio: correct ? 1 : 0 };
    }
    case 'multi': {
      if (answer.kind !== 'multi' || answer.optionIds.length === 0) return PENDING;
      const expected = new Set(key.optionIds);
      const selected = new Set(answer.optionIds);
      const hits = [...selected].filter((id) => expected.has(id)).length;
      const wrong = [...selected].filter((id) => !expected.has(id)).length;
      if (hits === expected.size && wrong === 0) return { status: 'correct', ratio: 1 };
      if (hits > 0 && wrong === 0) {
        return { status: 'partial', ratio: hits / expected.size };
      }
      return { status: 'incorrect', ratio: 0 };
    }
    case 'boolean': {
      if (answer.kind !== 'boolean' || answer.value === null) return PENDING;
      const correct = answer.value === key.value;
      return { status: correct ? 'correct' : 'incorrect', ratio: correct ? 1 : 0 };
    }
    case 'fill': {
      if (answer.kind !== 'fill') return PENDING;
      const given = normalizeText(answer.value, key);
      if (given.length === 0) return PENDING;
      const hit = key.accept.some((candidate) => normalizeText(candidate, key) === given);
      return hit ? { status: 'correct', ratio: 1 } : { status: 'incorrect', ratio: 0 };
    }
    case 'short': {
      if (answer.kind !== 'short') return PENDING;
      if (!answer.selfGrade) return PENDING;
      if (answer.selfGrade === 'correct') return { status: 'correct', ratio: 1 };
      if (answer.selfGrade === 'partial') return { status: 'partial', ratio: 0.5 };
      return { status: 'incorrect', ratio: 0 };
    }
    case 'custom':
      // Custom answer keys are graded through the injected plugin grader above.
      return PENDING;
    default:
      return PENDING;
  }
}

/** True when the question can be graded without human help. */
export function isAutoGraded(question: Question): boolean {
  return question.answer.kind !== 'short';
}