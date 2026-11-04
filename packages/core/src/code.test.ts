import { describe, expect, it } from 'vitest';
import {
  codeLanguageInfo,
  codeQuestionMissingInput,
  codeSpecOf,
  codeTemplateInfo,
  codeValueOf,
  composeCode,
  composeTestPrelude,
  composeTestProgram,
  countCodeBlanks,
  describeCodeAnswer,
  gradeCode,
  isCodeAnswerFilled,
  normalizeCodeOutput,
  sameCodeValues,
  serializeCodeInput,
  type CodeRun,
} from './code';
import { grade, isAnswered } from './grading';
import type { Answer, Question } from './types';

const singleQuestion: Question = {
  id: 'code-1',
  type: 'code',
  prompt: 'Fill in the expression that sums input.',
  answer: { kind: 'custom', value: {} },
  tags: ['Arrays'],
  difficulty: 2,
  meta: {
    code: {
      language: 'javascript',
      template: 'const total = {{blank}};\nconsole.log(total);',
      blankLabel: 'expression that sums input',
      solution: 'input.reduce((sum, n) => sum + n, 0)',
      tests: [
        { name: 'sample', input: [4, 7, 2], expect: '13' },
        { name: 'empty', input: [], expect: '0' },
      ],
    },
  },
};

const singleSnippet = 'input.reduce((sum, n) => sum + n, 0)';

const multiQuestion: Question = {
  id: 'code-multi',
  type: 'code',
  prompt: 'Fill in the six loop blanks.',
  answer: { kind: 'custom', value: {} },
  tags: ['Loops'],
  difficulty: 3,
  meta: {
    code: {
      language: 'javascript',
      template:
        'let count = 0;\nfor ({{blank:iInit}}; {{blank:iCond}}; {{blank:iStep}}) {\n  for ({{blank:jInit}}; {{blank:jCond}}; {{blank:jStep}}) {\n    count += 1;\n  }\n}\nconsole.log(count);',
      blanks: [
        { id: 'iInit', label: 'outer init' },
        { id: 'iCond', label: 'outer condition' },
        { id: 'iStep', label: 'outer step' },
        { id: 'jInit', label: 'inner init' },
        { id: 'jCond', label: 'inner condition' },
        { id: 'jStep', label: 'inner step' },
      ],
      solutions: {
        iInit: 'let i = 0',
        iCond: 'i < input.rows',
        iStep: 'i++',
        jInit: 'let j = 0',
        jCond: 'j < input.cols',
        jStep: 'j++',
      },
      tests: [
        { name: '2x3', input: { rows: 2, cols: 3 }, expect: '6' },
        { name: '1x1', input: { rows: 1, cols: 1 }, expect: '1' },
        { name: '0x5', input: { rows: 0, cols: 5 }, expect: '0' },
      ],
    },
  },
};

const multiValues: Record<string, string> = {
  iInit: 'let i = 0',
  iCond: 'i < input.rows',
  iStep: 'i++',
  jInit: 'let j = 0',
  jCond: 'j < input.cols',
  jStep: 'j++',
};

const bodyQuestion: Question = {
  id: 'code-body',
  type: 'code',
  prompt: 'Write the whole body of main.',
  answer: { kind: 'custom', value: {} },
  tags: ['Functions'],
  difficulty: 2,
  meta: {
    code: {
      language: 'javascript',
      layout: 'body',
      template: 'function main() {\n  {{blank}}\n}\nmain();',
      blankLabel: 'body of main()',
      solution: 'const total = input.reduce((sum, n) => sum + n, 0);\nconsole.log(total);',
      tests: [
        { name: 'sample', input: [1, 2, 3], expect: '6' },
        { name: 'empty', input: [], expect: '0' },
      ],
    },
  },
};

const bodyValues = {
  blank: 'const total = input.reduce((sum, n) => sum + n, 0);\nconsole.log(total);',
};

function makeRun(values: Record<string, string>, overrides: Partial<CodeRun> = {}): CodeRun {
  return {
    values,
    cases: [
      { name: 'a', ok: true, output: '13\n', expected: '13', ms: 2 },
      { name: 'b', ok: true, output: '0\n', expected: '0', ms: 1 },
    ],
    passed: 2,
    total: 2,
    at: 1,
    ...overrides,
  };
}

function answer(values: Record<string, string>, run?: CodeRun): Answer {
  return { kind: 'custom', value: { values, ...(run ? { run } : {}) } };
}

describe('code template markers', () => {
  it('counts and names markers', () => {
    expect(countCodeBlanks('a {{blank}} b')).toBe(1);
    expect(countCodeBlanks('{{blank:a}} {{blank:b}}')).toBe(2);
    expect(codeTemplateInfo('{{blank:a}} {{blank:b}}')).toEqual({
      ids: ['a', 'b'],
      named: true,
      problem: null,
    });
    expect(codeTemplateInfo('{{blank}}').ids).toEqual(['blank']);
  });

  it('rejects ambiguous or malformed templates', () => {
    expect(codeTemplateInfo('no markers').problem).toBe('missing');
    expect(codeTemplateInfo('{{blank}} {{blank}}').problem).toBe('unnamed-multiple');
    expect(codeTemplateInfo('{{blank}} {{blank:x}}').problem).toBe('mixed');
    expect(codeTemplateInfo('{{blank:x}} {{blank:x}}').problem).toBe('duplicate');
    expect(codeTemplateInfo('{{blank:bad id}}').problem).toBe('malformed');
  });
});

describe('single blank (legacy shape)', () => {
  const spec = codeSpecOf(singleQuestion);

  it('derives one blank and its solution', () => {
    expect(spec).not.toBeNull();
    expect(spec?.layout).toBe('inline');
    expect(spec?.blanks).toEqual([{ id: 'blank', label: 'expression that sums input' }]);
    expect(spec?.solutions).toEqual({ blank: singleSnippet });
  });

  it('accepts both the new values object and the legacy snippet field', () => {
    expect(codeValueOf({ kind: 'custom', value: { values: { blank: 'x' } } })).toEqual({
      values: { blank: 'x' },
    });
    expect(codeValueOf({ kind: 'custom', value: { snippet: 'x' } })).toEqual({
      values: { blank: 'x' },
    });
  });

  it('inserts a multi-line snippet with the surrounding indentation', () => {
    const indented = {
      ...spec!,
      template: 'if (ok) {\n  const total = {{blank}};\n  console.log(total);\n}',
    };
    expect(composeCode(indented, { blank: 'a +\n b' })).toContain('  const total = a +\n   b;');
  });

  it('prepends setup and input for a test', () => {
    const program = composeTestProgram(spec!, { blank: singleSnippet }, {
      input: [1, 2],
      setup: 'const extra = 1;',
      expect: '3',
    });
    expect(program.startsWith('const extra = 1;\nconst input = [1,2];')).toBe(true);
    expect(program).toContain('console.log(total);');
  });

  it('exposes the supplied context for the learner UI', () => {
    expect(composeTestPrelude({ input: ['a', 'b'], expect: '' })).toBe(
      'const input = ["a","b"];',
    );
    expect(
      composeTestPrelude({ setup: 'const extra = 1;', input: [1], expect: '1' }),
    ).toBe('const extra = 1;\nconst input = [1];');
    expect(composeTestPrelude({ expect: 'none' })).toBe('');
  });

  it('normalises output', () => {
    expect(normalizeCodeOutput('  a  \r\nb\t\n\n')).toBe('a\nb');
  });

  it('requires a filled blank and a fresh run', () => {
    expect(isCodeAnswerFilled(singleQuestion, answer({ blank: '   ' }))).toBe(false);
    expect(isAnswered(answer({ blank: '' }), singleQuestion)).toBe(false);
    expect(isAnswered(answer({ blank: singleSnippet }), singleQuestion)).toBe(true);
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }))).toEqual({
      status: 'pending',
      ratio: 0,
    });
    const stale = makeRun({ blank: 'something else' });
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }, stale))).toEqual({
      status: 'pending',
      ratio: 0,
    });
  });

  it('round-trips the run language through an answer value', () => {
    const value = codeValueOf({
      kind: 'custom',
      value: { values: { blank: 'x' }, run: makeRun({ blank: 'x' }, { language: 'python' }) },
    });
    expect(value?.run?.language).toBe('python');
  });

  it('never grades a run made for another language', () => {
    const pythonRun = makeRun({ blank: singleSnippet }, { language: 'python' });
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }, pythonRun))).toEqual({
      status: 'pending',
      ratio: 0,
    });
    const jsRun = makeRun({ blank: singleSnippet }, { language: 'javascript' });
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }, jsRun))).toEqual({
      status: 'correct',
      ratio: 1,
    });
  });

  it('grades all-pass, partial and fail', () => {
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }, makeRun({ blank: singleSnippet })))).toEqual({
      status: 'correct',
      ratio: 1,
    });

    const partial = makeRun({ blank: singleSnippet }, {
      cases: [
        { name: 'a', ok: true, output: '13', expected: '13', ms: 1 },
        { name: 'b', ok: false, output: 'NaN', expected: '0', ms: 1 },
      ],
      passed: 1,
    });
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }, partial))).toEqual({
      status: 'partial',
      ratio: 0.5,
    });

    const failed = makeRun({ blank: singleSnippet }, {
      cases: [
        { name: 'a', ok: false, output: '0', expected: '13', ms: 1 },
        { name: 'b', ok: false, output: '0', expected: '0', error: 'boom', ms: 1 },
      ],
      passed: 0,
    });
    expect(gradeCode(singleQuestion, answer({ blank: singleSnippet }, failed))).toEqual({
      status: 'incorrect',
      ratio: 0,
    });
  });

  it('routes core grade() through code grading', () => {
    expect(grade(singleQuestion, answer({ blank: singleSnippet }, makeRun({ blank: singleSnippet })))).toEqual({
      status: 'correct',
      ratio: 1,
    });
  });
});

describe('multiple blanks', () => {
  const spec = codeSpecOf(multiQuestion);

  it('derives every blank with its metadata and solution', () => {
    expect(spec).not.toBeNull();
    expect(spec?.blanks.map((blank) => blank.id)).toEqual([
      'iInit',
      'iCond',
      'iStep',
      'jInit',
      'jCond',
      'jStep',
    ]);
    expect(spec?.blanks[0]?.label).toBe('outer init');
    expect(spec?.solutions.iCond).toBe('i < input.rows');
  });

  it('fills all markers and leaves none behind', () => {
    const program = composeCode(spec!, multiValues);
    expect(program).toContain('for (let i = 0; i < input.rows; i++) {');
    expect(program).toContain('for (let j = 0; j < input.cols; j++) {');
    expect(program).not.toContain('{{blank');
  });

  it('needs every blank before it counts as answered', () => {
    const almost = { ...multiValues, jStep: '' };
    expect(isCodeAnswerFilled(multiQuestion, answer(almost))).toBe(false);
    expect(gradeCode(multiQuestion, answer(almost, makeRun(almost)))).toEqual({
      status: 'pending',
      ratio: 0,
    });
    expect(isCodeAnswerFilled(multiQuestion, answer(multiValues))).toBe(true);
  });

  it('grades from a run with matching values', () => {
    const run = makeRun(multiValues, {
      cases: [
        { name: '2x3', ok: true, output: '6', expected: '6', ms: 1 },
        { name: '1x1', ok: true, output: '1', expected: '1', ms: 1 },
        { name: '0x5', ok: true, output: '0', expected: '0', ms: 1 },
      ],
    });
    expect(gradeCode(multiQuestion, answer(multiValues, run))).toEqual({
      status: 'correct',
      ratio: 1,
    });
    expect(
      gradeCode(multiQuestion, answer({ ...multiValues, iStep: 'i += 2' }, makeRun(multiValues))),
    ).toEqual({ status: 'pending', ratio: 0 });
  });

  it('compares value maps', () => {
    expect(sameCodeValues({ a: '1' }, { a: '1' })).toBe(true);
    expect(sameCodeValues({ a: '1' }, { a: '2' })).toBe(false);
    // Missing and empty are both "not filled", so they compare equal.
    expect(sameCodeValues({ a: '1' }, { a: '1', b: '' })).toBe(true);
  });

  it('lists every model answer', () => {
    expect(describeCodeAnswer(multiQuestion)).toContain('outer init: let i = 0');
    expect(describeCodeAnswer(multiQuestion)).toContain('inner step: j++');
  });
});

describe('body layout', () => {
  const spec = codeSpecOf(bodyQuestion);

  it('uses one large blank and composes the body inside the function', () => {
    expect(spec?.layout).toBe('body');
    expect(spec?.blanks).toEqual([{ id: 'blank', label: 'body of main()' }]);
    const program = composeCode(spec!, bodyValues);
    expect(program).toContain(
      'function main() {\n  const total = input.reduce((sum, n) => sum + n, 0);\n  console.log(total);\n}\nmain();',
    );
  });

  it('grades like any other code answer', () => {
    const run = makeRun(bodyValues);
    expect(isCodeAnswerFilled(bodyQuestion, answer(bodyValues))).toBe(true);
    expect(gradeCode(bodyQuestion, answer(bodyValues, run))).toEqual({
      status: 'correct',
      ratio: 1,
    });
  });

  it('rejects body layout with more than one blank', () => {
    const bad: Question = {
      ...bodyQuestion,
      meta: {
        code: {
          ...(bodyQuestion.meta?.code as Record<string, unknown>),
          template: 'function main() {\n  {{blank:a}} {{blank:b}}\n}\nmain();',
        },
      },
    };
    expect(codeSpecOf(bad)).toBeNull();
  });

  it('flags a solution that uses input when no test or template provides it', () => {
    const raw = bodyQuestion.meta?.code as Record<string, unknown>;
    const missing: Question = {
      ...bodyQuestion,
      meta: { code: { ...raw, tests: [{ name: 'sample', expect: '6' }] } },
    };
    expect(codeQuestionMissingInput(missing)).toBe(true);

    const supplied: Question = {
      ...bodyQuestion,
      meta: { code: { ...raw, tests: [{ name: 'sample', input: [1, 2, 3], expect: '6' }] } },
    };
    expect(codeQuestionMissingInput(supplied)).toBe(false);

    const inTemplate: Question = {
      ...bodyQuestion,
      meta: {
        code: {
          ...raw,
          template: 'const input = [1, 2, 3];\nfunction main() {\n  {{blank}}\n}\nmain();',
          tests: [{ name: 'sample', expect: '6' }],
        },
      },
    };
    expect(codeQuestionMissingInput(inTemplate)).toBe(false);
  });
});

describe('multiple languages', () => {
  function questionFor(language: string, extra: Record<string, unknown> = {}): Question {
    return {
      id: `code-${language}`,
      type: 'code',
      prompt: 'Fill in the blank.',
      answer: { kind: 'custom', value: {} },
      tags: [],
      difficulty: 2,
      meta: {
        code: {
          language,
          template: '{{blank}}',
          solution: 'x',
          tests: [{ name: 'sample', input: [1], expect: '1' }],
          ...extra,
        },
      },
    };
  }

  it('defaults an omitted language to JavaScript', () => {
    const legacy = questionFor('javascript');
    const raw = legacy.meta?.code as Record<string, unknown>;
    delete (raw as { language?: unknown }).language;
    expect(codeSpecOf(legacy)?.language).toBe('javascript');
  });

  it('accepts every supported language and rejects an unknown one', () => {
    for (const language of ['javascript', 'typescript', 'python', 'sql', 'java', 'cpp'] as const) {
      expect(codeSpecOf(questionFor(language))?.language).toBe(language);
      expect(codeLanguageInfo(language).id).toBe(language);
    }
    expect(codeSpecOf(questionFor('ruby'))).toBeNull();
  });

  it('serializes Python values with Python literals', () => {
    expect(serializeCodeInput([4, 7, 2], 'python')).toBe('[4, 7, 2]');
    expect(serializeCodeInput({ ok: true, missing: null, ratio: 0.5 }, 'python')).toBe(
      '{"ok": True, "missing": None, "ratio": 0.5}',
    );
    expect(serializeCodeInput('a\n"b"', 'python')).toBe('"a\\n\\"b\\""');
  });

  it('shows Python input as a Python assignment and SQL input as raw statements', () => {
    expect(composeTestPrelude({ input: { rows: 2, ok: true }, expect: '' }, 'python')).toBe(
      'input = {"rows": 2, "ok": True}',
    );
    expect(
      composeTestPrelude(
        {
          setup: 'CREATE TABLE t (id INTEGER);',
          input: 'INSERT INTO t VALUES (1);',
          expect: '1',
        },
        'sql',
      ),
    ).toBe('CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (1);');
  });

  it('uses the language when composing a test program', () => {
    const python = questionFor('python', {
      template: 'print({{blank}})',
      solution: 'input[0]',
    });
    const spec = codeSpecOf(python)!;
    const program = composeTestProgram(spec, { blank: 'input[0]' }, { input: [2, 3], expect: '2' });
    expect(program).toBe('input = [2, 3]\n\nprint(input[0])');
  });

  it('does not apply the JavaScript input heuristic to SQL', () => {
    const sql = questionFor('sql', {
      template: 'SELECT {{blank}} FROM t;',
      solution: 'id',
      tests: [{ name: 'sample', expect: '1' }],
    });
    expect(codeQuestionMissingInput(sql)).toBe(false);
  });

  it('uses stdin for Java and C++ instead of an input variable', () => {
    for (const language of ['java', 'cpp'] as const) {
      const question = questionFor(language, {
        template: 'print({{blank}});',
        solution: 'input',
      });
      const spec = codeSpecOf(question)!;
      expect(serializeCodeInput([1, 2], language)).toBe('');
      expect(composeTestPrelude({ stdin: '1 2', expect: '3' }, language)).toBe('');
      expect(
        composeTestProgram(spec, { blank: 'reader.nextInt()' }, { stdin: '1 2', expect: '3' }),
      ).toBe('print(reader.nextInt());');
      expect(codeQuestionMissingInput(question)).toBe(false);
    }
  });
});
