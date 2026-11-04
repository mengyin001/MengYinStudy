import { appStore, STORAGE_KEYS } from '@/lib/storage';
import type { AiConfig } from './types';

export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.4,
  jsonMode: true,
  maxTokens: 4096,
  timeoutMs: 120_000,
};

export function normalizeAiConfig(input: unknown): AiConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_AI_CONFIG };
  const raw = input as Partial<AiConfig>;
  const number = (value: unknown, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '',
    model: typeof raw.model === 'string' ? raw.model.trim() : DEFAULT_AI_CONFIG.model,
    temperature: number(raw.temperature, DEFAULT_AI_CONFIG.temperature, 0, 2),
    jsonMode: raw.jsonMode !== false,
    maxTokens: Math.round(number(raw.maxTokens, DEFAULT_AI_CONFIG.maxTokens, 256, 32_000)),
    timeoutMs: Math.round(number(raw.timeoutMs, DEFAULT_AI_CONFIG.timeoutMs, 10_000, 600_000)),
  };
}

/** A model and endpoint are enough; local servers often need no API key. */
export function isAiConfigured(config: AiConfig): boolean {
  return config.baseUrl.trim().length > 0 && config.model.trim().length > 0;
}

export async function loadAiConfig(): Promise<AiConfig> {
  return normalizeAiConfig(await appStore.get<unknown>(STORAGE_KEYS.aiConfig));
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  await appStore.set(STORAGE_KEYS.aiConfig, config);
}

/** Join a user-supplied base URL with an API path without doubling slashes. */
export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
