import { describe, expect, it } from 'vitest';
import { aiApiBase, normalizeAiSettings } from './config';

describe('AI settings', () => {
  it('defaults to the free model instead of a server default', () => {
    expect(normalizeAiSettings(undefined)).toEqual({
      model: 'glm-4.7-flash',
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

  it('migrates an old BYO-key configuration and drops the key', () => {
    const migrated = normalizeAiSettings({
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-should-not-stay',
      model: 'deepseek-chat',
      temperature: 0.4,
      jsonMode: true,
    });
    expect(migrated).toEqual({
      model: 'glm-4.7-flash',
      imageMode: 'auto',
      imageModel: 'auto',
    });
    expect(JSON.stringify(migrated)).not.toContain('sk-should-not-stay');
  });

  it('drops models this release no longer sells', () => {
    expect(normalizeAiSettings({ model: 'glm-4.6' }).model).toBe('glm-4.7-flash');
    expect(normalizeAiSettings({ model: 'glm-5.3-flash' }).model).toBe('glm-4.7-flash');
    expect(normalizeAiSettings({ model: 'auto' }).model).toBe('glm-4.7-flash');
    expect(normalizeAiSettings({ model: 'deepseek-flash' }).model).toBe('deepseek-flash');
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
