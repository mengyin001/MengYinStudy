import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@mengyin/plugin-sdk';
import type { Deck } from '@mengyin/core';
import {
  canSeeLocalPlugin,
  isGeneratedLocalPlugin,
  removeDeckFromLocalPlugins,
  updateDeckInLocalPlugins,
  type LocalPluginRecord,
} from './pluginHost';

const manifest = {
  schemaVersion: 1,
  id: 'ai.test',
  name: 'Test',
  version: '1.0.0',
  tags: [],
  content: [],
} as unknown as PluginManifest;

function record(overrides: Partial<LocalPluginRecord> = {}): LocalPluginRecord {
  return {
    id: 'ai.test',
    dir: 'local:ai.test',
    manifest,
    decks: [],
    entrySource: null,
    importedAt: 1,
    origin: 'generated',
    ownerId: 'user-a',
    ...overrides,
  };
}

describe('generated local decks', () => {
  it('hides generated decks when signed out', () => {
    expect(canSeeLocalPlugin(record(), null)).toBe(false);
    expect(canSeeLocalPlugin(record({ origin: 'imported' }), null)).toBe(true);
  });

  it('only shows a generated deck to its owner', () => {
    expect(canSeeLocalPlugin(record(), 'user-a')).toBe(true);
    expect(canSeeLocalPlugin(record(), 'user-b')).toBe(false);
  });

  it('treats old ai.* records as generated', () => {
    const legacy = record({ origin: undefined, ownerId: undefined, id: 'ai.legacy' });
    expect(isGeneratedLocalPlugin(legacy)).toBe(true);
    expect(canSeeLocalPlugin(legacy, null)).toBe(false);
    expect(canSeeLocalPlugin(legacy, 'user-a')).toBe(true);
  });
});

describe('removing a local deck', () => {
  const one = { key: 'ai.test::one' } as unknown as Deck;
  const two = { key: 'ai.test::two' } as unknown as Deck;

  it('keeps the record when other decks remain', () => {
    const result = removeDeckFromLocalPlugins([record({ decks: [one, two] })], one.key);
    expect(result.removed).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.decks.map((deck) => deck.key)).toEqual([two.key]);
  });

  it('drops the record when its last deck is removed', () => {
    const result = removeDeckFromLocalPlugins([record({ decks: [one] })], one.key);
    expect(result.removed).toBe(true);
    expect(result.records).toEqual([]);
  });

  it('reports a key that is not present', () => {
    const result = removeDeckFromLocalPlugins([record({ decks: [one] })], two.key);
    expect(result.removed).toBe(false);
    expect(result.records).toHaveLength(1);
  });
});

describe('editing a local deck', () => {
  const question = (id: string) => ({
    id,
    type: 'single',
    prompt: `Question ${id}`,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: { kind: 'single', optionId: 'a' },
    tags: [],
    difficulty: 1,
  });
  const q1 = question('q1');
  const q2 = question('q2');
  const q3 = question('q3');
  const deck = {
    key: 'ai.test::one',
    id: 'one',
    pluginId: 'ai.test',
    title: 'Old name',
    tags: [],
    questions: [q1, q2, q3],
    examMinutes: 99,
  } as unknown as Deck;

  it('renames the deck, drops the removed question and keeps the others by identity', () => {
    const result = updateDeckInLocalPlugins([record({ decks: [deck] })], deck.key, {
      title: 'New name',
      questionIds: ['q1', 'q3'],
    });

    expect(result.updated).toBe(true);
    const edited = result.records[0]?.decks[0];
    expect(edited?.title).toBe('New name');
    expect(edited?.questions.map((item) => item.id)).toEqual(['q1', 'q3']);
    expect(edited?.questions[0]).toBe(q1);
    expect(edited?.questions[1]).toBe(q3);
    // The old declared length no longer matches the pruned question set.
    expect(edited?.examMinutes).not.toBe(99);
    expect(edited?.examMinutes).toBeGreaterThan(0);
  });

  it('keeps the generated plugin name in step with its only deck', () => {
    const result = updateDeckInLocalPlugins([record({ decks: [deck] })], deck.key, {
      title: 'New name',
      questionIds: ['q1', 'q2', 'q3'],
    });
    expect(result.records[0]?.manifest.name).toBe('New name');
  });

  it('does not rename the plugin of an imported folder', () => {
    const result = updateDeckInLocalPlugins(
      [record({ origin: 'imported', decks: [deck] })],
      deck.key,
      { title: 'New name', questionIds: ['q1', 'q2', 'q3'] },
    );
    expect(result.records[0]?.decks[0]?.title).toBe('New name');
    expect(result.records[0]?.manifest.name).toBe('Test');
  });

  it('never writes an empty question list', () => {
    const result = updateDeckInLocalPlugins([record({ decks: [deck] })], deck.key, {
      title: 'New name',
      questionIds: ['gone'],
    });
    expect(result.updated).toBe(false);
    expect(result.records[0]?.decks[0]?.title).toBe('Old name');
  });

  it('leaves records that do not contain the deck alone', () => {
    const result = updateDeckInLocalPlugins([record({ decks: [deck] })], 'ai.test::other', {
      title: 'New name',
      questionIds: ['q1'],
    });
    expect(result.updated).toBe(false);
    expect(result.records[0]?.decks[0]?.title).toBe('Old name');
  });
});
