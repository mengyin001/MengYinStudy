import { SUPPORTED_MODELS } from '@mengyin/core';
import { AI_API_BASE, type AiImageMode } from '@mengyin/ai-contract';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import { AI_OWN_MODEL, type AiSettings } from './types';

export const AI_AUTO = 'auto';

/** Nothing is chosen until the learner picks a model in Generate. */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: '',
  imageMode: 'auto',
  imageModel: AI_AUTO,
};

function imageMode(value: unknown): AiImageMode {
  return value === 'off' || value === 'on' || value === 'auto' ? value : 'auto';
}

function modelId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed === AI_OWN_MODEL) return AI_OWN_MODEL;
  return (SUPPORTED_MODELS as readonly string[]).includes(trimmed) ? trimmed : '';
}

function contextTokens(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1_024 || parsed > 2_000_000) return undefined;
  return parsed;
}

/**
 * Accept the current settings object, the optional own-key field and the
 * pre-0.6.1 BYO shape.
 *
 * `apiKey` is the learner's own provider key, stored only in this browser and
 * sent per request; it is never written to the server. A legacy `baseUrl` or
 * `provider` field is dropped because generation names the model directly.
 */
export function normalizeAiSettings(input: unknown): AiSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_AI_SETTINGS };
  const raw = input as Record<string, unknown>;
  const rawImageModel = typeof raw.imageModel === 'string' ? raw.imageModel.trim() : '';
  const rawApiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim().slice(0, 200) : '';
  const rawBase = typeof raw.apiBaseUrl === 'string' ? raw.apiBaseUrl.trim().slice(0, 300) : '';
  const rawApiModel = typeof raw.apiModel === 'string' ? raw.apiModel.trim().slice(0, 120) : '';
  const apiBaseUrl = /^https:\/\//i.test(rawBase) ? rawBase.replace(/\/+$/, '') : '';
  const apiContextTokens = contextTokens(raw.apiContextTokens);

  return {
    model: modelId(raw.model),
    imageMode: imageMode(raw.imageMode),
    imageModel: rawImageModel || AI_AUTO,
    ...(rawApiKey ? { apiKey: rawApiKey } : {}),
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
    ...(rawApiModel ? { apiModel: rawApiModel } : {}),
    ...(apiContextTokens ? { apiContextTokens } : {}),
  };
}

export async function loadAiSettings(): Promise<AiSettings> {
  const stored = await appStore.get<unknown>(STORAGE_KEYS.aiConfig);
  const settings = normalizeAiSettings(stored);
  // Migrate away from the old shape, which carried a provider and a base URL.
  if (stored && typeof stored === 'object') {
    const raw = stored as Record<string, unknown>;
    const hasLegacyBase = typeof raw.baseUrl === 'string';
    const hasLegacyProvider = typeof raw.provider === 'string';
    if (hasLegacyBase || hasLegacyProvider) await saveAiSettings(settings);
  }
  return settings;
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  await appStore.set(STORAGE_KEYS.aiConfig, settings);
}

/**
 * Absolute base for the desktop shell or a separately hosted web build.
 * The default is same-origin, which is how the Worker deployment works.
 */
export function aiApiBase(): string {
  const configured = (import.meta.env.VITE_AI_API_BASE ?? '').trim();
  const base = configured || AI_API_BASE;
  return base.replace(/\/+$/, '');
}

export function aiApiUrl(path: string): string {
  return `${aiApiBase()}/${path.replace(/^\/+/, '')}`;
}
