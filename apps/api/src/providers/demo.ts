/**
 * The demo provider.
 *
 * It exists so the full flow (API, streaming, validation, images) can be
 * exercised before any provider key is configured. Every reply is labelled in
 * `warnings`, and the UI shows the provider as "Demo". It is disabled unless
 * `AI_MOCK=1`.
 */
import type { AiQuestionType, AiUsage } from '@mengyin/ai-contract';
import type { ChatMessage, ChatModel, ChatResult } from './chat';

const TYPE_ASPECTS = ['definition', 'example', 'application', 'comparison', 'property', 'process'];

function countFrom(text: string): number {
  const match = /Write exactly (\d+) question/.exec(text);
  const value = match ? Number(match[1]) : 1;
  return Number.isFinite(value) ? Math.min(6, Math.max(1, value)) : 1;
}

function topicFrom(text: string): string {
  const match = /^Topic: (.+)$/m.exec(text);
  return match?.[1]?.trim() || 'the topic';
}

function typesFrom(text: string): AiQuestionType[] {
  const single = /Question type: every question must be "([a-z]+)"/.exec(text);
  if (single?.[1]) return [single[1] as AiQuestionType];
  const allowed = /Allowed question types: ([a-z, ]+)\./.exec(text);
  if (allowed?.[1]) {
    return allowed[1]
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is AiQuestionType =>
        ['single', 'multi', 'boolean', 'fill', 'short', 'code'].includes(item),
      );
  }
  return ['single'];
}

function wantsChinese(text: string, topic: string): boolean {
  if (/Language: Traditional Chinese/.test(text)) return true;
  if (/Language: English/.test(text)) return false;
  return /[\u4e00-\u9fff]/.test(topic);
}

function usageFor(prompt: string, reply: string): AiUsage {
  return {
    promptTokens: Math.ceil(prompt.length / 4),
    completionTokens: Math.ceil(reply.length / 4),
    totalTokens: Math.ceil((prompt.length + reply.length) / 4),
  };
}

function questionOfType(type: AiQuestionType, topic: string, index: number, zh: boolean, images: boolean) {
  const aspect = TYPE_ASPECTS[index % TYPE_ASPECTS.length] ?? 'definition';
  const image =
    images && index === 1
      ? {
          image: {
            prompt:
              'A simple flat vector illustration of three connected geometric shapes on a plain white background, ' +
              'clear outlines, no text, no labels, no numbers, no people, no watermark.',
            alt: zh ? '示範插圖' : 'Demo illustration',
          },
        }
      : {};
  const base = {
    tags: [topic.slice(0, 40)],
    difficulty: 2,
    estimatedSeconds: type === 'code' ? 180 : type === 'short' ? 120 : 45,
    ...image,
  };

  if (type === 'boolean') {
    return {
      ...base,
      type,
      prompt: zh
        ? `示範題 ${index + 1}：關於「${topic}」的${aspect}敘述為真。`
        : `Demo question ${index + 1}: this ${aspect} statement about ${topic} is true.`,
      answer: { kind: 'boolean', value: true },
      explanation: zh
        ? '這是示範模式的固定答案，不代表真實學科內容。'
        : 'This is a fixed demo answer, not real subject content.',
    };
  }
  if (type === 'fill') {
    return {
      ...base,
      type,
      prompt: zh
        ? `示範題 ${index + 1}：關於「${topic}」的關鍵詞是 ______。`
        : `Demo question ${index + 1}: the key term for ${topic} is ______.`,
      answer: { kind: 'fill', accept: [topic], ignoreCase: true },
      explanation: zh ? '示範模式接受題目中的主題字詞。' : 'Demo mode accepts the topic text as the answer.',
    };
  }
  if (type === 'short') {
    return {
      ...base,
      type,
      prompt: zh
        ? `示範題 ${index + 1}：用一兩句話說明「${topic}」的${aspect}。`
        : `Demo question ${index + 1}: explain one ${aspect} of ${topic} in a sentence or two.`,
      answer: {
        kind: 'short',
        model: zh ? `這是關於「${topic}」的示範答案。` : `This is a demo answer about ${topic}.`,
        keywords: [topic],
      },
      explanation: zh ? '示範模式不檢查語意。' : 'Demo mode does not check meaning.',
    };
  }
  if (type === 'code') {
    return {
      ...base,
      type,
      prompt: zh
        ? `示範程式題 ${index + 1}：填入能計算 input 陣列總和的運算式。`
        : `Demo code question ${index + 1}: fill in the expression that sums the numbers in input.`,
      answer: { kind: 'custom', value: {} },
      explanation: zh ? 'reduce 由 0 開始累加。' : 'reduce folds the array from 0.',
      meta: {
        code: {
          language: 'javascript',
          template: 'const total = {{blank}};\nconsole.log(total);',
          blankLabel: 'expression that sums input',
          solution: 'input.reduce((sum, n) => sum + n, 0)',
          tests: [
            { name: 'sample', input: [1, 2, 3], expect: '6' },
            { name: 'empty', input: [], expect: '0' },
          ],
        },
      },
    };
  }
  if (type === 'multi') {
    return {
      ...base,
      type,
      prompt: zh
        ? `示範題 ${index + 1}：關於「${topic}」的${aspect}，下列哪些敘述正確？`
        : `Demo question ${index + 1}: which statements about the ${aspect} of ${topic} are correct?`,
      options: [
        { id: 'a', text: zh ? '示範選項 A（正確）' : 'Demo option A (correct)' },
        { id: 'b', text: zh ? '示範選項 B' : 'Demo option B' },
        { id: 'c', text: zh ? '示範選項 C（正確）' : 'Demo option C (correct)' },
        { id: 'd', text: zh ? '示範選項 D' : 'Demo option D' },
      ],
      answer: { kind: 'multi', optionIds: ['a', 'c'] },
      explanation: zh ? '這是示範模式的固定答案。' : 'This is a fixed demo answer.',
    };
  }
  return {
    ...base,
    type: 'single',
    prompt: zh
      ? `示範題 ${index + 1}：關於「${topic}」的${aspect}，哪一項正確？`
      : `Demo question ${index + 1}: which statement about the ${aspect} of ${topic} is correct?`,
    options: [
      { id: 'a', text: zh ? '示範選項 A' : 'Demo option A' },
      { id: 'b', text: zh ? '示範選項 B（正確）' : 'Demo option B (correct)' },
      { id: 'c', text: zh ? '示範選項 C' : 'Demo option C' },
      { id: 'd', text: zh ? '示範選項 D' : 'Demo option D' },
    ],
    answer: { kind: 'single', optionId: 'b' },
    explanation: zh ? '這是示範模式的固定答案。' : 'This is a fixed demo answer.',
  };
}

function demoReply(messages: ChatMessage[]): ChatResult {
  const user = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  if (/health check|Reply with the single word OK/i.test(user) || /Reply now\./.test(user)) {
    return { text: 'OK', finishReason: 'stop' };
  }
  const count = countFrom(user);
  const topic = topicFrom(user);
  const types = typesFrom(user);
  const zh = wantsChinese(user, topic);
  const images = /Visuals: (?:optional|required)/.test(user);
  const questions = Array.from({ length: count }, (_, index) =>
    questionOfType(types[index % Math.max(1, types.length)] ?? 'single', topic, index, zh, images),
  );
  const text = JSON.stringify({
    questions,
    warnings: [
      zh
        ? '示範模式：這些是固定範例題，不是真實學科內容。設定 GLM_API_KEY 或 DEEPSEEK_API_KEY 後才會生成正式題目。'
        : 'Demo mode: these are fixed placeholder questions. Add GLM_API_KEY or DEEPSEEK_API_KEY to generate real study content.',
    ],
  });
  return {
    text,
    model: 'demo',
    finishReason: 'stop',
    usage: usageFor(user, text),
  };
}

export function createDemoChatModel(): ChatModel {
  return {
    provider: 'demo',
    providerLabel: 'Demo (no provider key)',
    model: 'demo',
    async complete(messages) {
      return demoReply(messages);
    },
  };
}
