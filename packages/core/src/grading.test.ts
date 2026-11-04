import { describe, expect, it } from 'vitest';
import { grade, isAnswered, normalizeText } from './grading';
import type { Question } from './types';

function question(partial: Partial<Question>): Question {
  return {
    id: 'q1',
    type: 'single',
    prompt: 'prompt',
    tags: [],
    difficulty: 2,
    answer: { kind: 'single', optionId: 'a' },
    ...partial,
  };
}

describe('normalizeText', () => {
  it('converts full-width characters and lowercases', () => {
    expect(normalizeText('ＬＩＦＯ')).toBe('lifo');
  });

  it('collapses spaces and trims', () => {
    expect(normalizeText('  a   b  ')).toBe('a b');
  });

  it('keeps case when asked', () => {
    expect(normalizeText('AbC', { ignoreCase: false })).toBe('AbC');
  });
});

describe('grade', () => {
  it('grades single choice', () => {
    const q = question({});
    expect(grade(q, { kind: 'single', optionId: 'a' }).status).toBe('correct');
    expect(grade(q, { kind: 'single', optionId: 'b' }).status).toBe('incorrect');
    expect(grade(q, { kind: 'single', optionId: null }).status).toBe('pending');
  });

  it('grades multiple choice with partial credit', () => {
    const q = question({
      type: 'multi',
      answer: { kind: 'multi', optionIds: ['a', 'b', 'c'] },
    });
    expect(grade(q, { kind: 'multi', optionIds: ['a', 'b', 'c'] })).toEqual({ status: 'correct', ratio: 1 });
    const partial = grade(q, { kind: 'multi', optionIds: ['a'] });
    expect(partial.status).toBe('partial');
    expect(partial.ratio).toBeCloseTo(1 / 3);
    expect(grade(q, { kind: 'multi', optionIds: ['a', 'd'] }).status).toBe('incorrect');
  });

  it('grades boolean answers', () => {
    const q = question({ type: 'boolean', answer: { kind: 'boolean', value: false } });
    expect(grade(q, { kind: 'boolean', value: false }).status).toBe('correct');
    expect(grade(q, { kind: 'boolean', value: true }).status).toBe('incorrect');
    expect(grade(q, { kind: 'boolean', value: null }).status).toBe('pending');
  });

  it('grades fill answers ignoring case and spacing', () => {
    const q = question({ type: 'fill', answer: { kind: 'fill', accept: ['O(1)', '1'] } });
    expect(grade(q, { kind: 'fill', value: ' o(1) ' }).status).toBe('correct');
    expect(grade(q, { kind: 'fill', value: '１' }).status).toBe('correct');
    expect(grade(q, { kind: 'fill', value: 'O(n)' }).status).toBe('incorrect');
    expect(grade(q, { kind: 'fill', value: '   ' }).status).toBe('pending');
  });

  it('requires self grading for short answers', () => {
    const q = question({ type: 'short', answer: { kind: 'short', model: 'model' } });
    expect(grade(q, { kind: 'short', value: 'x', selfGrade: null }).status).toBe('pending');
    expect(grade(q, { kind: 'short', value: 'x', selfGrade: 'partial' })).toEqual({
      status: 'partial',
      ratio: 0.5,
    });
  });

  it('delegates custom answer kinds to the plugin grader', () => {
    const q = question({ type: 'numeric', answer: { kind: 'custom', value: 5 } });
    const custom = () => ({ status: 'correct' as const, ratio: 1 });
    expect(grade(q, { kind: 'custom', value: 5 }, custom).status).toBe('correct');
    expect(grade(q, { kind: 'custom', value: 5 }).status).toBe('pending');
  });
});

describe('isAnswered', () => {
  it('detects empty answers', () => {
    expect(isAnswered(null)).toBe(false);
    expect(isAnswered({ kind: 'multi', optionIds: [] })).toBe(false);
    expect(isAnswered({ kind: 'fill', value: '  ' })).toBe(false);
    expect(isAnswered({ kind: 'boolean', value: true })).toBe(true);
  });
});
