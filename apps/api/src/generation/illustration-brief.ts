/**
 * How a finished question is shown to the visual planner.
 *
 * The planner gets the answer on purpose: it must be able to avoid drawing the
 * thing the learner has to work out. Everything here is plain data, so the
 * prompt stays short and the model cannot confuse it with instructions.
 */
import type { Question } from '@mengyin/core';

function optionTexts(question: Question): string {
  return (question.options ?? []).map((option) => `${option.id}: ${option.text}`).join('\n');
}

/** A readable answer, so a brief can avoid depicting it. */
export function answerSummary(question: Question): string {
  const answer = question.answer;
  switch (answer.kind) {
    case 'single':
      return answer.optionId;
    case 'multi':
      return answer.optionIds.join(', ');
    case 'boolean':
      return answer.value ? 'true' : 'false';
    case 'fill':
      return answer.accept.join(' / ');
    case 'short':
      return answer.model;
    default:
      return '';
  }
}

/** One question as the planner sees it: what is asked, and what is true. */
export function briefSubject(question: Question): Record<string, unknown> {
  const options = optionTexts(question);
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    ...(options ? { options } : {}),
    answer: answerSummary(question),
    ...(question.explanation ? { explanation: question.explanation } : {}),
  };
}
