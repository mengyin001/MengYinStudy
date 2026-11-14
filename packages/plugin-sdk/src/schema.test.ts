import { codeSpecOf } from '@mengyin/core';
import { describe, expect, it } from 'vitest';
import { adaptDeck, parseDeckFile } from './schema';

function rawDeck(overrides: Record<string, unknown> = {}) {
  return {
    id: 'basics',
    title: 'Basics',
    tags: ['Numbers'],
    questions: [
      {
        id: 'q1',
        type: 'boolean',
        prompt: 'Two is even.',
        answer: { kind: 'boolean', value: true },
        tags: ['Numbers'],
        difficulty: 1,
      },
    ],
    ...overrides,
  };
}

function codeDeck(code: Record<string, unknown>) {
  return rawDeck({
    questions: [
      {
        id: 'q1',
        type: 'code',
        prompt: 'Fill in the blank.',
        answer: { kind: 'custom', value: {} },
        meta: { code },
      },
    ],
  });
}

describe('code question languages', () => {
  it('accepts Python and SQL specs', () => {
    const python = parseDeckFile(
      codeDeck({
        language: 'python',
        template: 'print({{blank}})',
        solution: 'input[0]',
        tests: [{ input: [1], expect: '1' }],
      }),
    );
    expect(python.ok).toBe(true);

    const sql = parseDeckFile(
      codeDeck({
        language: 'sql',
        template: 'SELECT {{blank}} FROM t;',
        solution: 'id',
        tests: [{ input: 'CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1);', expect: '1' }],
      }),
    );
    expect(sql.ok).toBe(true);

    for (const language of ['java', 'cpp'] as const) {
      const stdin = parseDeckFile(
        codeDeck({
          language,
          template: '{{blank}}',
          solution: 'return 0;',
          tests: [{ stdin: '3\n1 2 3', expect: '6' }],
        }),
      );
      expect(stdin.ok).toBe(true);
    }
  });

  it('defaults the language to JavaScript for old decks', () => {
    const parsed = parseDeckFile(
      codeDeck({
        template: 'console.log({{blank}});',
        solution: '1',
        tests: [{ expect: '1' }],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const deck = adaptDeck('test.pack', parsed.value);
    expect(codeSpecOf(deck.questions[0]!)?.language).toBe('javascript');
  });

  it('rejects an unknown language and a non-string SQL input', () => {
    expect(
      parseDeckFile(
        codeDeck({ language: 'ruby', template: 'puts {{blank}}', solution: '1', tests: [{ expect: '1' }] }),
      ).ok,
    ).toBe(false);

    expect(
      parseDeckFile(
        codeDeck({
          language: 'sql',
          template: 'SELECT {{blank}};',
          solution: '1',
          tests: [{ input: [1], expect: '1' }],
        }),
      ).ok,
    ).toBe(false);

    expect(
      parseDeckFile(
        codeDeck({
          language: 'java',
          template: '{{blank}}',
          solution: 'return 0;',
          tests: [{ input: [1], expect: '1' }],
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('deck exam length', () => {
  it('accepts an author-set whole-paper length and keeps it on the deck', () => {
    const parsed = parseDeckFile(rawDeck({ examMinutes: 18 }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(adaptDeck('test.pack', parsed.value).examMinutes).toBe(18);
  });

  it('leaves the length undefined when the deck does not declare one', () => {
    const parsed = parseDeckFile(rawDeck());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(adaptDeck('test.pack', parsed.value).examMinutes).toBeUndefined();
  });

  it('rejects a length outside 1–600 minutes', () => {
    expect(parseDeckFile(rawDeck({ examMinutes: 0 })).ok).toBe(false);
    expect(parseDeckFile(rawDeck({ examMinutes: 601 })).ok).toBe(false);
    expect(parseDeckFile(rawDeck({ examMinutes: 12.5 })).ok).toBe(false);
  });
});

describe('bilingual official decks', () => {
  it('keeps the i18n overrides through parsing and adaptation', () => {
    const parsed = parseDeckFile(
      rawDeck({
        title: 'Pointers',
        titleI18n: { 'zh-Hant': '指標' },
        description: 'Pointer basics.',
        descriptionI18n: { 'zh-Hant': '指標入門。' },
        questions: [
          {
            id: 'q1',
            type: 'single',
            prompt: 'What does * do?',
            i18n: {
              prompt: { 'zh-Hant': '＊ 的作用是甚麼？' },
              options: { a: { 'zh-Hant': '解引用' }, b: { 'zh-Hant': '取址' } },
              explanation: { 'zh-Hant': '它會解引用指標。' },
            },
            options: [
              { id: 'a', text: 'Dereference' },
              { id: 'b', text: 'Take the address' },
            ],
            answer: { kind: 'single', optionId: 'a' },
            explanation: 'It dereferences the pointer.',
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const deck = adaptDeck('cpp.runoob', parsed.value);
    expect(deck.titleI18n).toEqual({ 'zh-Hant': '指標' });
    expect(deck.descriptionI18n).toEqual({ 'zh-Hant': '指標入門。' });
    expect(deck.questions[0]?.i18n?.prompt).toEqual({ 'zh-Hant': '＊ 的作用是甚麼？' });
    expect(deck.questions[0]?.i18n?.options?.a).toEqual({ 'zh-Hant': '解引用' });
  });

  it('rejects empty translations instead of storing blanks', () => {
    expect(
      parseDeckFile(rawDeck({ titleI18n: { 'zh-Hant': '' } })).ok,
    ).toBe(false);
  });
});

describe('figure media', () => {
  const figure = {
    v: 1,
    coords: 'cartesian',
    x: { min: -2, max: 2 },
    y: { min: 0, max: 4 },
    elements: [{ kind: 'plot', expr: 'x^2' }],
  };
  const withFigure = (spec: unknown) =>
    rawDeck({
      questions: [
        {
          id: 'q1',
          type: 'boolean',
          prompt: 'The curve opens upwards.',
          answer: { kind: 'boolean', value: true },
          tags: ['Graphs'],
          difficulty: 2,
          media: [{ type: 'figure', figure: spec, alt: '拋物線' }],
        },
      ],
    });

  it('parses a figure, normalises it and keeps it on the question', () => {
    const parsed = parseDeckFile(withFigure(figure));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const media = adaptDeck('test.pack', parsed.value).questions[0]?.media?.[0];
    expect(media?.type).toBe('figure');
    if (media?.type === 'figure') {
      expect(media.figure.width).toBe(420);
      expect(media.figure.elements).toHaveLength(1);
      expect(media.alt).toBe('拋物線');
    }
  });

  it('rejects an invalid spec instead of storing it', () => {
    expect(parseDeckFile(withFigure({ v: 1, elements: [{ kind: 'plot', expr: 'alert(1)' }] })).ok).toBe(
      false,
    );
    expect(parseDeckFile(withFigure({ v: 9, elements: figure.elements })).ok).toBe(false);
  });
});
