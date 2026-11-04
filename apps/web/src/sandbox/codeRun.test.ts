import { describe, expect, it } from 'vitest';
import {
  createSession,
  gradeSession,
  setDraftAnswer,
  type Answer,
  type Deck,
  type Question,
  type QuestionEntry,
} from '@mengyin/core';
import { canRunCode, prepareCodeAnswer, stripCodeRun } from './codeRun';

const question: Question = {
  id: 'code-1',
  type: 'code',
  prompt: 'Fill in the expression.',
  answer: { kind: 'custom', value: {} },
  tags: ['Arrays'],
  difficulty: 2,
  meta: {
    code: {
      language: 'javascript',
      template: 'const total = {{blank}};\nconsole.log(total);',
      solution: 'input.reduce((sum, n) => sum + n, 0)',
      tests: [
        { name: 'a', input: [1, 2], expect: '3' },
        { name: 'b', input: [], expect: '0' },
      ],
    },
  },
};

const snippet = 'input.reduce((sum, n) => sum + n, 0)';
const answer: Answer = {
  kind: 'custom',
  value: {
    values: { blank: snippet },
    run: {
      values: { blank: snippet },
      cases: [
        { name: 'a', ok: true, output: '3\n', expected: '3', ms: 1 },
        { name: 'b', ok: true, output: '0\n', expected: '0', ms: 1 },
      ],
      passed: 2,
      total: 2,
      at: 1,
    },
  },
};

describe('code run gating', () => {
  it('never runs code in exams', () => {
    expect(canRunCode('exam')).toBe(false);
    for (const mode of ['practice', 'drill', 'review', 'srs', 'random'] as const) {
      expect(canRunCode(mode)).toBe(true);
    }
  });

  it('strips a run from an exam answer', () => {
    expect(stripCodeRun(answer)).toEqual({
      kind: 'custom',
      value: { values: { blank: snippet } },
    });
    expect(stripCodeRun(null)).toBeNull();
  });

  it('reuses a fresh run instead of executing again', async () => {
    // No DOM in this test: a sandbox call would throw, so this proves reuse.
    const prepared = await prepareCodeAnswer(question, answer);
    expect(prepared).toBe(answer);
  });

  it('leaves an empty answer alone', async () => {
    const empty: Answer = { kind: 'custom', value: { values: { blank: '   ' } } };
    await expect(prepareCodeAnswer(question, empty)).resolves.toBe(empty);
  });

  it('marks an exam code answer as skipped after the run is stripped', () => {
    const deck: Deck = {
      key: 'ai.test::deck',
      id: 'deck',
      pluginId: 'ai.test',
      title: 'Test',
      tags: [],
      questions: [question],
    };
    const entry: QuestionEntry = { deck, question, key: 'ai.test::deck#code-1' };
    const session = createSession({ mode: 'exam', entries: [entry], reveal: false });
    const stripped = stripCodeRun(answer);
    expect(stripped).not.toBeNull();
    const drafted = setDraftAnswer(session, 0, stripped);
    const graded = gradeSession(drafted);
    expect(graded.items[0]?.result?.status).toBe('pending');
    expect(graded.items[0]?.skipped).toBe(true);
  });
});
