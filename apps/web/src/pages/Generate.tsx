import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CODE_LANGUAGES,
  codeLanguageInfo,
  codeSpecOf,
  examMinutesForQuestions,
  type CodeLanguage,
  type Question,
} from '@mengyin/core';
import { AiError } from '@/ai/client';
import { isAiConfigured } from '@/ai/config';
import { ACCEPTED_EXTENSIONS } from '@/ai/extract';
import { generateQuestions, type GenerateResult } from '@/ai/generate';
import { MAX_MATERIAL_BYTES, totalMaterialBytes, totalMaterialChars } from '@/ai/materials';
import { QUESTION_SKILL, QUESTION_SKILL_VERSION } from '@/ai/skill';
import type { GeneratedDifficulty, GeneratedLanguage, GenerationProgress } from '@/ai/types';
import { ALL_GENERATED_TYPES, type GeneratedQuestionType } from '@/ai/types';
import { Icon } from '@/components/Icons';
import { Meter, Note, NumField, PageHead, Seg, Sheet } from '@/components/ui';
import { describeAnswer } from '@/domain/answers';
import { questionTypeLabel } from '@/domain/registry';
import type { Translate } from '@/i18n/messages';
import { formatBytes } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';

function progressLabel(progress: GenerationProgress, t: Translate): string {
  switch (progress.stage) {
    case 'requesting':
      return t('gen.started', { batch: progress.batch, batches: progress.batches });
    case 'repairing':
      return t('gen.repairing');
    case 'splitting':
      return t('gen.splitting');
    case 'validating':
      return t('gen.validating');
    case 'done':
      return t('gen.results');
    default:
      return t('gen.generating');
  }
}

function correctOptionIds(question: Question): Set<string> {
  if (question.answer.kind === 'single') return new Set([question.answer.optionId]);
  if (question.answer.kind === 'multi') return new Set(question.answer.optionIds);
  return new Set();
}

export function GeneratePage() {
  const { state, locale, t, actions } = useApp();
  const { state: auth } = useAuth();
  const config = state.aiConfig;
  const configured = isAiConfigured(config);
  const materials = state.materials;
  const usedBytes = totalMaterialBytes(materials);

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<GeneratedDifficulty>('mixed');
  const [language, setLanguage] = useState<GeneratedLanguage>('auto');
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>('javascript');
  const [types, setTypes] = useState<GeneratedQuestionType[]>([...ALL_GENERATED_TYPES]);
  const [focus, setFocus] = useState('');
  const [dragging, setDragging] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skillOpen, setSkillOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectedCount = useMemo(() => selected.size, [selected]);

  const toggleType = (type: GeneratedQuestionType) => {
    if (types.includes(type)) {
      if (types.length === 1) {
        actions.notify('info', t('gen.typesRequired'));
        return;
      }
      setTypes(types.filter((item) => item !== type));
      return;
    }
    setTypes(ALL_GENERATED_TYPES.filter((item) => types.includes(item) || item === type));
  };

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setIngesting(t('gen.ingesting', { name: '…' }));
    const outcome = await actions.addMaterials(files, (entry) => {
      setIngesting(entry.message.startsWith('pdf:') ? `${entry.fileName} · ${entry.message}` : entry.fileName);
    });
    setIngesting(null);
    if (outcome.added === 0 && outcome.errors.length === 0) {
      actions.notify('info', t('gen.noText'));
    }
  };

  const generate = async () => {
    if (!auth.user) {
      actions.notify('info', t('gen.signInBody'));
      navigate('/login');
      return;
    }
    if (!configured) {
      actions.notify('info', t('gen.needConfig'));
      return;
    }
    const brief = description.trim();
    const firstLine = brief.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    const resolvedTopic = topic.trim() || firstLine.slice(0, 80) || '';
    if (!resolvedTopic) {
      actions.notify('info', t('gen.needTopic'));
      return;
    }
    if (materials.length === 0 && !brief) {
      actions.notify('info', t('gen.needSource'));
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setResult(null);
    setSelected(new Set());
    setProgress({ stage: 'preparing', batch: 0, batches: 0, message: '' });

    try {
      const generated = await generateQuestions(
        config,
        {
          topic: resolvedTopic,
          count,
          difficulty,
          language,
          types,
          ...(types.includes('code') ? { codeLanguage } : {}),
          ...(focus.trim() ? { focus: focus.trim() } : {}),
          ...(brief ? { description: brief } : {}),
        },
        materials,
        { signal: controller.signal, onProgress: setProgress },
      );
      setResult(generated);
      setSelected(new Set(generated.deck.questions.map((question) => question.id)));
      // Materials are only an input to this one generation. Keeping extracted
      // text on the device after the questions exist is unnecessary retention.
      await actions.clearMaterials();
    } catch (caught) {
      if (caught instanceof AiError && caught.code === 'cancelled') {
        actions.notify('info', t('gen.cancelled'));
      } else {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      setBusy(false);
      setProgress(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const save = async () => {
    if (!result) return;
    const questions = result.deck.questions.filter((question) => selected.has(question.id));
    if (questions.length === 0) return;
    const id = await actions.saveGeneratedDeck({
      ...result.deck,
      questions,
      examMinutes: examMinutesForQuestions(questions),
    });
    if (id) navigate('/library');
  };

  const copySkill = async () => {
    try {
      await navigator.clipboard.writeText(QUESTION_SKILL);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      actions.notify('error', t('gen.copyFailed'));
    }
  };

  const toggleQuestion = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = !!result && selected.size === result.deck.questions.length;

  return (
    <div className="page">
      <PageHead
        title={t('gen.title')}
        lede={t('gen.subtitle')}
        actions={
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setSkillOpen(true)}>
            <Icon name="sparkles" size={13} strokeWidth={1.7} />
            {t('gen.viewSkill')}
          </button>
        }
      />

      {!auth.user ? (
        <section className="panel gen-config">
          <div className="panel__head">
            <h2 className="panel__title">{t('gen.signInTitle')}</h2>
          </div>
          <Note>{t('gen.signInBody')}</Note>
          <div className="actions-row">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/login?next=/generate')}>
              {t('auth.signIn')}
            </button>
            <span className="footnote">{t('gen.guestKeepsProgress')}</span>
          </div>
        </section>
      ) : (
        <>
      {!configured ? (
        <section className="panel gen-config">
          <div className="panel__head">
            <h2 className="panel__title">{t('gen.noConfigTitle')}</h2>
            <span className="panel__more">v{QUESTION_SKILL_VERSION}</span>
          </div>
          <Note tone="warn">{t('gen.noConfigBody')}</Note>
          <div className="actions-row">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/settings')}>
              {t('gen.openSettings')}
            </button>
          </div>
        </section>
      ) : null}

      <div className="gen-grid">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('gen.request')}</h2>
            <span className="panel__more">skill v{QUESTION_SKILL_VERSION}</span>
          </div>

          <label className="field">
            <span className="field__label">{t('gen.topic')}</span>
            <input
              type="text"
              value={topic}
              placeholder={t('gen.topicPlaceholder')}
              onChange={(event) => setTopic(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">{t('gen.description')}</span>
            <textarea
              rows={4}
              value={description}
              placeholder={t('gen.descriptionPlaceholder')}
              onChange={(event) => setDescription(event.target.value)}
            />
            <span className="field__hint">{t('gen.descriptionHint')}</span>
          </label>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('gen.count')}</span>
            </div>
            <NumField label={t('gen.count')} value={count} min={1} max={30} step={1} onChange={setCount} />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('gen.difficulty')}</span>
            </div>
            <Seg
              value={difficulty}
              onChange={setDifficulty}
              label={t('gen.difficulty')}
              options={[
                { value: 'mixed', label: t('gen.difficultyMixed') },
                { value: 'easy', label: t('gen.difficultyEasy') },
                { value: 'hard', label: t('gen.difficultyHard') },
              ]}
            />
          </div>

          <div className="setting">
            <div className="setting__text">
              <span className="setting__label">{t('gen.language')}</span>
            </div>
            <Seg
              value={language}
              onChange={setLanguage}
              label={t('gen.language')}
              options={[
                { value: 'auto', label: t('gen.langAuto') },
                { value: 'en', label: t('gen.langEn') },
                { value: 'zh-Hant', label: t('gen.langZh') },
              ]}
            />
          </div>

          <div className="field">
            <span className="field__label">{t('gen.types')}</span>
            <span className="field__hint">{t('gen.typesHint')}</span>
            <div className="type-picker" role="group" aria-label={t('gen.types')}>
              {ALL_GENERATED_TYPES.map((type) => {
                const active = types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    className={`type-chip ${active ? 'is-on' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleType(type)}
                  >
                    {active ? <Icon name="check" size={10} strokeWidth={2.4} /> : null}
                    {questionTypeLabel(type, t)}
                  </button>
                );
              })}
            </div>
            <span className="field__hint">{t('gen.typesCodeHint')}</span>
          </div>

          {types.includes('code') ? (
            <div className="setting">
              <div className="setting__text">
                <span className="setting__label">{t('gen.codeLanguage')}</span>
                <span className="setting__hint">{t('gen.codeLanguageHint')}</span>
              </div>
              <Seg
                value={codeLanguage}
                onChange={setCodeLanguage}
                label={t('gen.codeLanguage')}
                wrap
                options={CODE_LANGUAGES.map((value) => ({
                  value,
                  label: codeLanguageInfo(value).label,
                }))}
              />
            </div>
          ) : null}

          <label className="field">
            <span className="field__label">{t('gen.focus')}</span>
            <input
              type="text"
              value={focus}
              placeholder={t('gen.focusPlaceholder')}
              onChange={(event) => setFocus(event.target.value)}
            />
          </label>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">{t('gen.materials')}</h2>
            <span className="panel__more">
              {formatBytes(usedBytes)} / {formatBytes(MAX_MATERIAL_BYTES)}
            </span>
          </div>
          <p className="footnote">{t('gen.materialsHint', { limit: formatBytes(MAX_MATERIAL_BYTES) })}</p>
          <p className="footnote">{t('gen.materialsPrivacy')}</p>

          <button
            type="button"
            className={`dropzone ${dragging ? 'is-over' : ''}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void addFiles(event.dataTransfer.files);
            }}
          >
            <Icon name="upload" size={17} strokeWidth={1.6} />
            <span>{ingesting ? t('gen.ingesting', { name: ingesting }) : t('gen.drop')}</span>
            <span className="dropzone__hint">{t('gen.addFiles')}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS.join(',')}
            hidden
            onChange={(event) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              event.target.value = '';
              void addFiles(files);
            }}
          />

          <Meter value={usedBytes / MAX_MATERIAL_BYTES} accent={usedBytes > 0} />
          <p className="footnote">
            {t('gen.budget', {
              used: formatBytes(usedBytes),
              limit: formatBytes(MAX_MATERIAL_BYTES),
              chars: totalMaterialChars(materials).toLocaleString(locale),
            })}
          </p>

          {materials.length === 0 ? (
            <p className="footnote">
              {description.trim() ? t('gen.descriptionOnly') : t('gen.emptyMaterials')}
            </p>
          ) : (
            <div className="material-list">
              {materials.map((material) => (
                <div className="material" key={material.id}>
                  <div className="material__main">
                    <span className="material__name">{material.name}</span>
                    <span className="material__meta">
                      {formatBytes(material.size)} · {material.chars.toLocaleString(locale)}{' '}
                      {t('gen.chars')}
                      {material.truncated ? ` · ${t('gen.truncated')}` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('gen.removeMaterial')}
                    onClick={() => void actions.removeMaterial(material.id)}
                  >
                    <Icon name="trash" size={13} strokeWidth={1.6} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Note tone="warn">{t('gen.contentPolicy')}</Note>

      <div className="gen-actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void generate()}
          disabled={busy || !configured}
        >
          <Icon name="sparkles" size={14} strokeWidth={1.7} />
          {busy ? t('gen.generating') : t('gen.generate')}
        </button>
        {busy ? (
          <button type="button" className="btn btn--quiet" onClick={() => abortRef.current?.abort()}>
            {t('gen.cancel')}
          </button>
        ) : null}
        {progress || error ? (
          <div className="gen-status" aria-live="polite">
            {error ? <Note tone="warn">{error}</Note> : progress ? <span>{progressLabel(progress, t)}</span> : null}
            {progress && progress.batches > 0 ? (
              <Meter value={progress.batch / progress.batches} accent />
            ) : null}
          </div>
        ) : null}
      </div>

      {result ? (
        <section className="panel gen-preview">
          <div className="panel__head">
            <h2 className="panel__title">{t('gen.preview')}</h2>
            <span className="panel__more">{t('gen.selected', { n: selectedCount })}</span>
          </div>
          <p className="footnote">{t('gen.previewHint', { n: result.deck.questions.length })}</p>
          <p className="footnote">
            {t('gen.examTime', {
              n: examMinutesForQuestions(
                result.deck.questions.filter((question) => selected.has(question.id)),
              ),
            })}
          </p>

          {result.warnings.length > 0 ? (
            <div className="gen-warnings">
              <span className="eyebrow">{t('gen.warnings')}</span>
              <ul>
                {result.warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warning.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="footnote">
            {t('gen.usage', {
              tokens: result.usage.totalTokens || result.usage.promptTokens + result.usage.completionTokens,
              model: config.model,
            })}
          </p>

          <div className="actions-row">
            <button
              type="button"
              className="btn btn--sm"
              onClick={() =>
                setSelected(allSelected ? new Set() : new Set(result.deck.questions.map((q) => q.id)))
              }
            >
              {allSelected ? t('common.none') : t('gen.selectAll')}
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => void save()}
              disabled={selectedCount === 0}
            >
              {t('gen.save')}
            </button>
            {!auth.user ? <span className="footnote">{t('gen.saveNeedsLogin')}</span> : null}
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setResult(null)}>
              {t('gen.discard')}
            </button>
          </div>

          <ul className="gen-list">
            {result.deck.questions.map((question, index) => {
              const correct = correctOptionIds(question);
              const spec = codeSpecOf(question);
              return (
                <li className={`gen-q ${selected.has(question.id) ? 'is-on' : ''}`} key={question.id}>
                  <label className="gen-q__head">
                    <input
                      type="checkbox"
                      checked={selected.has(question.id)}
                      onChange={() => toggleQuestion(question.id)}
                    />
                    <span className="gen-q__index">{index + 1}</span>
                    <span className="gen-q__prompt">{question.prompt}</span>
                    <span className="gen-q__meta">
                      {questionTypeLabel(question.type, t)} · {question.difficulty}
                    </span>
                  </label>
                  <details className="gen-q__details">
                    <summary>{t('gen.details')}</summary>
                    {question.options?.length ? (
                      <ul className="gen-q__options">
                        {question.options.map((option) => (
                          <li key={option.id} className={correct.has(option.id) ? 'is-correct' : ''}>
                            <span className="gen-q__letter">{option.id}</span>
                            {option.text}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p className="gen-q__answer">
                      <span className="eyebrow">{t('gen.answer')}</span> {describeAnswer(question)}
                    </p>
                    {question.explanation ? <p className="explain">{question.explanation}</p> : null}
                    {spec ? (
                      <>
                        <span className="eyebrow">{t('gen.template')}</span>
                        <pre className="code-block">{spec.template}</pre>
                        <span className="eyebrow">{t('gen.tests')}</span>
                        <ul className="gen-q__tests">
                          {spec.tests.map((test, testIndex) => (
                            <li key={`${test.name ?? 'test'}-${testIndex}`}>
                              {test.name ?? `Test ${testIndex + 1}`} → <code>{test.expect}</code>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Sheet
        open={skillOpen}
        wide
        title={t('gen.viewSkill')}
        onClose={() => setSkillOpen(false)}
        footer={
          <>
            <span className="sheet__hint">{t('gen.skillHint', { version: QUESTION_SKILL_VERSION })}</span>
            <button type="button" className="btn btn--sm" onClick={() => void copySkill()}>
              {copied ? t('gen.copied') : t('gen.copy')}
            </button>
          </>
        }
      >
        <pre className="code-block skill-text">{QUESTION_SKILL}</pre>
      </Sheet>
        </>
      )}
    </div>
  );
}
