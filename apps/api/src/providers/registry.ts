/**
 * Text-provider catalogue.
 *
 * Adding a provider is a small, local change: add a spec, a key variable and
 * the official OpenAI-compatible base URL. The browser asks `/config` for the
 * resulting list, so no model name is hard-coded in the app.
 */
import type { AiProviderInfo } from '@mengyin/ai-contract';
import { SUPPORTED_MODELS } from '@mengyin/core';
import type { Env } from '../env';
import { ApiError, badRequest, unconfigured } from '../errors';

export interface ProviderSpec {
  id: string;
  label: string;
  keyVar: keyof Env;
  modelVar: keyof Env;
  modelsVar: keyof Env;
  baseUrlVar: keyof Env;
  defaultBaseUrl: string;
  fallbackModels: string[];
  thinkingVar?: keyof Env;
  reasoningEffortVar?: keyof Env;
  /** Completion budget when AI_MAX_TOKENS is unset (0). */
  defaultOutputTokens: number;
  /** The provider's documented maximum completion size. */
  maxOutputTokens: number;
  /** The provider's documented model list, shown in docs, not in responses. */
  docsUrl: string;
}

export const PROVIDER_SPECS: readonly ProviderSpec[] = [
  // GLM (Zhipu) is not offered while the catalogue has no commercially usable
  // GLM model: its non-paid models are restricted to non-commercial personal
  // use. Re-add the spec with a paid model to bring the provider back.
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keyVar: 'DEEPSEEK_API_KEY',
    modelVar: 'DEEPSEEK_MODEL',
    modelsVar: 'DEEPSEEK_MODELS',
    baseUrlVar: 'DEEPSEEK_BASE_URL',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    fallbackModels: ['deepseek-flash', 'deepseek-v4-pro'],
    thinkingVar: 'DEEPSEEK_THINKING',
    reasoningEffortVar: 'DEEPSEEK_REASONING_EFFORT',
    // Six detailed questions can exceed an 8K completion. DeepSeek supports
    // 64K, so default to a 32K budget and leave the rest unused unless needed.
    defaultOutputTokens: 32_768,
    maxOutputTokens: 65_536,
    docsUrl: 'https://api-docs.deepseek.com/',
  },
];

export const DEMO_PROVIDER_ID = 'demo';

export interface ResolvedProvider {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
  thinking?: 'enabled' | 'disabled';
  reasoningEffort?: 'low' | 'high' | 'max';
  demo: boolean;
}

function envString(env: Env, key: keyof Env): string {
  const value = env[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberIn(value: string, fallback: number, min: number, max: number): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

/**
 * `AI_GENERATION=off` switches text generation off without deleting a key.
 *
 * The browser reads an empty provider list, so Generate shows its normal "no
 * provider configured" state instead of a broken form, and every generation
 * call fails before a provider is contacted. Images have their own switch
 * (`IMAGE_PROVIDER=none`, `IMAGE_SEARCH=off`).
 */
export function generationEnabled(env: Env): boolean {
  return envString(env, 'AI_GENERATION').toLowerCase() !== 'off';
}

/** The error every generation entry point raises while the switch is off. */
function generationOffError(): ApiError {
  return unconfigured(
    'AI question generation is switched off on this server (AI_GENERATION=off).',
  );
}

export function modelsFor(spec: ProviderSpec, env: Env): string[] {
  const listed = parseList(envString(env, spec.modelsVar));
  const preferred = envString(env, spec.modelVar);
  if (listed.length > 0) {
    return preferred && !listed.includes(preferred) ? [preferred, ...listed] : listed;
  }
  if (preferred) return [preferred, ...spec.fallbackModels.filter((model) => model !== preferred)];
  return [...spec.fallbackModels];
}

/**
 * The models this release actually sells: GLM-4.7, DeepSeek Flash and
 * DeepSeek V4 Pro. An environment list may still name older models, so the
 * catalogue filters to the supported set; if nothing in the list survives, the
 * provider's supported fallbacks are offered instead of an empty menu.
 */
export function catalogueModels(spec: ProviderSpec, env: Env): string[] {
  if (spec.id === DEMO_PROVIDER_ID) return ['demo'];
  const supported = new Set<string>(SUPPORTED_MODELS);
  const allowed = modelsFor(spec, env).filter((model) => supported.has(model));
  if (allowed.length > 0) return allowed;
  return spec.fallbackModels.filter((model) => supported.has(model));
}

export function defaultModelFor(spec: ProviderSpec, env: Env): string {
  const models = catalogueModels(spec, env);
  const preferred = envString(env, spec.modelVar);
  return (preferred && models.includes(preferred) ? preferred : models[0]) || spec.fallbackModels[0] || '';
}

function isConfigured(spec: ProviderSpec, env: Env): boolean {
  if (spec.id === DEMO_PROVIDER_ID) return envString(env, 'AI_MOCK') === '1';
  return envString(env, spec.keyVar).length > 0;
}

function thinkingFor(spec: ProviderSpec, env: Env, thinkingEnabledByDefault: boolean) {
  if (!spec.thinkingVar) return undefined;
  const raw = envString(env, spec.thinkingVar).toLowerCase();
  if (raw === 'auto') return undefined;
  if (raw === 'enabled' || raw === 'disabled') return raw;
  // DeepSeek turns thinking on by default. Question batches need the visible
  // answer, so a predictable non-thinking call is the better default.
  return thinkingEnabledByDefault ? 'disabled' : undefined;
}

function reasoningEffortFor(spec: ProviderSpec, env: Env) {
  if (!spec.reasoningEffortVar) return undefined;
  const raw = envString(env, spec.reasoningEffortVar).toLowerCase();
  if (raw === 'low' || raw === 'high' || raw === 'max') return raw;
  return 'high';
}

function demoInfo(env: Env): AiProviderInfo | null {
  if (envString(env, 'AI_MOCK') !== '1') return null;
  return {
    id: DEMO_PROVIDER_ID,
    label: 'Demo (no provider key)',
    models: ['demo'],
    configured: true,
    demo: true,
  };
}

export interface ProviderCatalog {
  providers: AiProviderInfo[];
}

/** True when this provider has a vision model for the photo check. */
function hasVision(env: Env, providerId: string): boolean {
  if ((env.AI_VERIFY_IMAGES ?? '').trim().toLowerCase() === 'off') return false;
  const value = providerId === 'deepseek' ? env.DEEPSEEK_VISION_MODEL : '';
  return Boolean((value ?? '').trim());
}

/** The browser-facing catalogue. It never contains a key or a base URL. */
export function providerCatalog(env: Env): ProviderCatalog {
  if (!generationEnabled(env)) return { providers: [] };
  const providers: AiProviderInfo[] = PROVIDER_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    models: catalogueModels(spec, env),
    configured: isConfigured(spec, env),
    demo: false,
    vision: hasVision(env, spec.id),
  }));
  const demo = demoInfo(env);
  if (demo) providers.push(demo);

  return { providers };
}

function findSpec(id: string): ProviderSpec | undefined {
  if (id === DEMO_PROVIDER_ID) {
    return {
      id: DEMO_PROVIDER_ID,
      label: 'Demo (no provider key)',
      keyVar: 'AI_MOCK',
      modelVar: 'DEEPSEEK_MODEL',
      modelsVar: 'DEEPSEEK_MODELS',
      baseUrlVar: 'DEEPSEEK_BASE_URL',
      defaultBaseUrl: 'demo://local',
      fallbackModels: ['demo'],
      defaultOutputTokens: 8_192,
      maxOutputTokens: 8_192,
      docsUrl: '',
    };
  }
  return PROVIDER_SPECS.find((spec) => spec.id === id);
}

export function resolveProvider(env: Env, requestedProvider?: string, requestedModel?: string): ResolvedProvider {
  if (!generationEnabled(env)) throw generationOffError();
  const providerId = (requestedProvider ?? '').trim();
  const modelId = (requestedModel ?? '').trim();
  const configured = PROVIDER_SPECS.filter((spec) => isConfigured(spec, env));
  const demoEnabled = envString(env, 'AI_MOCK') === '1';
  if (configured.length === 0 && !demoEnabled) {
    throw unconfigured(
      'No AI provider is configured on this server. Set GLM_API_KEY or DEEPSEEK_API_KEY, or enable AI_MOCK=1 for a demo.',
    );
  }

  let spec: ProviderSpec;
  if (providerId && providerId !== 'auto') {
    const found = findSpec(providerId);
    if (!found) throw badRequest(`Unknown provider "${providerId}".`);
    if (!isConfigured(found, env)) {
      throw unconfigured(`The "${found.label}" provider is not configured on this server.`);
    }
    spec = found;
  } else if (modelId) {
    const byModel = configured.find((candidate) => catalogueModels(candidate, env).includes(modelId));
    spec = byModel ?? configured[0] ?? findSpec(DEMO_PROVIDER_ID)!;
  } else {
    const preferred = envString(env, 'AI_DEFAULT_PROVIDER');
    spec =
      configured.find((candidate) => candidate.id === preferred) ??
      configured[0] ??
      findSpec(DEMO_PROVIDER_ID)!;
  }

  const models = catalogueModels(spec, env);
  const allowCustom = envString(env, 'AI_ALLOW_CUSTOM_MODELS') === '1';
  let model = modelId || (envString(env, 'AI_DEFAULT_MODEL') && models.includes(envString(env, 'AI_DEFAULT_MODEL'))
    ? envString(env, 'AI_DEFAULT_MODEL')
    : defaultModelFor(spec, env));
  if (spec.id === DEMO_PROVIDER_ID) model = 'demo';
  if (!model) model = models[0] ?? '';
  if (!allowCustom && !models.includes(model)) {
    throw badRequest(
      `Unknown model "${model}" for ${spec.label}. Available models: ${models.join(', ')}.`,
    );
  }

  return providerFrom(spec, env, model, models);
}

/**
 * Resolve a generation target from an explicit model id only.
 *
 * Generation has no server default and no provider default: the browser must
 * send the model the learner saw, and an unknown id is an error rather than a
 * silent fallback to a different (possibly more expensive) model.
 */
export function resolveProviderForModel(
  env: Env,
  requestedModel: string,
  options: { apiKey?: string; baseUrl?: string; contextTokens?: number } = {},
): ResolvedProvider {
  if (!generationEnabled(env)) throw generationOffError();
  const modelId = (requestedModel ?? '').trim();
  if (!modelId || modelId === 'auto') {
    throw badRequest('Choose a model for this generation.');
  }

  // A learner's own key replaces the server's for this request. It still has to
  // name a catalogue model, but the provider does not need a server key.
  const ownKey = (options.apiKey ?? '').trim();
  const ownBase = (options.baseUrl ?? '').trim();
  if (ownKey && ownBase) {
    // Any OpenAI-compatible endpoint: the learner's account, the learner's model
    // id. The URL was checked for https and a public host by the validator.
    const custom: ProviderSpec = {
      id: 'byo',
      label: 'Your provider',
      keyVar: 'DEEPSEEK_API_KEY',
      modelVar: 'DEEPSEEK_MODEL',
      modelsVar: 'DEEPSEEK_MODELS',
      baseUrlVar: 'DEEPSEEK_BASE_URL',
      defaultBaseUrl: ownBase,
      fallbackModels: [modelId],
      defaultOutputTokens: 32_768,
      maxOutputTokens: 65_536,
      docsUrl: '',
    };
    return {
      ...providerFrom(custom, env, modelId, [modelId]),
      id: 'byo',
      label: 'Your provider',
      baseUrl: ownBase,
      apiKey: ownKey,
      // Keep the completion budget inside the window the learner declared.
      ...(options.contextTokens && options.contextTokens > 0
        ? { maxTokens: Math.max(256, Math.min(32_768, Math.floor(options.contextTokens / 4))) }
        : {}),
    };
  }
  if (ownKey) {
    const spec = PROVIDER_SPECS.find((candidate) =>
      catalogueModels(candidate, env).includes(modelId),
    );
    if (!spec) {
      const available = PROVIDER_SPECS.flatMap((candidate) => catalogueModels(candidate, env));
      throw badRequest(
        `The model "${modelId}" is not available on this server. Available models: ${available.join(', ')}.`,
      );
    }
    return { ...providerFrom(spec, env, modelId, catalogueModels(spec, env)), apiKey: ownKey };
  }

  const configured = PROVIDER_SPECS.filter((spec) => isConfigured(spec, env));
  const demoEnabled = envString(env, 'AI_MOCK') === '1';
  if (configured.length === 0 && !demoEnabled) {
    throw unconfigured(
      'No AI provider is configured on this server. Set GLM_API_KEY or DEEPSEEK_API_KEY, or enable AI_MOCK=1 for a demo.',
    );
  }

  const match =
    configured.find((spec) => catalogueModels(spec, env).includes(modelId)) ??
    (demoEnabled && modelId === DEMO_PROVIDER_ID ? findSpec(DEMO_PROVIDER_ID) : undefined);
  if (!match) {
    const available = [
      ...configured.flatMap((spec) => catalogueModels(spec, env)),
      ...(demoEnabled ? [DEMO_PROVIDER_ID] : []),
    ];
    throw badRequest(
      `The model "${modelId}" is not available on this server. Available models: ${available.join(', ')}.`,
    );
  }

  return resolveProvider(env, match.id, match.id === DEMO_PROVIDER_ID ? 'demo' : modelId);
}

function providerFrom(
  spec: ProviderSpec,
  env: Env,
  model: string,
  models: string[],
): ResolvedProvider {
  const temperature = numberIn(envString(env, 'AI_TEMPERATURE'), 0.4, 0, 2);
  // 0 / unset means "auto": use the model family's generous default rather than
  // a single small number that truncates a multi-question batch. An explicit
  // AI_MAX_TOKENS is still honoured, up to the provider's documented ceiling.
  const requestedOutput = Math.round(numberIn(envString(env, 'AI_MAX_TOKENS'), 0, 0, 1_000_000));
  const maxTokens =
    requestedOutput > 0
      ? Math.max(256, Math.min(spec.maxOutputTokens, requestedOutput))
      : spec.defaultOutputTokens;
  // A reasoning model can legitimately spend minutes before its first token.
  // The provider call resets this window whenever a streamed chunk arrives, so
  // it is an inactivity limit rather than a hard cap on a productive run. An
  // explicit value can go up to ten minutes; the provider's own timeout still
  // applies.
  const timeoutMs = Math.round(numberIn(envString(env, 'AI_TIMEOUT_MS'), 300_000, 10_000, 600_000));
  const jsonMode = envString(env, 'AI_JSON_MODE') !== 'false';
  const thinking =
    spec.id === DEMO_PROVIDER_ID
      ? undefined
      : thinkingFor(spec, env, spec.id === 'deepseek');
  const reasoningEffort =
    thinking === 'enabled' ? reasoningEffortFor(spec, env) : undefined;

  return {
    id: spec.id,
    label: spec.label,
    baseUrl: envString(env, spec.baseUrlVar) || spec.defaultBaseUrl,
    apiKey: envString(env, spec.keyVar),
    model,
    models,
    temperature,
    maxTokens,
    timeoutMs,
    jsonMode,
    ...(thinking ? { thinking } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    demo: spec.id === DEMO_PROVIDER_ID,
  };
}

/** Throw an ApiError carrying the catalogue when a provider rejects a key. */
export function providerError(message: string): ApiError {
  return new ApiError(502, 'provider_error', message);
}
