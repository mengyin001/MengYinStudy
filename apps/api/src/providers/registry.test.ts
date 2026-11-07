import { describe, expect, it } from 'vitest';
import { providerCatalog, resolveProvider, resolveProviderForModel } from './registry';
import type { Env } from '../env';
import { isApiError } from '../errors';

describe('provider catalogue', () => {
  it('marks only the providers with a server key as configured', () => {
    const catalog = providerCatalog({ GLM_API_KEY: 'secret-glm' });
    const glm = catalog.providers.find((provider) => provider.id === 'glm');
    const deepseek = catalog.providers.find((provider) => provider.id === 'deepseek');
    expect(glm).toMatchObject({ configured: true, models: ['glm-4.7-flash'] });
    expect(deepseek).toMatchObject({ configured: false });
    // The browser-facing catalogue must never contain the key or a default.
    expect(JSON.stringify(catalog)).not.toContain('secret-glm');
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
    const env = { GLM_API_KEY: 'a', DEEPSEEK_API_KEY: 'b' } as Env;
    expect(resolveProviderForModel(env, 'deepseek-v4-pro').id).toBe('deepseek');
    expect(resolveProviderForModel(env, 'glm-4.7-flash').id).toBe('glm');
    expect(() => resolveProviderForModel(env, '')).toThrow(/model/i);
    expect(() => resolveProviderForModel(env, 'auto')).toThrow(/model/i);
    expect(() => resolveProviderForModel(env, 'glm-5.3')).toThrow(/available/i);
  });

  it('drops models this release does not sell', () => {
    const catalog = providerCatalog({
      GLM_API_KEY: 'a',
      GLM_MODEL: 'glm-4.7-flash',
      GLM_MODELS: 'glm-5.3,glm-4.7-flash',
    });
    const glm = catalog.providers.find((provider) => provider.id === 'glm');
    expect(glm?.models).toEqual(['glm-4.7-flash']);
  });

  it('falls back to a supported model when every configured id is retired', () => {
    const catalog = providerCatalog({
      GLM_API_KEY: 'a',
      GLM_MODEL: 'glm-5.3',
      GLM_MODELS: 'glm-5.3,glm-5.2,glm-4.6',
    });
    const glm = catalog.providers.find((provider) => provider.id === 'glm');
    expect(glm?.models).toEqual(['glm-4.7-flash']);
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
    const env: Env = { GLM_API_KEY: 'a' };
    expect(() => resolveProvider(env, 'nope')).toThrow(/Unknown provider/);
    expect(() => resolveProvider(env, 'glm', 'not-a-model')).toThrow(/Unknown model/);
  });

  it('accepts a custom model only when the operator allows it', () => {
    expect(() =>
      resolveProvider({ GLM_API_KEY: 'a', AI_ALLOW_CUSTOM_MODELS: '1' }, 'glm', 'glm-experimental'),
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
    const glm = resolveProvider({
      GLM_API_KEY: 'k',
      AI_TEMPERATURE: '',
      AI_MAX_TOKENS: '',
      AI_TIMEOUT_MS: '',
    });
    expect(glm.maxTokens).toBe(32_768);
    expect(glm.temperature).toBe(0.4);
    expect(glm.timeoutMs).toBe(300_000);
    expect(resolveProvider({ GLM_API_KEY: 'k', AI_TIMEOUT_MS: '600000' }).timeoutMs).toBe(600_000);
    expect(resolveProvider({ GLM_API_KEY: 'k', AI_TIMEOUT_MS: '900000' }).timeoutMs).toBe(600_000);
    expect(resolveProvider({ GLM_API_KEY: 'k', AI_TIMEOUT_MS: '1000' }).timeoutMs).toBe(10_000);

    const deepseek = resolveProvider({ DEEPSEEK_API_KEY: 'k' });
    expect(deepseek.maxTokens).toBe(32_768);
  });

  it('treats AI_MAX_TOKENS=0 as auto and clamps overrides to the provider ceiling', () => {
    expect(resolveProvider({ GLM_API_KEY: 'k', AI_MAX_TOKENS: '0' }).maxTokens).toBe(32_768);
    expect(resolveProvider({ GLM_API_KEY: 'k', AI_MAX_TOKENS: '65536' }).maxTokens).toBe(65_536);
    expect(resolveProvider({ GLM_API_KEY: 'k', AI_MAX_TOKENS: '999999' }).maxTokens).toBe(131_072);
    expect(resolveProvider({ DEEPSEEK_API_KEY: 'k', AI_MAX_TOKENS: '999999' }).maxTokens).toBe(
      65_536,
    );
  });

  it('reads the official base URLs and never exposes the key in the model list', () => {
    const glm = resolveProvider({ GLM_API_KEY: 'secret' });
    expect(glm.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
    const deepseek = resolveProvider({ DEEPSEEK_API_KEY: 'secret' });
    expect(deepseek.baseUrl).toBe('https://api.deepseek.com/v1');
  });
});
