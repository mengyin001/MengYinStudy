import { describe, expect, it } from 'vitest';
import { aiApiBase, normalizeAiSettings } from './config';

describe('AI settings', () => {
  it('starts with nothing selected', () => {
    expect(normalizeAiSettings(undefined)).toEqual({
      model: '',
      imageMode: 'auto',
      imageModel: 'auto',
    });
    expect(
      normalizeAiSettings({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        imageMode: 'on',
        imageModel: '@cf/black-forest-labs/flux-1-schnell',
      }),
    ).toEqual({
      model: 'deepseek-v4-pro',
      imageMode: 'on',
      imageModel: '@cf/black-forest-labs/flux-1-schnell',
    });
  });

  it('keeps the own provider fields and the old provider is dropped', () => {
    const migrated = normalizeAiSettings({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-own-key-123456',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
      apiModel: 'glm-4.7-flash',
      apiContextTokens: '128000',
      model: 'own',
      temperature: 0.4,
      jsonMode: true,
    });
    expect(migrated).toEqual({
      model: 'own',
      imageMode: 'auto',
      imageModel: 'auto',
      apiKey: 'sk-own-key-123456',
      apiBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiModel: 'glm-4.7-flash',
      apiContextTokens: 128000,
    });
    expect(normalizeAiSettings({ apiKey: '   ' }).apiKey).toBeUndefined();
    expect(normalizeAiSettings({ apiBaseUrl: 'http://insecure.test' }).apiBaseUrl).toBeUndefined();
    expect(normalizeAiSettings({ apiContextTokens: 10 }).apiContextTokens).toBeUndefined();
  });

  it('drops models this release no longer sells', () => {
    expect(normalizeAiSettings({ model: 'glm-4.6' }).model).toBe('');
    expect(normalizeAiSettings({ model: 'glm-5.3-flash' }).model).toBe('');
    expect(normalizeAiSettings({ model: 'auto' }).model).toBe('');
    expect(normalizeAiSettings({ model: 'deepseek-flash' }).model).toBe('deepseek-flash');
    expect(normalizeAiSettings({ model: 'own' }).model).toBe('own');
  });

  it('falls back to auto for an invalid image mode', () => {
    expect(normalizeAiSettings({ imageMode: 'sometimes' }).imageMode).toBe('auto');
  });

  it('keeps a chosen image model and defaults a missing one', () => {
    expect(normalizeAiSettings({ imageModel: '  demo-svg  ' }).imageModel).toBe('demo-svg');
    expect(normalizeAiSettings({ imageModel: '   ' }).imageModel).toBe('auto');
    expect(normalizeAiSettings({}).imageModel).toBe('auto');
  });

  it('defaults the API base to the same-origin path', () => {
    expect(aiApiBase()).toBe('/api/ai');
  });
});
