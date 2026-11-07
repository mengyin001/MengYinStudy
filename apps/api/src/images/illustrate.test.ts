import { describe, expect, it } from 'vitest';
import type { Deck } from '@mengyin/core';
import { illustrateDeck } from './illustrate';
import type { ImageGenerator } from './generator';
import type { ImageSearcher } from './search';

function deck(): Deck {
  return {
    key: 'p::d',
    id: 'd',
    pluginId: 'p',
    title: 'Demo',
    tags: [],
    questions: [
      {
        id: 'q1',
        type: 'single',
        prompt: 'Which one?',
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        answer: { kind: 'single', optionId: 'a' },
        tags: [],
        difficulty: 1,
      },
      {
        id: 'q2',
        type: 'boolean',
        prompt: 'True or false?',
        answer: { kind: 'boolean', value: true },
        tags: [],
        difficulty: 1,
      },
    ],
  };
}

function generator(fail = false): ImageGenerator {
  return {
    model: 'test-image',
    demo: false,
    async generate(prompt) {
      if (fail) throw new Error('provider down');
      return { image: `data:image/png;base64,${btoa(prompt)}`, model: 'test-image' };
    },
  };
}

describe('illustrateDeck', () => {
  it('attaches an image to the matching question and honours the cap', async () => {
    const target = deck();
    const result = await illustrateDeck(
      target,
      [
        { questionId: 'q1', prompt: 'first', alt: 'first alt' },
        { questionId: 'q2', prompt: 'second' },
      ],
      generator(),
      { max: 1 },
    );
    expect(result).toMatchObject({ requested: 2, generated: 1, failed: 0 });
    expect(target.questions[0]?.media?.[0]).toMatchObject({ type: 'image', alt: 'first alt' });
    expect(target.questions[1]?.media).toBeUndefined();
  });

  it('keeps the question when an illustration fails', async () => {
    const target = deck();
    const result = await illustrateDeck(
      target,
      [
        { questionId: 'q1', prompt: 'first' },
        { questionId: 'q2', prompt: 'second' },
      ],
      generator(true),
      { max: 2, concurrency: 1 },
    );
    expect(result).toMatchObject({ requested: 2, generated: 0, failed: 2 });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]?.code).toBe('image');
    expect(target.questions[0]?.media).toBeUndefined();
  });

  it('uses a web photo before the image model and stores its attribution', async () => {
    const target = deck();
    let generated = false;
    const searcher: ImageSearcher = {
      provider: 'test',
      async search() {
        return {
          image: 'data:image/jpeg;base64,AAAA',
          title: 'Eiffel Tower',
          credit: 'Jane Doe · Wikimedia Commons · CC BY-SA 4.0',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower.jpg',
          license: 'CC BY-SA 4.0',
        };
      },
    };
    const model: ImageGenerator = {
      model: 'test-image',
      demo: false,
      async generate() {
        generated = true;
        return { image: 'data:image/png;base64,BBBB', model: 'test-image' };
      },
    };

    const result = await illustrateDeck(
      target,
      [{ questionId: 'q1', prompt: 'A landmark.', search: 'Eiffel Tower Paris', alt: 'A tower' }],
      model,
      { max: 1, search: searcher },
    );
    expect(result).toMatchObject({ requested: 1, generated: 1, searched: 1, failed: 0 });
    expect(generated).toBe(false);
    expect(target.questions[0]?.media?.[0]).toMatchObject({
      type: 'image',
      credit: 'Jane Doe · Wikimedia Commons · CC BY-SA 4.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Eiffel_Tower.jpg',
      license: 'CC BY-SA 4.0',
    });
  });

  it('falls back to the image model when web search misses', async () => {
    const target = deck();
    const searcher: ImageSearcher = {
      provider: 'test',
      async search() {
        return null;
      },
    };
    const result = await illustrateDeck(
      target,
      [{ questionId: 'q1', prompt: 'A landmark.', search: 'nowhere' }],
      generator(),
      { max: 1, search: searcher },
    );
    expect(result).toMatchObject({ generated: 1, searched: 0, failed: 0 });
    expect(target.questions[0]?.media?.[0]?.type).toBe('image');
  });

  it('does not replace a missing clue reference with a generated guess', async () => {
    const target = deck();
    let generated = false;
    const searcher: ImageSearcher = {
      provider: 'test',
      async search() {
        return null;
      },
    };
    const model: ImageGenerator = {
      model: 'test-image',
      demo: false,
      async generate() {
        generated = true;
        return { image: 'data:image/png;base64,BBBB', model: 'test-image' };
      },
    };
    const result = await illustrateDeck(
      target,
      [{ questionId: 'q1', prompt: 'A landmark.', search: 'France', searchOnly: true }],
      model,
      { max: 1, search: searcher },
    );
    expect(result).toMatchObject({ generated: 0, searched: 0, failed: 1 });
    expect(generated).toBe(false);
    expect(result.warnings[0]?.message).toContain('No reliable reference photo');
  });

  it('works with web search alone and reports a miss', async () => {
    const target = deck();
    const searcher: ImageSearcher = {
      provider: 'test',
      async search() {
        return null;
      },
    };
    const result = await illustrateDeck(
      target,
      [{ questionId: 'q1', prompt: 'A landmark.', search: 'nowhere' }],
      null,
      { max: 1, search: searcher },
    );
    expect(result).toMatchObject({ generated: 0, searched: 0, failed: 1 });
    expect(result.warnings[0]?.message).toContain('no image generator');
  });
});
