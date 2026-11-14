import { describe, expect, it } from 'vitest';
import { parseImageRequest, parseQuestionRequest } from './validation';

/** Every question request must name its model; tests add the shared one here. */
const model = 'glm-4.7-flash';

describe('question request validation', () => {
  it('requires an explicit model', () => {
    expect(() => parseQuestionRequest({ topic: 'x' })).toThrow(/model/i);
    expect(() => parseQuestionRequest({ topic: 'x', model: 'auto' })).toThrow(/model/i);
    expect(parseQuestionRequest({ topic: 'x', model: 'deepseek-v4-pro' }).model).toBe(
      'deepseek-v4-pro',
    );
  });

  it('accepts an own provider key and rejects a malformed one', () => {
    expect(parseQuestionRequest({ topic: 'x', model }).apiKey).toBeUndefined();
    expect(
      parseQuestionRequest({ topic: 'x', model, apiKey: '  sk-abcdefgh12345678  ' }).apiKey,
    ).toBe('sk-abcdefgh12345678');
    expect(() =>
      parseQuestionRequest({ topic: 'x', model, apiKey: 'not a key with spaces' }),
    ).toThrow(/apiKey/i);
    expect(() => parseQuestionRequest({ topic: 'x', model, apiKey: 42 })).toThrow(/apiKey/i);
  });

  it('accepts any public https provider URL and refuses anything else', () => {
    const base = (apiBaseUrl: string) =>
      parseQuestionRequest({ topic: 'x', model, apiKey: 'sk-abcdefgh12345678', apiBaseUrl })
        .apiBaseUrl;
    expect(base('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
    expect(base('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api/v1');
    expect(() => base('http://api.openai.com/v1')).toThrow(/https/i);
    expect(() => base('https://localhost:8787/v1')).toThrow(/public/i);
    expect(() => base('https://10.0.0.1/v1')).toThrow(/public/i);
    expect(() => base('https://user:pass@api.openai.com/v1')).toThrow(/credentials/i);
    expect(() => base('not a url')).toThrow(/valid URL/i);
  });

  it('applies defaults and derives a topic from the description', () => {
    const parsed = parseQuestionRequest({
      model,
      description: 'Binary search\nSecond line',
      count: 3,
    });
    expect(parsed.topic).toBe('Binary search');
    expect(parsed.count).toBe(3);
    expect(parsed.difficulty).toBe('mixed');
    expect(parsed.language).toBe('auto');
    expect(parsed.types).toEqual(['single', 'multi', 'boolean', 'fill', 'short', 'code']);
    expect(parsed.codeLanguage).toBe('javascript');
    expect(parsed.imageMode).toBe('auto');
    expect(parsed.imageMax).toBeUndefined();
  });

  it('rejects a request without a topic or description and non-positive counts', () => {
    expect(() => parseQuestionRequest({ model })).toThrow(/topic/i);
    expect(() => parseQuestionRequest({ model, topic: 'x', count: 0 })).toThrow(/count/);
    expect(() => parseQuestionRequest({ model, topic: 'x', count: 2.5 })).toThrow(/count/);
    expect(parseQuestionRequest({ model, topic: 'x', count: 31 }).count).toBe(31);
    expect(parseQuestionRequest({ model, topic: 'x', count: 1000 }).count).toBe(1000);
  });

  it('filters unknown question types and refuses an empty list', () => {
    const parsed = parseQuestionRequest({ model, topic: 'x', types: ['single', 'nope'] });
    expect(parsed.types).toEqual(['single']);
    expect(() => parseQuestionRequest({ model, topic: 'x', types: ['nope'] })).toThrow(/type/i);
  });

  it('bounds materials and trims control characters', () => {
    const parsed = parseQuestionRequest({
      model,
      topic: 'x',
      materials: [{ name: 'notes.txt', text: 'A\u0000B' }],
    });
    expect(parsed.materials[0]?.text).toBe('AB');
    expect(() =>
      parseQuestionRequest({
        model,
        topic: 'x',
        materials: Array.from({ length: 9 }, (_, index) => ({ name: `${index}.txt`, text: 'x' })),
      }),
    ).toThrow(/materials/i);
    expect(() =>
      parseQuestionRequest({
        model,
        topic: 'x',
        materials: [{ name: 'big.txt', text: 'x'.repeat(200_001) }],
      }),
    ).toThrow(/character limit/i);
  });

  it('allows any non-negative image preference and validates imageMode', () => {
    const parsed = parseQuestionRequest({ model, topic: 'x', imageMode: 'on', imageMax: 12 });
    expect(parsed.imageMode).toBe('on');
    expect(parsed.imageMax).toBe(12);
    expect(parseQuestionRequest({ model, topic: 'x' }).imageMax).toBeUndefined();
    expect(parseQuestionRequest({ model, topic: 'x', imageMax: 31 }).imageMax).toBe(31);
    expect(() => parseQuestionRequest({ model, topic: 'x', imageMax: -1 })).toThrow(/imageMax/);
    expect(parseQuestionRequest({ model, topic: 'x', imageMode: 'nope' }).imageMode).toBe('auto');
  });

  it('passes through a selected image model and drops auto', () => {
    expect(
      parseQuestionRequest({
        model,
        topic: 'x',
        imageModel: '@cf/black-forest-labs/flux-1-schnell',
      }).imageModel,
    ).toBe('@cf/black-forest-labs/flux-1-schnell');
    expect(parseQuestionRequest({ model, topic: 'x', imageModel: 'auto' }).imageModel).toBeUndefined();
  });
});

describe('image request validation', () => {
  it('requires a bounded prompt', () => {
    expect(parseImageRequest({ prompt: '  a leaf  ', alt: 'leaf' })).toEqual({
      prompt: 'a leaf',
      alt: 'leaf',
    });
    expect(() => parseImageRequest({})).toThrow(/prompt/);
    expect(() => parseImageRequest({ prompt: 'x'.repeat(601) })).toThrow(/prompt/);
  });

  it('accepts a named image model', () => {
    expect(parseImageRequest({ prompt: 'a leaf', model: 'demo-svg' })).toEqual({
      prompt: 'a leaf',
      model: 'demo-svg',
    });
  });
});
