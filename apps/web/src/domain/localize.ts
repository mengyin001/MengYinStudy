/**
 * Bilingual official content.
 *
 * Official decks may carry English text in the ordinary fields plus Chinese
 * overrides in `i18n`. Localising a deck produces a normal single-language
 * deck, so every renderer and grader keeps working unchanged. The canonical
 * text is written back into `i18n`, which makes the transformation idempotent:
 * switching language twice still shows the right text.
 */
import type { Deck, Locale, LocalizedText, Question } from '@mengyin/core';

function canonicalText(base: string, translation?: LocalizedText): LocalizedText {
  const en = translation?.en ?? base;
  const zh = translation?.['zh-Hant']?.trim() ? translation['zh-Hant'] : undefined;
  return { en, ...(zh ? { 'zh-Hant': zh } : {}) };
}

function pick(text: LocalizedText, locale: Locale): string {
  if (locale === 'zh-Hant') return text['zh-Hant'] ?? text.en ?? '';
  return text.en ?? text['zh-Hant'] ?? '';
}

export function localizeQuestion(question: Question, locale: Locale): Question {
  const i18n = question.i18n;
  if (!i18n) return question;

  const prompt = canonicalText(question.prompt, i18n.prompt);
  const explanation = question.explanation
    ? canonicalText(question.explanation, i18n.explanation)
    : undefined;
  const hint = question.hint ? canonicalText(question.hint, i18n.hint) : undefined;

  const optionText = new Map<string, LocalizedText>();
  const options = question.options?.map((option) => {
    const text = canonicalText(option.text, i18n.options?.[option.id]);
    optionText.set(option.id, text);
    return { ...option, text: pick(text, locale) };
  });

  let answer = question.answer;
  let model: LocalizedText | undefined;
  if (answer.kind === 'short' && i18n.model) {
    model = canonicalText(answer.model, i18n.model);
    answer = { ...answer, model: pick(model, locale) };
  }

  return {
    ...question,
    prompt: pick(prompt, locale),
    ...(options ? { options } : {}),
    ...(explanation ? { explanation: pick(explanation, locale) } : {}),
    ...(hint ? { hint: pick(hint, locale) } : {}),
    answer,
    i18n: {
      prompt,
      ...(explanation ? { explanation } : {}),
      ...(hint ? { hint } : {}),
      ...(options ? { options: Object.fromEntries(optionText) } : {}),
      ...(model ? { model } : {}),
    },
  };
}

export function localizeDeck(deck: Deck, locale: Locale): Deck {
  const bilingual =
    deck.titleI18n || deck.descriptionI18n || deck.questions.some((question) => question.i18n);
  if (!bilingual) return deck;

  const title = canonicalText(deck.title, deck.titleI18n);
  const description = deck.description
    ? canonicalText(deck.description, deck.descriptionI18n)
    : undefined;

  return {
    ...deck,
    title: pick(title, locale),
    ...(description ? { description: pick(description, locale) } : {}),
    titleI18n: title,
    ...(description ? { descriptionI18n: description } : {}),
    questions: deck.questions.map((question) => localizeQuestion(question, locale)),
  };
}
