import { describe, expect, it } from 'vitest';
import type { Deck } from '@mengyin/core';
import type { LoadedPlugin } from '@mengyin/plugin-sdk';
import {
  buildPlazaPacks,
  collectTags,
  filterPlazaPacks,
  initialsFor,
  levelFor,
  packProgress,
  sortPlazaPacks,
  toneFor,
  type DeckProgressLookup,
  type PlazaSourcePack,
} from './plaza';

function deck(input: {
  id: string;
  title: string;
  tags?: string[];
  difficulties?: number[];
  examMinutes?: number;
  description?: string;
}): Deck {
  return {
    key: `pack.demo::${input.id}`,
    id: input.id,
    pluginId: 'pack.demo',
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    tags: input.tags ?? [],
    ...(input.examMinutes === undefined ? {} : { examMinutes: input.examMinutes }),
    questions: (input.difficulties ?? [2]).map((difficulty, index) => ({
      id: `q${index + 1}`,
      type: 'single',
      prompt: `${input.title} question ${index + 1}`,
      answer: { kind: 'single', optionId: 'a' },
      tags: input.tags ?? [],
      difficulty,
    })),
  };
}

function pack(input: {
  id: string;
  name: string;
  tags?: string[];
  updatedAt?: string;
  decks: Deck[];
  description?: string;
  author?: string;
}): PlazaSourcePack {
  const loaded = {
    dir: `official:${input.id}`,
    manifest: {
      schemaVersion: 1,
      id: input.id,
      name: input.name,
      version: '1.0.0',
      ...(input.description ? { description: input.description } : {}),
      ...(input.author ? { author: input.author } : {}),
      tags: input.tags ?? [],
      content: [],
      questionTypes: [],
    },
    decks: input.decks,
    module: null,
    entryUrl: null,
    issues: [],
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
  return loaded as unknown as LoadedPlugin & { updatedAt?: string };
}

const demo = pack({
  id: 'pack.demo',
  name: '學習方法（示範題庫）',
  description: 'Five questions about retrieval and spacing.',
  author: 'MengYin Study',
  tags: ['學習方法', '示範'],
  updatedAt: '2026-11-03T16:11:24.000Z',
  decks: [
    deck({
      id: 'basics',
      title: '學習方法：提取與間隔',
      tags: ['學習方法'],
      difficulties: [1, 2],
      examMinutes: 10,
    }),
    deck({
      id: 'advanced',
      title: '進階：交錯練習',
      tags: ['學習方法', '進階'],
      difficulties: [4, 4],
      examMinutes: 5,
    }),
  ],
});

const maths = pack({
  id: 'pack.maths',
  name: 'DSE Maths',
  tags: ['DSE', '數學'],
  updatedAt: '2026-10-01T00:00:00.000Z',
  decks: [
    deck({
      id: 'algebra',
      title: 'Algebra',
      difficulties: [3, 4, 4],
    }),
  ],
});

const built = buildPlazaPacks([demo, maths]);

describe('plaza catalogue', () => {
  it('builds a stable two-character crest', () => {
    expect(initialsFor('學習方法（示範題庫）')).toBe('學習');
    expect(initialsFor('DSE Maths')).toBe('DM');
    expect(initialsFor('IELTS')).toBe('IE');
    expect(initialsFor('   ')).toBe('·');
  });

  it('gives each pack a deterministic tone in range', () => {
    expect(toneFor('pack.demo')).toBe(toneFor('pack.demo'));
    for (const id of ['pack.demo', 'pack.maths', 'a', 'b', 'c', 'd']) {
      expect(toneFor(id)).toBeGreaterThanOrEqual(0);
      expect(toneFor(id)).toBeLessThanOrEqual(3);
    }
  });

  it('maps mean difficulty to a level', () => {
    expect(levelFor(1)).toBe('beginner');
    expect(levelFor(2.25)).toBe('beginner');
    expect(levelFor(3)).toBe('intermediate');
    expect(levelFor(3.5)).toBe('intermediate');
    expect(levelFor(4)).toBe('advanced');
    expect(levelFor(Number.NaN)).toBe('beginner');
  });

  it('derives pack size, time and question-weighted difficulty', () => {
    const demoView = built[0];
    expect(demoView).toBeDefined();
    if (!demoView) return;
    expect(demoView.deckCount).toBe(2);
    expect(demoView.questionCount).toBe(4);
    expect(demoView.minutes).toBe(15);
    expect(demoView.difficulty).toBeCloseTo(2.75);
    expect(demoView.level).toBe('intermediate');
    expect(demoView.crest).toBe('學習');
    expect(demoView.updatedAt).toBe(Date.parse('2026-11-03T16:11:24.000Z'));
  });

  it('counts one tag per pack, not per deck', () => {
    const tags = collectTags(built);
    expect(tags.find((tag) => tag.tag === '學習方法')?.count).toBe(1);
    expect(tags.find((tag) => tag.tag === '示範')?.count).toBe(1);
    expect(tags.find((tag) => tag.tag === '進階')).toBeUndefined();
  });

  it('searches pack and deck copy and filters by exact tag', () => {
    expect(filterPlazaPacks(built, { query: '交錯' }).map((item) => item.id)).toEqual([
      'pack.demo',
    ]);
    expect(filterPlazaPacks(built, { query: 'mengyin' }).map((item) => item.id)).toEqual([
      'pack.demo',
    ]);
    expect(filterPlazaPacks(built, { tag: '數學' }).map((item) => item.id)).toEqual([
      'pack.maths',
    ]);
    expect(filterPlazaPacks(built, { tag: '不存在' })).toEqual([]);
  });

  it('sorts by catalogue order, update date or question count', () => {
    expect(sortPlazaPacks(built, 'recommended').map((item) => item.id)).toEqual([
      'pack.demo',
      'pack.maths',
    ]);
    expect(sortPlazaPacks(built, 'newest').map((item) => item.id)).toEqual([
      'pack.demo',
      'pack.maths',
    ]);
    expect(sortPlazaPacks(built, 'questions').map((item) => item.id)).toEqual([
      'pack.demo',
      'pack.maths',
    ]);
  });
});

function lookup(overrides: Partial<DeckProgressLookup> = {}): DeckProgressLookup {
  return {
    attempts: 0,
    seen: 0,
    total: 2,
    ratio: 0,
    dueCount: 0,
    lastAt: 0,
    ...overrides,
  };
}

describe('plaza pack progress', () => {
  const demoView = built[0];
  if (!demoView) throw new Error('demo pack missing');

  it('offers the first deck when nothing has been added', () => {
    const progress = packProgress(demoView, new Set(), new Map());
    expect(progress.added).toBe(0);
    expect(progress.total).toBe(2);
    expect(progress.complete).toBe(false);
    expect(progress.nextDeck?.deck.id).toBe('basics');
  });

  it('reports added-deck progress without counting unadded decks', () => {
    const views = new Map([
      ['pack.demo::basics', lookup({ attempts: 2, seen: 1, ratio: 0.5, dueCount: 1, lastAt: 50 })],
    ]);
    const progress = packProgress(demoView, new Set(['pack.demo::basics']), views);
    expect(progress.added).toBe(1);
    expect(progress.studied).toBe(1);
    expect(progress.questions).toBe(4);
    expect(progress.due).toBe(1);
    expect(progress.accuracy).toBeCloseTo(0.5);
    expect(progress.started).toBe(true);
    expect(progress.complete).toBe(false);
    expect(progress.nextDeck?.deck.id).toBe('basics');
  });

  it('moves to the next untouched deck after one is finished', () => {
    const views = new Map([
      ['pack.demo::basics', lookup({ attempts: 2, seen: 2, ratio: 1, lastAt: 50 })],
      ['pack.demo::advanced', lookup({ attempts: 0, seen: 0, total: 2 })],
    ]);
    const progress = packProgress(
      demoView,
      new Set(['pack.demo::basics', 'pack.demo::advanced']),
      views,
    );
    expect(progress.added).toBe(2);
    expect(progress.nextDeck?.deck.id).toBe('advanced');
  });

  it('marks a pack complete when every deck is added and studied', () => {
    const views = new Map([
      ['pack.demo::basics', lookup({ attempts: 2, seen: 2, ratio: 1, lastAt: 50 })],
      ['pack.demo::advanced', lookup({ attempts: 2, seen: 2, ratio: 0.5, lastAt: 80 })],
    ]);
    const progress = packProgress(
      demoView,
      new Set(['pack.demo::basics', 'pack.demo::advanced']),
      views,
    );
    expect(progress.studied).toBe(4);
    expect(progress.complete).toBe(true);
    expect(progress.nextDeck?.deck.id).toBe('advanced');
  });

  it('prefers the most recently studied unfinished deck when resuming', () => {
    const views = new Map([
      ['pack.demo::basics', lookup({ attempts: 3, seen: 1, ratio: 0.4, lastAt: 200 })],
      ['pack.demo::advanced', lookup({ attempts: 1, seen: 1, ratio: 1, lastAt: 100 })],
    ]);
    const progress = packProgress(
      demoView,
      new Set(['pack.demo::basics', 'pack.demo::advanced']),
      views,
    );
    expect(progress.nextDeck?.deck.id).toBe('basics');
  });
});
