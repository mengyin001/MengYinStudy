import type { AiQuestionResult } from '@mengyin/ai-contract';
import { examMinutesForQuestions } from '@mengyin/core';

function promptKey(prompt: string): string {
  return prompt
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, ' ');
}

/**
 * Add a new generation to the draft the learner already has. Question ids are
 * renumbered so the merged deck stays q1…qN, and exact duplicate prompts from
 * a second run are dropped instead of appearing twice.
 */
export function mergeGeneratedResults(
  current: AiQuestionResult,
  next: AiQuestionResult,
): AiQuestionResult {
  const seen = new Set(current.deck.questions.map((question) => promptKey(question.prompt)));
  const fresh = next.deck.questions.filter((question) => !seen.has(promptKey(question.prompt)));
  const questions = [...current.deck.questions, ...fresh].map((question, index) => ({
    ...question,
    id: `q${index + 1}`,
  }));
  const duplicates = next.deck.questions.length - fresh.length;
  const warnings = [...current.warnings, ...next.warnings];
  if (duplicates > 0) {
    warnings.push({
      code: 'duplicates',
      message: `${duplicates} duplicate question${duplicates === 1 ? '' : 's'} from the new batch ${
        duplicates === 1 ? 'was' : 'were'
      } skipped`,
    });
  }

  return {
    deck: {
      ...current.deck,
      questions,
      tags: [...new Set([...current.deck.tags, ...next.deck.tags])].slice(0, 8),
      examMinutes: examMinutesForQuestions(questions),
    },
    warnings,
    usage: {
      promptTokens: current.usage.promptTokens + next.usage.promptTokens,
      completionTokens: current.usage.completionTokens + next.usage.completionTokens,
      totalTokens: current.usage.totalTokens + next.usage.totalTokens,
    },
    engine: next.engine,
    images: {
      requested: current.images.requested + next.images.requested,
      generated: current.images.generated + next.images.generated,
      failed: current.images.failed + next.images.failed,
      diagrams: (current.images.diagrams ?? 0) + (next.images.diagrams ?? 0),
    },
  };
}
