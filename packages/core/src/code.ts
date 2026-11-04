/**
 * Code questions: a template with one or more blanks, the snippets the learner
 * fills in, and a set of tests whose expected stdout grades the run.
 *
 * Two shapes are supported:
 * - inline: one `{{blank}}`, or several named `{{blank:name}}` parts (for
 *   example the three clauses of a `for` header);
 * - body: one larger blank holding the whole body of a function such as
 *   `main()`, with the surrounding code supplied by the question author.
 *
 * Everything here is pure. Execution happens in the browser sandbox; this
 * module only composes the program and turns a recorded run into a grade, so
 * an exam paper can be marked without ever executing anything.
 */
import type { Answer, GradeResult, Question } from './types';

/** The single unnamed gap, kept for existing decks. */
export const CODE_BLANK = '{{blank}}';
/** `{{blank}}` or `{{blank:name}}`; names are 1–32 letters, digits, `_` or `-`. */
export const CODE_BLANK_PATTERN = /\{\{blank(?::([A-Za-z0-9_-]{1,32}))?\}\}/g;
export const MAX_CODE_BLANKS = 6;
export const DEFAULT_CODE_TIMEOUT_MS = 3000;
export const MAX_CODE_TIMEOUT_MS = 10_000;
export const MIN_CODE_TIMEOUT_MS = 500;

/**
 * Languages a code question can be written in. Every one runs locally in the
 * browser sandbox: JavaScript and TypeScript on the browser's own engine,
 * Python through Pyodide (WebAssembly), SQL through sql.js (SQLite), Java
 * through javac + TeaVM (WebAssembly) and C++ through the JSCPP interpreter.
 * Adding a language is a three-part change: a descriptor here, a runner in
 * `apps/web/src/sandbox`, and its static runtime assets.
 */
export const CODE_LANGUAGES = ['javascript', 'typescript', 'python', 'sql', 'java', 'cpp'] as const;
export type CodeLanguage = (typeof CODE_LANGUAGES)[number];
export const DEFAULT_CODE_LANGUAGE: CodeLanguage = 'javascript';

export interface CodeLanguageInfo {
  id: CodeLanguage;
  /** Proper noun, not translated. */
  label: string;
  /** Conventional source file extension, shown next to the label. */
  extension: string;
  /** Line comment used when the preview shows an empty gap. */
  lineComment: string;
  /**
   * How a test's `input` reaches the program:
   * - `json`  — exposed as a global `input` variable;
   * - `sql`   — a string of SQL statements run before the template;
   * - `stdin` — a string fed to the program's standard input (`cin`,
   *             `System.in`). Used by languages with no JSON value type.
   * - `none`  — no input channel.
   */
  input: 'json' | 'sql' | 'stdin' | 'none';
}

const CODE_LANGUAGE_INFO: Record<CodeLanguage, CodeLanguageInfo> = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    extension: 'js',
    lineComment: '//',
    input: 'json',
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    extension: 'ts',
    lineComment: '//',
    input: 'json',
  },
  python: {
    id: 'python',
    label: 'Python',
    extension: 'py',
    lineComment: '#',
    input: 'json',
  },
  sql: {
    id: 'sql',
    label: 'SQL',
    extension: 'sql',
    lineComment: '--',
    input: 'sql',
  },
  java: {
    id: 'java',
    label: 'Java',
    extension: 'java',
    lineComment: '//',
    input: 'stdin',
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    extension: 'cpp',
    lineComment: '//',
    input: 'stdin',
  },
};

export function isCodeLanguage(value: unknown): value is CodeLanguage {
  return typeof value === 'string' && (CODE_LANGUAGES as readonly string[]).includes(value);
}

export function codeLanguageInfo(language: CodeLanguage = DEFAULT_CODE_LANGUAGE): CodeLanguageInfo {
  return CODE_LANGUAGE_INFO[language] ?? CODE_LANGUAGE_INFO[DEFAULT_CODE_LANGUAGE];
}

export interface CodeTest {
  /** Shown in the run panel; defaults to "Test 1", "Test 2"… */
  name?: string;
  /** Statements prepended to the template for this case (data setup). */
  setup?: string;
  /** JSON value exposed to the program as a global `input`. */
  input?: unknown;
  /** Text fed to stdin for languages that read `cin` / `System.in`. */
  stdin?: string;
  /** Expected stdout, compared after trailing whitespace is normalised. */
  expect: string;
}

export interface CodeBlank {
  id: string;
  /** Short label shown above the input. */
  label?: string;
  placeholder?: string;
}

export type CodeTemplateProblem =
  | 'missing'
  | 'malformed'
  | 'mixed'
  | 'unnamed-multiple'
  | 'duplicate'
  | 'too-many';

export interface CodeTemplateInfo {
  /** Blank ids in template order. The unnamed blank is `blank`. */
  ids: string[];
  named: boolean;
  problem: CodeTemplateProblem | null;
}

export interface CodeSpec {
  language: CodeLanguage;
  template: string;
  layout: 'inline' | 'body';
  /** Derived from the template, enriched by optional author metadata. */
  blanks: CodeBlank[];
  /** Model snippet for every blank id. */
  solutions: Record<string, string>;
  tests: CodeTest[];
  timeoutMs?: number;
}

export interface CodeRunCase {
  name: string;
  ok: boolean;
  output: string;
  expected: string;
  error?: string;
  ms: number;
}

export interface CodeRun {
  /** The language this run was produced in. Older runs omitted it (JavaScript). */
  language?: CodeLanguage;
  /** The blank values this run belongs to. A run for older text is never reused. */
  values: Record<string, string>;
  cases: CodeRunCase[];
  passed: number;
  total: number;
  at: number;
}

export interface CodeAnswerValue {
  values: Record<string, string>;
  run?: CodeRun;
}

/** Inspect a template's markers without trusting the rest of the spec. */
export function codeTemplateInfo(template: string): CodeTemplateInfo {
  const valid = [...template.matchAll(CODE_BLANK_PATTERN)];
  const looseCount = (template.match(/\{\{blank[^}]*\}\}/g) ?? []).length;
  if (looseCount === 0) return { ids: [], named: false, problem: 'missing' };
  if (valid.length === 0 || looseCount !== valid.length) {
    return { ids: [], named: false, problem: 'malformed' };
  }

  const ids: string[] = [];
  let named = 0;
  let unnamed = 0;
  for (const match of valid) {
    const name = match[1];
    if (name) {
      named += 1;
      ids.push(name);
    } else {
      unnamed += 1;
      ids.push('blank');
    }
  }
  if (named > 0 && unnamed > 0) return { ids, named: true, problem: 'mixed' };
  if (unnamed > 1) return { ids, named: false, problem: 'unnamed-multiple' };
  if (new Set(ids).size !== ids.length) return { ids, named: named > 0, problem: 'duplicate' };
  if (ids.length > MAX_CODE_BLANKS) return { ids, named: named > 0, problem: 'too-many' };
  return { ids, named: named > 0, problem: null };
}

export function countCodeBlanks(template: string): number {
  return [...template.matchAll(CODE_BLANK_PATTERN)].length;
}

function readBlanks(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
}

/** Split an arbitrary meta value into a usable code spec, without zod. */
export function codeSpecOf(question: Question): CodeSpec | null {
  if (question.type !== 'code') return null;
  const raw = question.meta?.code;
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.template !== 'string') return null;

  const language = value.language === undefined ? DEFAULT_CODE_LANGUAGE : value.language;
  if (!isCodeLanguage(language)) return null;

  const info = codeTemplateInfo(value.template);
  if (info.problem) return null;

  const layout = value.layout === 'body' ? 'body' : 'inline';
  if (layout === 'body' && info.ids.length !== 1) return null;

  const solutions: Record<string, string> = {};
  if (value.solutions && typeof value.solutions === 'object') {
    for (const [key, solution] of Object.entries(value.solutions as Record<string, unknown>)) {
      if (typeof solution === 'string') solutions[key] = solution;
    }
  }
  if (typeof value.solution === 'string' && info.ids.length === 1) {
    const id = info.ids[0];
    if (id && !(solutions[id] ?? '').trim()) solutions[id] = value.solution;
  }
  if (info.ids.some((id) => !(solutions[id] ?? '').trim())) return null;

  const metadata = readBlanks(value.blanks);
  const blanks: CodeBlank[] = info.ids.map((id) => {
    const meta = metadata.find((item) => item.id === id);
    const legacyLabel =
      info.ids.length === 1 && typeof value.blankLabel === 'string' ? value.blankLabel : undefined;
    const label = typeof meta?.label === 'string' && meta.label.trim() ? meta.label.trim() : legacyLabel;
    const placeholder =
      typeof meta?.placeholder === 'string' && meta.placeholder.trim() ? meta.placeholder.trim() : undefined;
    return {
      id,
      ...(label ? { label } : {}),
      ...(placeholder ? { placeholder } : {}),
    };
  });

  if (!Array.isArray(value.tests) || value.tests.length === 0) return null;
  const tests: CodeTest[] = [];
  for (const entry of value.tests) {
    if (!entry || typeof entry !== 'object') return null;
    const test = entry as Record<string, unknown>;
    if (typeof test.expect !== 'string') return null;
    tests.push({
      ...(typeof test.name === 'string' && test.name.trim() ? { name: test.name.trim() } : {}),
      ...(typeof test.setup === 'string' && test.setup.trim() ? { setup: test.setup } : {}),
      ...('input' in test ? { input: test.input } : {}),
      ...(typeof test.stdin === 'string' ? { stdin: test.stdin } : {}),
      expect: test.expect,
    });
  }

  const timeout = value.timeoutMs;
  return {
    language,
    template: value.template,
    layout,
    blanks,
    solutions,
    tests,
    ...(typeof timeout === 'number' && Number.isFinite(timeout)
      ? { timeoutMs: Math.min(MAX_CODE_TIMEOUT_MS, Math.max(MIN_CODE_TIMEOUT_MS, Math.round(timeout))) }
      : {}),
  };
}

/**
 * True when a solution relies on the runner-provided `input` but nothing shows
 * the learner what that value is: not the template, not a test input, and not a
 * test setup. A generated question like this is unusable and should be dropped.
 */
export function codeQuestionMissingInput(question: Question): boolean {
  const spec = codeSpecOf(question);
  if (!spec) return false;
  if (codeLanguageInfo(spec.language).input !== 'json') return false;
  const solutions = Object.values(spec.solutions).join('\n');
  if (!/\binput\b/.test(solutions)) return false;
  if (/\binput\b/.test(spec.template)) return false;
  return !spec.tests.some(
    (test) =>
      test.input !== undefined ||
      /\b(?:const|let|var)\s+input\b/.test(test.setup ?? ''),
  );
}

function indentSnippet(snippet: string, indent: string): string {
  if (!indent) return snippet;
  return snippet
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line, index) => (index === 0 || line.length === 0 ? line : `${indent}${line}`))
    .join('\n');
}

/**
 * Put every snippet into its marker. Continuation lines inherit the column of
 * the marker so a multi-line body still reads like the surrounding code.
 */
export function composeCode(spec: CodeSpec, values: Record<string, string>): string {
  let output = '';
  let cursor = 0;
  for (const match of spec.template.matchAll(CODE_BLANK_PATTERN)) {
    const index = match.index ?? 0;
    output += spec.template.slice(cursor, index);
    const id = match[1] ?? 'blank';
    const lineStart = spec.template.lastIndexOf('\n', index) + 1;
    const indent = spec.template.slice(lineStart, index).match(/^[ \t]*/)?.[0] ?? '';
    output += indentSnippet(values[id] ?? '', indent);
    cursor = index + match[0].length;
  }
  return `${output}${spec.template.slice(cursor)}`;
}

function pythonLiteral(value: unknown, depth = 0): string {
  if (depth > 32) return 'None';
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') {
    // JSON string escapes (\n, \", \\, \uXXXX) are all valid Python escapes.
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pythonLiteral(item, depth + 1)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, item]) => `${JSON.stringify(key)}: ${pythonLiteral(item, depth + 1)}`,
    );
    return `{${entries.join(', ')}}`;
  }
  return 'None';
}

/**
 * Turn a test's JSON input into the source form used by a language. Java-
 * Script/TypeScript use a JSON literal; Python uses its own literal spelling;
 * SQL takes a string of setup statements. Anything else gets an empty string
 * (the schema rejects it before a deck can load).
 */
export function serializeCodeInput(value: unknown, language: CodeLanguage = DEFAULT_CODE_LANGUAGE): string {
  switch (language) {
    case 'javascript':
    case 'typescript': {
      const text = JSON.stringify(value);
      return text === undefined ? 'undefined' : text;
    }
    case 'python':
      return pythonLiteral(value);
    case 'sql':
      return typeof value === 'string' ? value.trim() : '';
    case 'java':
    case 'cpp':
      // These languages use the test's `stdin` string instead of a JSON value.
      return '';
    default:
      return '';
  }
}

/** The data a test prepends to the template. Shown to the learner above the blank. */
export function composeTestPrelude(
  test: CodeTest,
  language: CodeLanguage = DEFAULT_CODE_LANGUAGE,
): string {
  const info = codeLanguageInfo(language);
  const prelude: string[] = [];
  const setup = test.setup?.trim();
  if (setup) prelude.push(setup);

  if (test.input !== undefined) {
    if (info.input === 'json') {
      const literal = serializeCodeInput(test.input, language);
      prelude.push(
        language === 'python' ? `input = ${literal}` : `const input = ${literal};`,
      );
    } else if (info.input === 'sql') {
      const sql = serializeCodeInput(test.input, language);
      if (sql) prelude.push(sql);
    }
  }
  return prelude.join('\n');
}

/** The program for one test: its setup/input, then the filled template. */
export function composeTestProgram(
  spec: CodeSpec,
  values: Record<string, string>,
  test: CodeTest,
): string {
  const program = composeCode(spec, values);
  const prelude = composeTestPrelude(test, spec.language);
  return prelude ? `${prelude}\n\n${program}` : program;
}

/** Compare output the way a human would: line endings and trailing spaces. */
export function normalizeCodeOutput(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

export function sameCodeValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] ?? '') !== (b[key] ?? '')) return false;
  }
  return true;
}

export function codeValueOf(answer: Answer | null): CodeAnswerValue | null {
  if (!answer || answer.kind !== 'custom') return null;
  const value = answer.value;
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const values: Record<string, string> = {};
  if (raw.values && typeof raw.values === 'object') {
    for (const [key, item] of Object.entries(raw.values as Record<string, unknown>)) {
      if (typeof item === 'string') values[key] = item;
    }
  } else if (typeof raw.snippet === 'string') {
    // Legacy single-blank answer shape.
    values.blank = raw.snippet;
  }
  const run = readRun(raw.run);
  return run ? { values, run } : { values };
}

function readRun(value: unknown): CodeRun | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.cases)) return null;

  const values: Record<string, string> = {};
  if (raw.values && typeof raw.values === 'object') {
    for (const [key, item] of Object.entries(raw.values as Record<string, unknown>)) {
      if (typeof item === 'string') values[key] = item;
    }
  } else if (typeof raw.snippet === 'string') {
    values.blank = raw.snippet;
  } else {
    return null;
  }

  const cases: CodeRunCase[] = [];
  for (const entry of raw.cases) {
    if (!entry || typeof entry !== 'object') return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.output !== 'string' || typeof item.expected !== 'string') return null;
    cases.push({
      name: typeof item.name === 'string' ? item.name : 'case',
      ok: item.ok === true,
      output: item.output,
      expected: item.expected,
      ...(typeof item.error === 'string' ? { error: item.error } : {}),
      ms: typeof item.ms === 'number' && Number.isFinite(item.ms) ? item.ms : 0,
    });
  }
  return {
    ...(isCodeLanguage(raw.language) ? { language: raw.language } : {}),
    values,
    cases,
    passed: cases.filter((item) => item.ok).length,
    total: cases.length,
    at: typeof raw.at === 'number' ? raw.at : 0,
  };
}

/** True when every blank the question requires has been filled. */
export function isCodeAnswerFilled(question: Question, answer: Answer | null): boolean {
  const spec = codeSpecOf(question);
  const value = codeValueOf(answer);
  if (!spec || !value) return false;
  return spec.blanks.every((blank) => (value.values[blank.id] ?? '').trim().length > 0);
}

/**
 * Grade from an already-recorded run. A run is only trusted when it was made
 * for the same blank values and covers every test. No execution happens here.
 */
export function gradeCode(question: Question, answer: Answer | null): GradeResult {
  const spec = codeSpecOf(question);
  const value = codeValueOf(answer);
  if (!spec || !value || !isCodeAnswerFilled(question, answer)) {
    return { status: 'pending', ratio: 0 };
  }
  if (
    !value.run ||
    (value.run.language ?? 'javascript') !== spec.language ||
    !sameCodeValues(value.run.values, value.values) ||
    value.run.total !== spec.tests.length
  ) {
    return { status: 'pending', ratio: 0 };
  }
  const total = value.run.total;
  if (total === 0) return { status: 'pending', ratio: 0 };
  const ratio = value.run.passed / total;
  if (ratio === 1) return { status: 'correct', ratio: 1 };
  if (ratio > 0) return { status: 'partial', ratio };
  return { status: 'incorrect', ratio: 0 };
}

/** Model answers for the feedback panel, one line per blank. */
export function describeCodeAnswer(question: Question): string {
  const spec = codeSpecOf(question);
  if (!spec) return '';
  if (spec.blanks.length === 1) {
    const blank = spec.blanks[0];
    return blank ? (spec.solutions[blank.id] ?? '').trim() : '';
  }
  return spec.blanks
    .map((blank) => `${blank.label ?? blank.id}: ${(spec.solutions[blank.id] ?? '').trim()}`)
    .join('\n');
}

/** First expected output, used as a compact answer summary. */
export function expectedCodeOutput(question: Question): string {
  return codeSpecOf(question)?.tests[0]?.expect ?? '';
}
