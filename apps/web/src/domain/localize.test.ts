import { describe, expect, it } from 'vitest';
import type { Deck } from '@mengyin/core';
import { localizeDeck, localizeQuestion } from './localize';

const deck: Deck = {
  key: 'cpp.runoob::demo',
  id: 'demo',
  pluginId: 'cpp.runoob',
  title: 'Pointers',
  titleI18n: { 'zh-Hant': '指標' },
  description: 'Pointer basics.',
  descriptionI18n: { 'zh-Hant': '指標入門。' },
  tags: ['C++'],
  questions: [
    {
      id: 'q1',
      type: 'single',
      prompt: 'What does * do?',
      i18n: {
        prompt: { 'zh-Hant': '＊ 的作用是甚麼？' },
        explanation: { 'zh-Hant': '它會解引用指標。' },
        options: {
          a: { 'zh-Hant': '解引用' },
          b: { 'zh-Hant': '取址' },
        },
      },
      options: [
        { id: 'a', text: 'Dereference' },
        { id: 'b', text: 'Take the address' },
      ],
      answer: { kind: 'single', optionId: 'a' },
      explanation: 'It dereferences the pointer.',
      tags: ['Pointers'],
      difficulty: 2,
    },
    {
      id: 'q2',
      type: 'short',
      prompt: 'Explain a null pointer.',
      i18n: {
        prompt: { 'zh-Hant': '說明空指標。' },
        model: { 'zh-Hant': '不指向任何物件的指標。' },
      },
      answer: { kind: 'short', model: 'A pointer that points to no object.' },
      tags: ['Pointers'],
      difficulty: 2,
    },
  ],
};

describe('localizeDeck', () => {
  it('selects the interface language for deck text and questions', () => {
    const zh = localizeDeck(deck, 'zh-Hant');
    expect(zh.title).toBe('指標');
    expect(zh.description).toBe('指標入門。');
    expect(zh.questions[0]?.prompt).toBe('＊ 的作用是甚麼？');
    expect(zh.questions[0]?.options?.map((option) => option.text)).toEqual(['解引用', '取址']);
    expect(zh.questions[0]?.explanation).toBe('它會解引用指標。');
    expect(zh.questions[1]?.answer).toEqual({ kind: 'short', model: '不指向任何物件的指標。' });

    const en = localizeDeck(deck, 'en');
    expect(en.title).toBe('Pointers');
    expect(en.questions[0]?.prompt).toBe('What does * do?');
    expect(en.questions[0]?.options?.map((option) => option.text)).toEqual([
      'Dereference',
      'Take the address',
    ]);
  });

  it('is idempotent, so switching language twice restores the original text', () => {
    const zh = localizeDeck(deck, 'zh-Hant');
    const back = localizeDeck(zh, 'en');
    expect(back.title).toBe('Pointers');
    expect(back.questions[0]?.prompt).toBe('What does * do?');
    expect(back.questions[0]?.options?.[0]?.text).toBe('Dereference');

    const zhAgain = localizeDeck(back, 'zh-Hant');
    expect(zhAgain.title).toBe('指標');
    expect(zhAgain.questions[0]?.prompt).toBe('＊ 的作用是甚麼？');
  });

  it('leaves single-language decks untouched', () => {
    const plain: Deck = {
      ...deck,
      titleI18n: undefined,
      descriptionI18n: undefined,
      questions: [],
    };
    expect(localizeDeck(plain, 'zh-Hant')).toBe(plain);
    const question = deck.questions[0]!;
    expect(localizeQuestion({ ...question, i18n: undefined }, 'zh-Hant')).toEqual({
      ...question,
      i18n: undefined,
    });
  });

  it('falls back to English when a translation is missing', () => {
    const partiallyTranslated: Deck = {
      ...deck,
      titleI18n: undefined,
      questions: [
        {
          ...deck.questions[0]!,
          i18n: { prompt: { 'zh-Hant': '只有題幹被翻譯。' } },
        },
      ],
    };
    const zh = localizeDeck(partiallyTranslated, 'zh-Hant');
    expect(zh.title).toBe('Pointers');
    expect(zh.questions[0]?.prompt).toBe('只有題幹被翻譯。');
    expect(zh.questions[0]?.options?.[0]?.text).toBe('Dereference');
  });
});
