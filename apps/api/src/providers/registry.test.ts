import { describe, expect, it } from 'vitest';
import { providerCatalog, resolveProvider, resolveProviderForModel } from './registry';
import type { Env } from '../env';
import { isApiError } from '../errors';

describe('provider catalogue', () => {
  it('marks only the providers with a server key as configured', () => {
    const catalog = providerCatalog({ DEEPSEEK_API_KEY: 'secret-ds' });
    const deepseek = catalog.providers.find((provider) => provider.id === 'deepseek');
    expect(deepseek).toMatchObject({
      configured: true,
      models: ['deepseek-flash', 'deepseek-v4-pro'],
    });
    // GLM is withdrawn until a commercially usable model is offered.
    expect(catalog.providers.map((provider) => provider.id)).toEqual(['deepseek']);
    // The browser-facing catalogue must never contain the key or a default.
    expect(JSON.stringify(catalog)).not.toContain('secret-ds');
    expect(catalog).not.toHaveProperty('defaultProvider');
  });

  it('adds a demo provider only when AI_MOCK is on', () => {
    expect(providerCatalog({}).providers.some((provider) => provider.id === 'demo')).toBe(false);
    const catalog = providerCatalog({ AI_MOCK: '1' });
    expect(catalog.providers.find((provider) => provider.id === 'demo')).toMatchObject({
      configured: true,
      demo: true,
    });
  });

  it('resolves a provider from an explicit model, never a default', () => {
    const env = { DEEPSEEK_API_KEY: 'b' } as Env;
    expect(resolveProviderForModel(env, 'deepseek-v4-pro').id).toBe('deepseek');
    expect(resolveProviderForModel(env, 'deepseek-flash').id).toBe('deepseek');
    expect(() => resolveProviderForModel(env, '')).toThrow(/model/i);
    expect(() => resolveProviderForModel(env, 'auto')).toThrow(/model/i);
    expect(() => resolveProviderForModel(env, 'glm-4.7-flash')).toThrow(/available/i);
  });

  it('switches generation off without touching the provider keys', () => {
    const off: Env = { DEEPSEEK_API_KEY: 'b', AI_GENERATION: 'off' };
    expect(providerCatalog(off).providers).toEqual([]);
    expect(() => resolveProvider(off)).toThrow(/switched off/i);
    expect(() => resolveProviderForModel(off, 'deepseek-flash')).toThrow(/switched off/i);

    const on: Env = { DEEPSEEK_API_KEY: 'b', AI_GENERATION: 'on' };
    expect(providerCatalog(on).providers).toHaveLength(1);
  });

  it('resolves a learner’s own provider without any server key', () => {
    const provider = resolveProviderForModel({}, 'gpt-4o-mini', {
      apiKey: 'sk-own-123456',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(provider.id).toBe('byo');
    expect(provider.baseUrl).toBe('https://api.openai.com/v1');
    expect(provider.model).toBe('gpt-4o-mini');
    expect(provider.apiKey).toBe('sk-own-123456');
  });

  it('drops models this release does not sell', () => {
    const catalog = providerCatalog({
      DEEPSEEK_API_KEY: 'a',
      DEEPSEEK_MODEL: 'deepseek-flash',
      DEEPSEEK_MODELS: 'deepseek-v5,deepseek-flash',
    });
    const deepseek = catalog.providers.find((provider) => provider.id === 'deepseek');
    expect(deepseek?.models).toEqual(['deepseek-flash']);
  });

  it('falls back to a supported model when every configured id is retired', () => {
    const catalog = providerCatalog({
      DEEPSEEK_API_KEY: 'a',
      DEEPSEEK_MODEL: 'deepseek-v5',
      DEEPSEEK_MODELS: 'deepseek-v5,deepseek-v4,deepseek-v3',
    });
    const deepseek = catalog.providers.find((provider) => provider.id === 'deepseek');
    expect(deepseek?.models).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });
});

describe('provider resolution', () => {
  it('refuses to work without any provider key', () => {
    try {
      resolveProvider({});
      throw new Error('expected a failure');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      if (isApiError(error)) expect(error.code).toBe('ai_unconfigured');
    }
  });

  it('rejects an unknown provider and an unknown model', () => {
    const env: Env = { DEEPSEEK_API_KEY: 'a' };
    expect(() => resolveProvider(env, 'nope')).toThrow(/Unknown provider/);
    expect(() => resolveProvider(env, 'glm')).toThrow(/Unknown provider/);
    expect(() => resolveProvider(env, 'deepseek', 'not-a-model')).toThrow(/Unknown model/);
  });

  it('accepts a custom model only when the operator allows it', () => {
    expect(() =>
      resolveProvider(
        { DEEPSEEK_API_KEY: 'a', AI_ALLOW_CUSTOM_MODELS: '1' },
        'deepseek',
        'deepseek-experimental',
      ),
    ).not.toThrow();
  });

  it('turns DeepSeek thinking off by default and keeps the switch configurable', () => {
    const off = resolveProvider({ DEEPSEEK_API_KEY: 'k' });
    expect(off.thinking).toBe('disabled');
    const on = resolveProvider({
      DEEPSEEK_API_KEY: 'k',
      DEEPSEEK_THINKING: 'enabled',
      DEEPSEEK_REASONING_EFFORT: 'low',
    });
    expect(on.thinking).toBe('enabled');
    expect(on.reasoningEffort).toBe('low');
  });

  it('uses provider-sized defaults when numeric settings are blank', () => {
    const deepseek = resolveProvider({
      DEEPSEEK_API_KEY: 'k',
      AI_TEMPERATURE: '',
      AI_MAX_TOKENS: '',
      AI_TIMEOUT_MS: '',
    });
    expect(deepseek.maxTokens).toBe(32_768);
    expect(deepseek.temperature).toBe(0.4);
    expect(deepseek.timeoutMs).toBe(300_000);
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_TIMEOUT_MS: '600000' }).timeoutMs).toBe(
      600_000,
    );
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_TIMEOUT_MS: '900000' }).timeoutMs).toBe(
      600_000,
    );
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_TIMEOUT_MS: '1000' }).timeoutMs).toBe(
      10_000,
    );
  });

  it('treats AI_MAX_TOKENS=0 as auto and clamps overrides to the provider ceiling', () => {
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_MAX_TOKENS: '0' }).maxTokens).toBe(32_768);
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_MAX_TOKENS: '65536' }).maxTokens).toBe(
      65_536,
    );
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_MAX_TOKENS: '999999' }).maxTokens).toBe(
      65_536,
    );
  });

  it('reads the official base URL and never exposes the key in the model list', () => {
    const deepseek = resolveProvider({ DEEPSEEK_API_KEY: 'secret' });
    expect(deepseek.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(JSON.stringify(providerCatalog({ DEEPSEEK_API_KEY: 'secret' }))).not.toContain('secret');
  });
});
