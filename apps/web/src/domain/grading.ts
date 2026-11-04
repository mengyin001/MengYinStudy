import { grade, type Answer, type GradeResult, type Question } from '@mengyin/core';
import { questionTypes } from './registry';

/**
 * Core grading plus plugin-supplied checkers for custom question types.
 * A throwing plugin checker degrades to "pending" instead of crashing a session.
 */
export function gradeQuestion(question: Question, answer: Answer | null): GradeResult {
  return grade(question, answer, (q, value) => {
    const definition = questionTypes.get(q.type);
    if (!definition) return null;
    try {
      return definition.check(q, value);
    } catch {
      return { status: 'pending', ratio: 0 };
    }
  });
}
