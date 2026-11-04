import type { Deck } from '@mengyin/core';
import type { LoadedPlugin } from '@mengyin/plugin-sdk';
import { adaptDeck, parseDeckFile, parseManifest } from '@mengyin/plugin-sdk';

/**
 * Decks every visitor can study without an account.
 *
 * They are bundled with the app (not part of the official catalogue), so they
 * work on a first run with no backend and can never be removed by accident.
 */
export const GUEST_PLUGIN_ID = 'guest.defaults';
export const GUEST_PLUGIN_NAME = '入門題庫 · Starter';

const EVERYDAY_DECK = {
  id: 'everyday',
  title: '入門常識',
  description: '幾個簡單問題，讓你未登入也可以立即開始練習。',
  tags: ['入門', '常識'],
  examMinutes: 7,
  questions: [
    {
      id: 'ev-1',
      type: 'single',
      prompt: '地球繞著哪顆恆星公轉？',
      options: [
        { id: 'a', text: '太陽' },
        { id: 'b', text: '月球' },
        { id: 'c', text: '火星' },
        { id: 'd', text: '北極星' },
      ],
      answer: { kind: 'single', optionId: 'a' },
      explanation: '地球環繞太陽公轉，一圈約需 365 日。',
      tags: ['天文'],
      difficulty: 1,
    },
    {
      id: 'ev-2',
      type: 'boolean',
      prompt: '在標準大氣壓下，水會在 100°C 沸騰。',
      answer: { kind: 'boolean', value: true },
      explanation: '在 1 個標準大氣壓（海平面）下，水的沸點是 100°C。',
      tags: ['科學'],
      difficulty: 1,
    },
    {
      id: 'ev-3',
      type: 'fill',
      prompt: '7 × 8 = ？',
      answer: { kind: 'fill', accept: ['56', '五十六'], ignoreSpaces: true },
      explanation: '7 乘 8 等於 56。',
      tags: ['數學'],
      difficulty: 1,
    },
    {
      id: 'ev-4',
      type: 'single',
      prompt: '平年一年有多少天？',
      options: [
        { id: 'a', text: '354 天' },
        { id: 'b', text: '365 天' },
        { id: 'c', text: '366 天' },
        { id: 'd', text: '360 天' },
      ],
      answer: { kind: 'single', optionId: 'b' },
      explanation: '平年有 365 天；閏年多一天，共 366 天。',
      tags: ['常識'],
      difficulty: 1,
    },
    {
      id: 'ev-5',
      type: 'multi',
      prompt: '下列哪些是光的三原色？',
      options: [
        { id: 'a', text: '紅' },
        { id: 'b', text: '綠' },
        { id: 'c', text: '藍' },
        { id: 'd', text: '黃' },
      ],
      answer: { kind: 'multi', optionIds: ['a', 'b', 'c'] },
      explanation: '加色法（光）的三原色是紅、綠、藍；黃是紅加綠的結果。',
      tags: ['科學'],
      difficulty: 2,
    },
  ],
};

const STUDY_DECK = {
  id: 'study-check',
  title: '學習小測',
  description: '三個關於溫習方法的簡單問題，答完再看看解析。',
  tags: ['學習方法', '入門'],
  examMinutes: 6,
  questions: [
    {
      id: 'st-1',
      type: 'single',
      prompt: '「主動回想」（active recall）是指哪一種做法？',
      options: [
        { id: 'a', text: '反覆重讀筆記' },
        { id: 'b', text: '合上書本，試著自己說出答案' },
        { id: 'c', text: '把課本畫滿螢光筆' },
        { id: 'd', text: '只看老師的摘要' },
      ],
      answer: { kind: 'single', optionId: 'b' },
      explanation: '主動回想要求你先嘗試提取記憶，比被動重讀更能找出真正的缺口。',
      tags: ['學習方法'],
      difficulty: 1,
    },
    {
      id: 'st-2',
      type: 'boolean',
      prompt: '把溫習分散到幾天，通常比一次過讀完更有效。',
      answer: { kind: 'boolean', value: true },
      explanation: '這就是「間隔效應」：分散練習讓記憶在每次提取後變得更牢固。',
      tags: ['學習方法'],
      difficulty: 1,
    },
    {
      id: 'st-3',
      type: 'fill',
      prompt: '間隔重複系統的英文縮寫是？',
      answer: { kind: 'fill', accept: ['SRS', 'srs'], ignoreCase: true, ignoreSpaces: true },
      explanation: 'SRS 是 Spaced Repetition System，按記憶強度安排下一次複習。',
      tags: ['學習方法'],
      difficulty: 1,
    },
    {
      id: 'st-4',
      type: 'short',
      prompt: '用一句話寫出你明天要溫習的一個具體主題。',
      answer: {
        kind: 'short',
        model: '例如：明天重做第三章關於循環的十道練習題。',
        keywords: ['明天', '溫習'],
      },
      explanation: '把目標寫得具體（科目、章節、題數），明天開始時就不用再想要做甚麼。',
      tags: ['學習方法'],
      difficulty: 1,
    },
  ],
};

let cached: LoadedPlugin | null = null;

export function buildGuestPlugin(): LoadedPlugin {
  if (cached) return cached;

  const manifest = parseManifest({
    schemaVersion: 1,
    id: GUEST_PLUGIN_ID,
    name: GUEST_PLUGIN_NAME,
    version: '1.0.0',
    description: '未登入也可使用的入門題庫。',
    author: 'MengYin Study',
    tags: ['入門', 'Starter'],
    content: [],
  });
  if (!manifest.ok) throw new Error('The bundled guest manifest is invalid.');

  const decks: Deck[] = [];
  for (const raw of [EVERYDAY_DECK, STUDY_DECK]) {
    const parsed = parseDeckFile(raw);
    if (!parsed.ok) throw new Error('A bundled guest deck is invalid.');
    decks.push(adaptDeck(GUEST_PLUGIN_ID, parsed.value));
  }

  cached = {
    dir: `bundled:${GUEST_PLUGIN_ID}`,
    manifest: manifest.value,
    decks,
    module: null,
    entryUrl: null,
    issues: [],
  };
  return cached;
}

export function isGuestDeckKey(key: string): boolean {
  return key.startsWith(`${GUEST_PLUGIN_ID}::`);
}
