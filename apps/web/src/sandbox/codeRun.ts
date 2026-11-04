/**
 * Bridge between a code question and the sandbox: compose one program per
 * test, run them, and record a `CodeRun` that the pure grader can consume.
 */
import {
  codeSpecOf,
  codeValueOf,
  composeTestProgram,
  DEFAULT_CODE_TIMEOUT_MS,
  normalizeCodeOutput,
  sameCodeValues,
  type Answer,
  type CodeRun,
  type CodeRunCase,
  type Question,
  type StudyMode,
} from '@mengyin/core';
import { runPrograms, type SandboxLanguage } from './runner';
import { runtimeBaseFor } from './runtimeAssets';
import { transpileTypeScript } from './transpile';

/**
 * Executing learner code is a practice affordance. Exams stay answer-only:
 * the Run control is hidden and submission never reaches the sandbox.
 */
export function canRunCode(mode: StudyMode): boolean {
  return mode !== 'exam';
}

export interface RunCodeOptions {
  signal?: AbortSignal;
}

/** Run every test for the current blank values and collect stdout/errors per case. */
export async function runCodeCases(
  question: Question,
  values: Record<string, string>,
  options: RunCodeOptions = {},
): Promise<CodeRun> {
  const spec = codeSpecOf(question);
  if (!spec) throw new Error('This question has no code specification');

  let programs = spec.tests.map((test) => composeTestProgram(spec, values, test));
  const stdins = spec.tests.map((test) => test.stdin ?? '');
  let language: SandboxLanguage = 'javascript';
  let runtimeBase: string | undefined;
  if (spec.language === 'typescript') {
    programs = await transpileTypeScript(programs);
  } else if (spec.language !== 'javascript') {
    language = spec.language;
    runtimeBase = await runtimeBaseFor(spec.language);
  }

  // Java spends most of its first run compiling and generating WebAssembly;
  // the normal 3 s exercise budget would report a false timeout.
  const baseTimeout = spec.timeoutMs ?? DEFAULT_CODE_TIMEOUT_MS;
  const timeoutMs = spec.language === 'java' ? Math.max(baseTimeout, 20_000) : baseTimeout;
  const results = await runPrograms(programs, {
    timeoutMs,
    language,
    stdins,
    ...(runtimeBase ? { runtimeBase } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const cases: CodeRunCase[] = [];
  spec.tests.forEach((test, index) => {
    const result = results[index] ?? { ok: false, output: '', error: 'No result', ms: 0 };
    const expected = normalizeCodeOutput(test.expect);
    const actual = normalizeCodeOutput(result.output);
    cases.push({
      name: test.name ?? `Test ${index + 1}`,
      ok: result.ok && actual === expected,
      output: result.output,
      expected: test.expect,
      ...(result.error ? { error: result.error } : {}),
      ms: result.ms,
    });
  });

  return {
    language: spec.language,
    values,
    cases,
    passed: cases.filter((item) => item.ok).length,
    total: cases.length,
    at: Date.now(),
  };
}

/**
 * Attach a fresh run to a code answer. A run made for the same values is
 * reused, so pressing Run then Submit does not execute twice.
 */
export async function prepareCodeAnswer(
  question: Question,
  answer: Answer,
  options: RunCodeOptions = {},
): Promise<Answer> {
  const spec = codeSpecOf(question);
  const value = codeValueOf(answer);
  if (!spec || !value) return answer;
  const filled = spec.blanks.every((blank) => (value.values[blank.id] ?? '').trim().length > 0);
  if (!filled) return answer;
  if (
    value.run &&
    (value.run.language ?? 'javascript') === spec.language &&
    sameCodeValues(value.run.values, value.values) &&
    value.run.total === spec.tests.length
  ) {
    return answer;
  }
  const run = await runCodeCases(question, value.values, options);
  return { kind: 'custom', value: { values: value.values, run } };
}

/** Exam drafts never carry a run, even if one was produced elsewhere. */
export function stripCodeRun(answer: Answer | null): Answer | null {
  if (!answer || answer.kind !== 'custom') return answer;
  const value = codeValueOf(answer);
  if (!value) return answer;
  return { kind: 'custom', value: { values: value.values } };
}

/** The sample input of the first test, for display next to the blanks. */
export function sampleInputOf(question: Question): unknown {
  const spec = codeSpecOf(question);
  return spec?.tests.find((test) => test.input !== undefined)?.input;
}
