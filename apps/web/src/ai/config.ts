import { FREE_MODEL, SUPPORTED_MODELS } from '@mengyin/core';
import { AI_API_BASE, type AiImageMode } from '@mengyin/ai-contract';
import { appStore, STORAGE_KEYS } from '@/lib/storage';
import type { AiSettings } from './types';

export const AI_AUTO = 'auto';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  model: FREE_MODEL,
  imageMode: 'auto',
  imageModel: AI_AUTO,
};

function imageMode(value: unknown): AiImageMode {
  return value === 'off' || value === 'on' || value === 'auto' ? value : 'auto';
}

function modelId(value: unknown): string {
  if (typeof value !== 'string') return FREE_MODEL;
  const trimmed = value.trim();
  return (SUPPORTED_MODELS as readonly string[]).includes(trimmed) ? trimmed : FREE_MODEL;
}

/**
 * Accept both the current settings object and the pre-0.6.1 BYO-key shape.
 *
 * The provider field and the API key are deliberately dropped: generation now
 * names a model directly, and a key must not stay in local storage once
 * generation moves to the hosted service. An unknown legacy model falls back
 * to the free model rather than being sent to the server.
 */
export function normalizeAiSettings(input: unknown): AiSettings {
  if (!input || typeof input !== 'object') return { ...DEFAULT_AI_SETTINGS };
  const raw = input as Record<string, unknown>;
  const rawImageModel = typeof raw.imageModel === 'string' ? raw.imageModel.trim() : '';

  return {
    model: modelId(raw.model),
    imageMode: imageMode(raw.imageMode),
    imageModel: rawImageModel || AI_AUTO,
  };
}

export async function loadAiSettings(): Promise<AiSettings> {
  const stored = await appStore.get<unknown>(STORAGE_KEYS.aiConfig);
  const settings = normalizeAiSettings(stored);
  // Migrate away from the old shape, which could contain a provider key.
  if (stored && typeof stored === 'object') {
    const raw = stored as Record<string, unknown>;
    const hasLegacySecret = typeof raw.apiKey === 'string' && raw.apiKey.trim().length > 0;
    const hasLegacyBase = typeof raw.baseUrl === 'string';
    const hasLegacyProvider = typeof raw.provider === 'string';
    if (hasLegacySecret || hasLegacyBase || hasLegacyProvider) await saveAiSettings(settings);
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
