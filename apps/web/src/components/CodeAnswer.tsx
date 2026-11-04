import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  CODE_BLANK_PATTERN,
  codeLanguageInfo,
  codeQuestionMissingInput,
  codeSpecOf,
  codeValueOf,
  composeTestPrelude,
  type Answer,
  type CodeBlank,
  type CodeLanguage,
  type Question,
} from '@mengyin/core';
import { Icon } from './Icons';
import { runCodeCases, sampleInputOf } from '@/sandbox/codeRun';
import { runtimeVersionFor } from '@/sandbox/runtimeAssets';
import type { Translate } from '@/i18n/messages';
import { useApp } from '@/state/AppContext';

interface Props {
  question: Question;
  answer: Answer;
  locked: boolean;
  /** False in exams: the answer can be typed, never executed. */
  canRun: boolean;
  onChange: (answer: Answer) => void;
  onRunningChange?: (running: boolean) => void;
}

function sampleText(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function blankLabel(
  blank: CodeBlank,
  index: number,
  total: number,
  body: boolean,
  language: CodeLanguage,
  t: Translate,
): string {
  if (blank.label) return blank.label;
  if (body) return language === 'sql' ? t('code.query') : t('code.body');
  if (total === 1) return t('code.fillBlank');
  return t('code.blankN', { n: index + 1 });
}

function placeholderFor(language: CodeLanguage, t: Translate): string {
  switch (language) {
    case 'typescript':
      return t('code.placeholderTypescript');
    case 'python':
      return t('code.placeholderPython');
    case 'sql':
      return t('code.placeholderSql');
    case 'java':
      return t('code.placeholderJava');
    case 'cpp':
      return t('code.placeholderCpp');
    default:
      return t('code.placeholder');
  }
}

function runtimeName(language: CodeLanguage): string {
  if (language === 'python') return 'Pyodide';
  if (language === 'sql') return 'SQLite (sql.js)';
  if (language === 'java') return 'javac + TeaVM';
  if (language === 'cpp') return 'JSCPP';
  return '';
}

function indentPreviewValue(template: string, index: number, value: string): string {
  const lineStart = template.lastIndexOf('\n', index) + 1;
  const indent = template.slice(lineStart, index).match(/^[ \t]*/)?.[0] ?? '';
  const normalized = value.replace(/\r\n?/g, '\n');
  if (!indent) return normalized;
  return normalized
    .split('\n')
    .map((line, lineIndex) => (lineIndex === 0 || line.length === 0 ? line : `${indent}${line}`))
    .join('\n');
}

function previewNodes(
  template: string,
  values: Record<string, string>,
  blanks: CodeBlank[],
  language: CodeLanguage,
  t: Translate,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const comment = codeLanguageInfo(language).lineComment;
  let cursor = 0;
  let key = 0;
  for (const match of template.matchAll(CODE_BLANK_PATTERN)) {
    const index = match.index ?? 0;
    nodes.push(template.slice(cursor, index));
    const id = match[1] ?? 'blank';
    const blank = blanks.find((item) => item.id === id);
    const raw = values[id] ?? '';
    const display = raw.trim().length > 0
      ? indentPreviewValue(template, index, raw)
      : `${comment} ${blank?.label ?? blank?.id ?? t('code.gap')}`;
    nodes.push(
      <mark className="code-gap" key={`blank-${key++}`}>
        {display}
      </mark>,
    );
    cursor = index + match[0].length;
  }
  nodes.push(template.slice(cursor));
  return nodes;
}

/**
 * The code answer UI: one input per blank (or a large editor for a whole
 * function body), a live preview of the program that will run, and a run panel
 * with per-test output.
 */
export function CodeAnswer({
  question,
  answer,
  locked,
  canRun,
  onChange,
  onRunningChange,
}: Props) {
  const { t } = useApp();
  const spec = codeSpecOf(question);
  const value = codeValueOf(answer);
  const values = value?.values ?? {};
  const run = value?.run;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeVersion, setRuntimeVersion] = useState<string | null>(null);
  const [runtimeMissing, setRuntimeMissing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    // A new question invalidates any in-flight sandbox run.
    setRunning(false);
    setError(null);
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, [question.id]);

  useEffect(() => {
    onRunningChange?.(running);
  }, [running, onRunningChange]);

  useEffect(() => {
    const language = spec?.language;
    if (
      language !== 'python' &&
      language !== 'sql' &&
      language !== 'java' &&
      language !== 'cpp'
    ) {
      setRuntimeVersion(null);
      setRuntimeMissing(false);
      return;
    }
    let active = true;
    setRuntimeVersion(null);
    setRuntimeMissing(false);
    void runtimeVersionFor(language)
      .then((version) => {
        if (!active) return;
        setRuntimeVersion(version);
        setRuntimeMissing(version === null);
      })
      .catch(() => {
        if (active) setRuntimeMissing(true);
      });
    return () => {
      active = false;
    };
  }, [question.id, spec?.language]);

  if (!spec) {
    return <p className="notice notice--warn">{t('code.broken')}</p>;
  }

  const filled = spec.blanks.every((blank) => (values[blank.id] ?? '').trim().length > 0);
  const body = spec.layout === 'body';
  const multi = spec.blanks.length > 1;

  const setValue = (id: string, text: string) => {
    setError(null);
    // Editing invalidates the previous run; a stale run never grades.
    onChange({ kind: 'custom', value: { values: { ...values, [id]: text } } });
  };

  const runNow = async () => {
    if (!canRun || locked || running || !filled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = (generationRef.current += 1);
    setRunning(true);
    setError(null);
    try {
      const nextRun = await runCodeCases(question, values, { signal: controller.signal });
      if (generationRef.current !== generation) return;
      onChange({ kind: 'custom', value: { values, run: nextRun } });
    } catch (caught) {
      if (generationRef.current !== generation) return;
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (generationRef.current === generation) setRunning(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void runNow();
    }
  };

  const sample = sampleInputOf(question);
  const firstTest = spec.tests[0];
  const stdin = firstTest?.stdin;
  const prelude = firstTest ? composeTestPrelude(firstTest, spec.language) : '';
  const multipleTests = spec.tests.length > 1;
  const missingInput = codeQuestionMissingInput(question);
  const language = codeLanguageInfo(spec.language);

  return (
    <div className="code-answer">
      <div className="code-answer__bar">
        <span className="badge">{language.label}</span>
        <span className="code-answer__label">
          {body
            ? spec.language === 'sql'
              ? t('code.query')
              : t('code.body')
            : multi
              ? t('code.blankCount', { n: spec.blanks.length })
              : spec.blanks[0]?.label ?? t('code.blankLabel')}
        </span>
      </div>

      {missingInput ? <p className="notice notice--warn">{t('code.missingInput')}</p> : null}
      {runtimeMissing ? (
        <p className="notice notice--warn">
          {t('code.runtimeMissing', { language: language.label })}
        </p>
      ) : null}

      <div className={`code-blanks ${multi ? 'is-multi' : ''}`}>
        {spec.blanks.map((blank, index) => (
          <label className="field code-blank" key={blank.id}>
            <span className="field__label">
              {blankLabel(blank, index, spec.blanks.length, body, spec.language, t)}
            </span>
            <textarea
              className={`code-input ${body ? 'code-input--body' : ''}`}
              rows={body ? 12 : Math.min(6, Math.max(2, (values[blank.id] ?? '').split('\n').length))}
              value={values[blank.id] ?? ''}
              disabled={locked || running}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={
                blank.placeholder ??
                (body
                  ? spec.language === 'sql'
                    ? t('code.queryPlaceholder')
                    : t('code.bodyPlaceholder')
                  : placeholderFor(spec.language, t))
              }
              onChange={(event) => setValue(blank.id, event.target.value)}
              onKeyDown={onKeyDown}
              {...(index === 0 ? { autoFocus: true } : {})}
            />
          </label>
        ))}
      </div>

      <div className="code-preview">
        <div className="code-preview__head">
          <span className="eyebrow">{t('code.program')}</span>
          {prelude ? <span className="badge">{t('code.providedData')}</span> : null}
          {stdin !== undefined ? <span className="badge">{t('code.stdin')}</span> : null}
          {sample !== undefined && spec.language !== 'sql' ? (
            <span className="code-preview__sample">
              input = <code>{sampleText(sample)}</code>
            </span>
          ) : null}
        </div>
        {stdin !== undefined && stdin.length > 0 ? (
          <pre className="code-block code-preview__stdin">{stdin}</pre>
        ) : null}
        <pre className="code-block code-preview__code">
          <code>
            {prelude ? (
              <>
                <span className="code-context">{prelude}</span>
                {'\n\n'}
              </>
            ) : null}
            {previewNodes(spec.template, values, spec.blanks, spec.language, t)}
          </code>
        </pre>
        {stdin !== undefined ? (
          <p className="field__hint">{t('code.stdinHint')}</p>
        ) : prelude ? (
          <p className="field__hint">
            {multipleTests ? t('code.contextHintMultiple') : t('code.contextHint')}
          </p>
        ) : null}
      </div>

      {canRun ? (
        <div className="code-actions">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void runNow()}
            disabled={running || locked || !filled}
          >
            <Icon name="play" size={11} strokeWidth={2} />
            {running ? t('code.running') : t('code.run')}
          </button>
          <span className="code-actions__hint">Ctrl / ⌘ + Enter</span>
          {run ? (
            <span className={`badge ${run.passed === run.total ? 'badge--ok' : run.passed > 0 ? 'badge--warn' : 'badge--bad'}`}>
              {t('code.testsPassed', { passed: run.passed, total: run.total })}
            </span>
          ) : null}
          {!filled && !locked ? <span className="code-actions__hint">{t('code.fillAll')}</span> : null}
          {runtimeVersion ? (
            <span className="code-actions__hint">
              {t('code.runtimeReady', { runtime: runtimeName(spec.language), version: runtimeVersion })}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="notice notice--warn">{t('code.examLocked')}</p>
      )}

      {error ? <p className="notice notice--warn">{t('code.runFailed', { message: error })}</p> : null}

      {run ? (
        <div className="code-run" aria-live="polite">
          <div className="code-run__head">
            <span className="eyebrow">{t('code.output')}</span>
            <span className="code-run__time">
              {run.cases.reduce((max, item) => Math.max(max, item.ms), 0)} ms
            </span>
          </div>
          {run.cases.map((item, index) => (
            <div className={`code-case ${item.ok ? 'is-ok' : 'is-bad'}`} key={`${item.name}-${index}`}>
              <div className="code-case__head">
                <span className="code-case__name">{item.name}</span>
                <span className="code-case__status">
                  {item.ok ? t('code.pass') : t('code.fail')} · {item.ms} ms
                </span>
              </div>
              {item.error ? (
                <pre className="code-block code-case__out">{item.error}</pre>
              ) : (
                <pre className="code-block code-case__out">{item.output.trim() || t('code.noOutput')}</pre>
              )}
              {!item.ok && !item.error && item.output.trim() !== item.expected.trim() ? (
                <div className="code-case__expected">
                  {t('code.expected')} <code>{item.expected}</code>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
