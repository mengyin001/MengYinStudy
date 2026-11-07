import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiProgress, AiQuestionResult, AiServiceConfig } from '@mengyin/ai-contract';
import {
  CODE_LANGUAGES,
  codeLanguageInfo,
  codeSpecOf,
  estimatePoints,
  examMinutesForQuestions,
  planAllowsPhotos,
  planAllowsModel,
  pointsPerQuestion,
  questionsForPoints,
  type CodeLanguage,
  type Question,
} from '@mengyin/core';
import { AiApiError, generateQuestionsWithApi, getAiServiceConfig, testAiService } from '@/ai/api';
import { clearDraft, hydrateDraft, loadDraft, saveDraft } from '@/ai/draft';
import { ACCEPTED_EXTENSIONS } from '@/ai/extract';
import { mergeGeneratedResults } from '@/ai/merge';
import { MAX_MATERIAL_BYTES, totalMaterialBytes, totalMaterialChars } from '@/ai/materials';
import type { AiSettings, GeneratedDifficulty, GeneratedLanguage, GenerationRequest } from '@/ai/types';
import { ALL_GENERATED_TYPES, type GeneratedQuestionType } from '@/ai/types';
import { Icon } from '@/components/Icons';
import { ProviderIcon } from '@/components/ProviderIcon';
import { GenerationLiveness } from '@/components/GenerationLiveness';
import { QuestionImage } from '@/components/QuestionImage';
import { Meter, Note, NumField, PageHead, Seg } from '@/components/ui';
import { describeAnswer } from '@/domain/answers';
import { questionTypeLabel } from '@/domain/registry';
import { describeBackendError } from '@/i18n/backend';
import type { Translate } from '@/i18n/messages';
import { formatBytes } from '@/lib/format';
import { modelChoices, modelLabel } from '@/lib/models';
import { navigate } from '@/lib/router';
import { useApp } from '@/state/AppContext';
import { useAuth } from '@/state/AuthContext';
import { useBilling } from '@/state/BillingContext';
import { useCollections } from '@/state/CollectionsContext';

function progressLabel(progress: AiProgress, t: Translate): string {
  switch (progress.stage) {
    case 'requesting':
      return t('gen.started', { batch: progress.batch, batches: progress.batches });
    case 'repairing':
      return t('gen.repairing');
    case 'splitting':
      return t('gen.splitting');
    case 'validating':
      return t('gen.validating');
    case 'planning':
      return t('gen.planning', { n: progress.batches });
    case 'illustrating':
      return t('gen.illustrating', { done: progress.batch, total: progress.batches });
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

function pictureCount(result: AiQuestionResult): number {
  let count = 0;
  for (const question of result.deck.questions) {
    count += question.media?.filter((item) => item.type === 'image').length ?? 0;
    for (const option of question.options ?? []) {
      count += option.media?.filter((item) => item.type === 'image').length ?? 0;
    }
  }
  return count;
}

export function GeneratePage() {
  const { state, locale, t, actions } = useApp();
  const { state: auth } = useAuth();
  const { state: collectionsState, actions: collectionActions } = useCollections();
  const {
    config,
    plan,
    points,
    me,
    questionsLimit,
    questionsRemaining,
    enforced,
    refresh: refreshBilling,
  } = useBilling();
  const settings = state.aiSettings;
  const materials = state.materials;
  const usedBytes = totalMaterialBytes(materials);

  const [service, setService] = useState<AiServiceConfig | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
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
  const [saveCollection, setSaveCollection] = useState('');
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiQuestionResult | null>(() => loadDraft());
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(loadDraft()?.deck.questions.map((question) => question.id) ?? []),
  );
  const [draftHydrated, setDraftHydrated] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const slimDraftRef = useRef(false);
  const draftNoticeRef = useRef(false);
  const lastUserId = useRef<string | null>(auth.user?.id ?? null);

  const ready = !!service && service.providers.some((provider) => provider.configured);

  const loadService = useCallback(async () => {
    if (!auth.user) {
      setService(null);
      return;
    }
    setServiceLoading(true);
    setServiceError(null);
    try {
      setService(await getAiServiceConfig());
    } catch (caught) {
      setServiceError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setServiceLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    void loadService();
  }, [loadService]);

  // There is no per-run question cap. Only a free account is pulled down to the
  // questions it has left this month, because that is the wallet it spends.
  useEffect(() => {
    if (!enforced || plan.paid) return;
    const ceiling = Math.max(1, questionsRemaining ?? plan.monthlyQuestions);
    if (count > ceiling) setCount(ceiling);
  }, [count, enforced, plan.monthlyQuestions, plan.paid, questionsRemaining]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // The session copy paints immediately; IndexedDB restores the full-size
  // illustrations that the 5 MB tab quota would otherwise strip.
  useEffect(() => {
    let cancelled = false;
    void hydrateDraft()
      .then((draft) => {
        if (cancelled || !draft) return;
        setResult((current) => {
          if (!current) return draft;
          if (current.deck.id !== draft.deck.id) return current;
          return pictureCount(draft) > pictureCount(current) ? draft : current;
        });
        setSelected((current) =>
          current.size > 0 ? current : new Set(draft.deck.questions.map((question) => question.id)),
        );
      })
      .finally(() => {
        if (!cancelled) setDraftHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the generated draft for this tab. The full illustrated result lives
  // in memory and IndexedDB; the sessionStorage copy is only the fast fallback.
  useEffect(() => {
    if (!draftHydrated) return;
    if (!result) {
      clearDraft();
      return;
    }
    const outcome = saveDraft(result, slimDraftRef.current);
    if (outcome === 'stripped') {
      slimDraftRef.current = true;
      if (!draftNoticeRef.current) {
        draftNoticeRef.current = true;
        actions.notify('info', t('gen.draftImagesDropped'));
      }
    }
  }, [result, draftHydrated]);

  // A draft belongs to the signed-in learner. Drop it when the session ends so
  // the next account in this tab cannot see the previous one's questions.
  useEffect(() => {
    const nextId = auth.user?.id ?? null;
    const switched = Boolean(lastUserId.current && nextId && lastUserId.current !== nextId);
    if (lastUserId.current && (!nextId || switched)) {
      clearDraft();
      setResult(null);
      setSelected(new Set());
    }
    lastUserId.current = nextId;
  }, [auth.user]);

  const selectedCount = useMemo(() => selected.size, [selected]);

  const providers = service?.providers ?? [];
  const choices = useMemo(() => modelChoices(providers), [providers]);
  const configuredProviders = providers.filter((provider) => provider.configured);
  const imageModels = service?.images.models ?? [];
  const imagesAvailable = service?.images.available ?? false;
  // AI photos need a paid plan; rendered figures are free on every plan.
  const photosAllowed = !enforced || planAllowsPhotos(plan);
  const defaultImageModel =
    imageModels.find((model) => model.id === service?.images.model)?.label ??
    service?.images.model ??
    '';

  // One explicit model. There is no server default and no "provider default":
  // the id below is what the request sends and what the estimate prices.
  const effectiveModel = settings.model;
  const selectedChoice = choices.find((choice) => choice.model === effectiveModel);
  const modelConfigured = selectedChoice?.configured ?? false;
  const modelAllowed = !enforced || planAllowsModel(plan, effectiveModel);
  const materialChars = totalMaterialChars(materials);
  const estimate = estimatePoints({
    model: effectiveModel,
    count,
    materialChars,
  });
  const freeLeft = questionsRemaining ?? plan.monthlyQuestions;
  const remainingForModel = !enforced
    ? null
    : plan.paid
      ? questionsForPoints(points, effectiveModel)
      : freeLeft;
  const shortOfPoints = enforced && plan.paid && estimate.total > points;
  const shortOfQuestions = enforced && !plan.paid && count > freeLeft;

  // If a saved model disappeared or its provider lost its key, move to the
  // first usable model instead of leaving an unselectable ghost selected.
  useEffect(() => {
    if (!service) return;
    const current = choices.find((choice) => choice.model === settings.model);
    const usable = Boolean(
      current?.configured && (!enforced || planAllowsModel(plan, current.model)),
    );
    if (usable) return;
    const next =
      choices.find(
        (choice) => choice.configured && (!enforced || planAllowsModel(plan, choice.model)),
      ) ??
      choices.find((choice) => choice.configured) ??
      choices[0];
    if (next && next.model !== settings.model) {
      actions.updateAiSettings({ model: next.model });
    }
  }, [actions, choices, enforced, plan, service, settings.model]);

  const chooseModel = (model: string) => {
    setTestResult(null);
    actions.updateAiSettings({ model });
  };

  const chooseImageModel = (imageModel: string) => {
    setTestResult(null);
    actions.updateAiSettings({ imageModel });
  };

  const chooseImageMode = (imageMode: AiSettings['imageMode']) => {
    setTestResult(null);
    actions.updateAiSettings({ imageMode });
  };

  const testEngine = async () => {
    if (!auth.user) {
      actions.notify('info', t('gen.engineSignIn'));
      navigate('/login?next=/generate');
      return;
    }
    if (!ready) {
      actions.notify('info', t('gen.serviceNotReady'));
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testAiService(settings);
      setTestResult({ ok: true, message: t('gen.testOk', { model: result.model }) });
    } catch (caught) {
      setTestResult({
        ok: false,
        message: t('gen.testFail', {
          message: caught instanceof Error ? caught.message : String(caught),
        }),
      });
    } finally {
      setTesting(false);
    }
  };

  const toggleType = (type: GeneratedQuestionType) => {
    if (busy) return;
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
    // The request is already in flight; changing its material mid-run would
    // only desynchronise what the user sees from what the AI was given.
    if (busy || !files || files.length === 0) return;
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
    if (!ready) {
      actions.notify('info', t('gen.serviceNotReady'));
      return;
    }
    if (!effectiveModel || !modelConfigured) {
      actions.notify('info', t('gen.noModel'));
      return;
    }
    if (enforced && !modelAllowed) {
      actions.notify('info', t('gen.upgradeHint'));
      return;
    }
    if (enforced && (shortOfPoints || shortOfQuestions)) {
      actions.notify('info', t('gen.quotaShort'));
      return;
    }
    const brief = description.trim();
    const firstLine = brief.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    const resolvedTopic = topic.trim() || firstLine.slice(0, 80) || '';
    if (!resolvedTopic) {
      actions.notify('info', t('gen.needTopic'));
      return;
    }
    const appending = Boolean(result && result.deck.questions.length > 0);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    startedAt.current = Date.now();
    if (!appending) {
      setResult(null);
      setSelected(new Set());
    }
    setProgress({ stage: 'preparing', batch: 0, batches: 0, message: '' });

    const request: GenerationRequest = {
      topic: resolvedTopic,
      count,
      difficulty,
      language,
      types,
      ...(types.includes('code') ? { codeLanguage } : {}),
      ...(focus.trim() ? { focus: focus.trim() } : {}),
      ...(brief ? { description: brief } : {}),
    };

    try {
      const generated = await generateQuestionsWithApi(request, materials, settings, {
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (appending && result) {
        const merged = mergeGeneratedResults(result, generated);
        const added = merged.deck.questions.length - result.deck.questions.length;
        setResult(merged);
        setSelected(new Set(merged.deck.questions.map((question) => question.id)));
        actions.notify(
          added > 0 ? 'success' : 'info',
          added > 0 ? t('gen.addedToDraft', { n: added }) : t('gen.noNewQuestions'),
        );
      } else {
        setResult(generated);
        setSelected(new Set(generated.deck.questions.map((question) => question.id)));
      }
      // Materials are only an input to this one generation. Keeping extracted
      // text on the device after the questions exist is unnecessary retention.
      await actions.clearMaterials();
    } catch (caught) {
      if (
        (caught instanceof AiApiError && caught.code === 'cancelled') ||
        (caught instanceof DOMException && caught.name === 'AbortError')
      ) {
        actions.notify('info', t('gen.cancelled'));
      } else {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      // The server settles the charge before returning. Wait for the refreshed
      // snapshot before re-enabling the form, so the sidebar and the Account
      // page show the deducted balance immediately instead of the pre-run one.
      await refreshBilling().catch(() => undefined);
      setBusy(false);
      setProgress(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const save = async () => {
    if (!result || busy) return;
    const questions = result.deck.questions
      .filter((question) => selected.has(question.id))
      .map((question, index) => ({ ...question, id: `q${index + 1}` }));
    if (questions.length === 0) return;
    const deckKey = result.deck.key;
    const target =
      saveCollection
        ? collectionsState.collections.find((collection) => collection.id === saveCollection) ?? null
        : null;
    const id = await actions.saveGeneratedDeck({
      ...result.deck,
      questions,
      examMinutes: examMinutesForQuestions(questions),
    });
    if (!id) return;

    let destination = '/library';
    if (target) {
      const added = await collectionActions.addDecks(target.id, [deckKey]);
      if (added.ok) {
        actions.notify('success', t('collections.addedToCollection', { name: target.name }));
        destination = `/collections/${encodeURIComponent(target.id)}`;
      } else {
        actions.notify('error', describeBackendError(added.error, t));
      }
    }
    clearDraft();
    setResult(null);
    setSelected(new Set());
    setSaveCollection('');
    navigate(destination);
  };

  const removeQuestion = (id: string) => {
    if (!result || busy) return;
    const questions = result.deck.questions.filter((question) => question.id !== id);
    if (questions.length === 0) {
      clearDraft();
      setResult(null);
      setSelected(new Set());
      return;
    }
    setResult({
      ...result,
      deck: {
        ...result.deck,
        questions,
        examMinutes: examMinutesForQuestions(questions),
      },
    });
    setSelected((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const deleteAll = () => {
    clearDraft();
    setResult(null);
    setSelected(new Set());
    setError(null);
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
  const partialWarnings =
    result?.warnings.filter((warning) => warning.code === 'partial' || warning.code === 'shortfall') ?? [];
  const otherWarnings =
    result?.warnings.filter((warning) => warning.code !== 'partial' && warning.code !== 'shortfall') ?? [];

  return (
    <div className="page">
      <PageHead title={t('gen.title')} lede={t('gen.subtitle')} />

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
          {serviceLoading ? (
            <Note>{t('gen.serviceChecking')}</Note>
          ) : serviceError ? (
            <section className="panel gen-config">
              <div className="panel__head">
                <h2 className="panel__title">{t('gen.serviceErrorTitle')}</h2>
              </div>
              <Note tone="warn">{t('gen.serviceError', { message: serviceError })}</Note>
              <div className="actions-row">
                <button type="button" className="btn btn--sm" onClick={() => void loadService()}>
                  <Icon name="rotate" size={13} strokeWidth={1.6} />
                  {t('gen.retry')}
                </button>
              </div>
            </section>
          ) : null}

          {service ? (
            <section className="panel gen-engine">
              <div className="panel__head">
                <h2 className="panel__title">{t('gen.engine')}</h2>
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  onClick={() => void loadService()}
                  disabled={serviceLoading || busy}
                >
                  <Icon name="rotate" size={13} strokeWidth={1.6} />
                  {serviceLoading ? t('gen.checking') : t('gen.refresh')}
                </button>
              </div>
              <p className="footnote">{t('gen.engineHint')}</p>

              <div className="gen-billing">
                <span className="badge">{t(`plan.${plan.id}`)}</span>
                {enforced ? (
                  plan.paid ? (
                    <span>{t('gen.balance', { n: points })}</span>
                  ) : (
                    <span>
                      {t('gen.freeRemaining', {
                        n: freeLeft,
                        limit: questionsLimit || plan.monthlyQuestions,
                      })}
                    </span>
                  )
                ) : null}
                {enforced ? (
                  plan.paid ? (
                    remainingForModel === null ? (
                      <span>{t('gen.remainingUnlimited')}</span>
                    ) : (
                      <span>{t('gen.remaining', { n: remainingForModel })}</span>
                    )
                  ) : null
                ) : null}
                <span className="gen-billing__cost">
                  {estimate.total > 0 ? t('gen.estimate', { n: estimate.total }) : t('gen.freeRun')}
                </span>
                <button type="button" className="text-btn" onClick={() => navigate('/pricing')}>
                  {t('gen.upgrade')}
                </button>
              </div>

              {enforced && me && !me.membershipActive ? (
                <Note tone="warn">{t('gen.membershipInactive')}</Note>
              ) : null}

              {enforced && !modelAllowed ? <Note tone="warn">{t('gen.upgradeHint')}</Note> : null}

              {configuredProviders.length === 0 ? (
                <Note tone="warn">{t('gen.noConfigBody')}</Note>
              ) : null}

              <div className="ai-form">
                <div className="field model-field">
                  <span className="field__label">{t('gen.model')}</span>
                  <span className="field__hint">{t('gen.modelHint')}</span>
                  <div className="model-picker" role="radiogroup" aria-label={t('gen.model')}>
                    {choices.map((choice) => {
                      const allowed = !enforced || planAllowsModel(plan, choice.model);
                      const selected = effectiveModel === choice.model;
                      const multiplier =
                        config?.pointCosts[choice.model] ?? pointsPerQuestion(choice.model);
                      const note = !choice.configured
                        ? t('gen.notConfigured')
                        : !allowed
                          ? t('gen.lockedModel')
                          : '';
                      return (
                        <button
                          key={choice.model}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`model-option ${selected ? 'is-on' : ''}`}
                          disabled={busy || !allowed || !choice.configured}
                          onClick={() => chooseModel(choice.model)}
                        >
                          <ProviderIcon provider={choice.providerId} size={22} />
                          <span className="model-option__body">
                            <span className="model-option__name">{modelLabel(choice.model)}</span>
                            <span className="model-option__meta">
                              {choice.providerLabel}
                              {note ? ` · ${note}` : ''}
                            </span>
                          </span>
                          <span className="model-option__mult">
                            {multiplier <= 0 ? t('gen.modelFree') : `×${multiplier}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {!effectiveModel || !modelConfigured ? (
                    <span className="field__hint">{t('gen.noModel')}</span>
                  ) : null}
                </div>

                <label className="field">
                  <span className="field__label">{t('gen.imageModel')}</span>
                  <select
                    value={settings.imageModel}
                    disabled={!imagesAvailable || !photosAllowed || imageModels.length === 0 || busy}
                    onChange={(event) => chooseImageModel(event.target.value)}
                  >
                    <option value="auto">{t('gen.imageModelAuto')}</option>
                    {imageModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                    {settings.imageModel !== 'auto' &&
                    !imageModels.some((model) => model.id === settings.imageModel) ? (
                      <option value={settings.imageModel}>{settings.imageModel}</option>
                    ) : null}
                  </select>
                  <span className="field__hint">
                    {!photosAllowed
                      ? t('gen.imagesNeedPlan')
                      : imagesAvailable && defaultImageModel
                        ? t('gen.imageModelHint', { model: defaultImageModel })
                        : t('gen.imagesUnavailable')}
                  </span>
                </label>

                <div className="setting">
                  <div className="setting__text">
                    <span className="setting__label">{t('gen.images')}</span>
                    <span className="setting__hint">
                      {!photosAllowed
                        ? t('gen.imagesNeedPlan')
                        : imagesAvailable
                          ? t('gen.imagesShort')
                          : t('gen.imagesUnavailable')}
                    </span>
                  </div>
                  <Seg
                    value={settings.imageMode}
                    onChange={chooseImageMode}
                    label={t('gen.images')}
                    disabled={busy}
                    options={[
                      { value: 'off', label: t('gen.imagesOff') },
                      { value: 'auto', label: t('gen.imagesAuto') },
                      { value: 'on', label: t('gen.imagesOn') },
                    ]}
                  />
                </div>
              </div>

              {!busy ? (
                <p className="footnote gen-images-note">
                  {photosAllowed ? t('gen.imagesHint') : t('gen.figuresOnlyHint')}
                </p>
              ) : null}

              <div className="actions-row">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => void testEngine()}
                  disabled={testing || !ready || !modelConfigured || busy}
                >
                  <Icon name="rotate" size={13} strokeWidth={1.6} />
                  {testing ? t('gen.testing') : t('gen.test')}
                </button>
                {testResult ? (
                  <span className={`badge ${testResult.ok ? 'badge--ok' : 'badge--bad'}`}>
                    {testResult.message}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}

          <div className="gen-grid">
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">{t('gen.request')}</h2>
              </div>
              {busy ? <Note>{t('gen.locked')}</Note> : null}

              <label className="field">
                <span className="field__label">{t('gen.topic')}</span>
                <input
                  type="text"
                  value={topic}
                  placeholder={t('gen.topicPlaceholder')}
                  disabled={busy}
                  onChange={(event) => setTopic(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field__label">{t('gen.description')}</span>
                <textarea
                  rows={4}
                  value={description}
                  placeholder={t('gen.descriptionPlaceholder')}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <span className="field__hint">{t('gen.descriptionHint')}</span>
              </label>

              <div className="setting">
                <div className="setting__text">
                  <span className="setting__label">{t('gen.count')}</span>
                </div>
                <NumField
                  label={t('gen.count')}
                  value={count}
                  min={1}
                  {...(enforced && !plan.paid ? { max: Math.max(1, freeLeft) } : {})}
                  step={1}
                  disabled={busy}
                  onChange={setCount}
                />
              </div>

              <div className="setting">
                <div className="setting__text">
                  <span className="setting__label">{t('gen.difficulty')}</span>
                </div>
                <Seg
                  value={difficulty}
                  onChange={setDifficulty}
                  label={t('gen.difficulty')}
                  disabled={busy}
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
                  disabled={busy}
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
                        disabled={busy}
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
                    disabled={busy}
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
                  disabled={busy}
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
                className={`dropzone ${dragging && !busy ? 'is-over' : ''}`}
                disabled={busy}
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
                disabled={busy}
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
                        disabled={busy}
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
              disabled={
                busy ||
                !ready ||
                !modelConfigured ||
                (enforced && (!modelAllowed || shortOfPoints || shortOfQuestions))
              }
            >
              <Icon name="sparkles" size={14} strokeWidth={1.7} />
              {busy ? t('gen.generating') : result ? t('gen.generateMore') : t('gen.generate')}
            </button>
            {busy ? (
              <button type="button" className="btn btn--quiet" onClick={() => abortRef.current?.abort()}>
                {t('gen.cancel')}
              </button>
            ) : null}
            {shortOfQuestions ? (
              <Note tone="warn">
                {t('gen.freeQuotaShort', { n: freeLeft })}{' '}
                <button type="button" className="text-btn" onClick={() => navigate('/pricing')}>
                  {t('gen.upgrade')}
                </button>
              </Note>
            ) : shortOfPoints ? (
              <Note tone="warn">
                {t('gen.notEnough', { n: estimate.total })}{' '}
                <button type="button" className="text-btn" onClick={() => navigate('/pricing')}>
                  {t('gen.upgrade')}
                </button>
              </Note>
            ) : null}
            {progress || error ? (
              <div className="gen-status" aria-live="polite">
                {error ? <Note tone="warn">{error}</Note> : progress ? <span>{progressLabel(progress, t)}</span> : null}
                {error && enforced ? (
                  <button type="button" className="text-btn" onClick={() => navigate('/pricing')}>
                    {t('gen.upgrade')}
                  </button>
                ) : null}
                {!error && busy ? (
                  <GenerationLiveness startedAt={startedAt.current} t={t} />
                ) : null}
                {progress && progress.batches > 0 ? (
                  <Meter value={progress.batch / progress.batches} accent />
                ) : null}
              </div>
            ) : null}
          </div>

          {result ? (
            <section className="panel gen-preview">
              <div className="panel__head">
                <div className="gen-preview__head">
                  <h2 className="panel__title">{t('gen.preview')}</h2>
                  <span className="badge badge--warn">{t('gen.aiBadge')}</span>
                </div>
                <span className="panel__more">{t('gen.selected', { n: selectedCount })}</span>
              </div>
              <p className="footnote">{t('gen.previewHint', { n: result.deck.questions.length })}</p>
              <p className="footnote gen-ai-notice">{t('gen.aiNotice')}</p>
              <p className="footnote">{t('gen.appendHint')}</p>
              <p className="footnote">
                {t('gen.examTime', {
                  n: examMinutesForQuestions(
                    result.deck.questions.filter((question) => selected.has(question.id)),
                  ),
                })}
              </p>

              {partialWarnings.length > 0 ? (
                <Note tone="warn">
                  <strong>{t('gen.partialTitle')}</strong>{' '}
                  {partialWarnings.map((warning) => warning.message).join(' ')}
                </Note>
              ) : null}

              {otherWarnings.length > 0 ? (
                <div className="gen-warnings">
                  <span className="eyebrow">{t('gen.warnings')}</span>
                  <ul>
                    {otherWarnings.map((warning, index) => (
                      <li key={`${warning.code}-${index}`}>{warning.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="footnote">
                {t('gen.usage', {
                  tokens:
                    result.usage.totalTokens ||
                    result.usage.promptTokens + result.usage.completionTokens,
                  model: `${result.engine.providerLabel} · ${result.engine.model}`,
                })}
                {result.images.requested > 0 || (result.images.diagrams ?? 0) > 0
                  ? ` · ${t('gen.imageStats', {
                      diagrams: result.images.diagrams ?? 0,
                      generated: result.images.generated,
                      requested: result.images.requested,
                    })}`
                  : ''}
              </p>

              {auth.user && collectionsState.collections.length > 0 ? (
                <label className="gen-collection">
                  <span className="gen-collection__label">{t('gen.collection')}</span>
                  <select
                    value={saveCollection}
                    disabled={busy}
                    onChange={(event) => setSaveCollection(event.target.value)}
                  >
                    <option value="">{t('gen.noCollection')}</option>
                    {collectionsState.collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                  <span className="field__hint">{t('gen.collectionHint')}</span>
                </label>
              ) : null}

              <div className="actions-row">
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy}
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
                  disabled={selectedCount === 0 || busy}
                >
                  {t('gen.save')}
                </button>
                {!auth.user ? <span className="footnote">{t('gen.saveNeedsLogin')}</span> : null}
                <button type="button" className="btn btn--quiet btn--sm" onClick={deleteAll} disabled={busy}>
                  {t('gen.deleteAll')}
                </button>
              </div>

              <ul className="gen-list">
                {result.deck.questions.map((question, index) => {
                  const correct = correctOptionIds(question);
                  const spec = codeSpecOf(question);
                  return (
                    <li className={`gen-q ${selected.has(question.id) ? 'is-on' : ''}`} key={question.id}>
                      <div className="gen-q__head">
                        <label className="gen-q__label">
                          <input
                            type="checkbox"
                            checked={selected.has(question.id)}
                            disabled={busy}
                            onChange={() => toggleQuestion(question.id)}
                          />
                          <span className="gen-q__index">{index + 1}</span>
                          <span className="gen-q__prompt">{question.prompt}</span>
                          <span className="gen-q__meta">
                            {questionTypeLabel(question.type, t)} · {question.difficulty}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="icon-btn gen-q__remove"
                          aria-label={t('gen.removeQuestion')}
                          title={t('gen.removeQuestion')}
                          onClick={() => removeQuestion(question.id)}
                          disabled={busy}
                        >
                          <Icon name="trash" size={14} strokeWidth={1.7} />
                        </button>
                      </div>
                      {question.media?.length ? (
                        <div className="gen-q__media">
                          {question.media.map((media, mediaIndex) => (
                            <QuestionImage
                              key={`${question.id}-${mediaIndex}`}
                              media={media}
                              loading="lazy"
                            />
                          ))}
                        </div>
                      ) : null}
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
        </>
      )}
    </div>
  );
}
