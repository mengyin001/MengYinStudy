import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '@mengyin/plugin-sdk';
import type { Deck } from '@mengyin/core';
import {
  canSeeLocalPlugin,
  isGeneratedLocalPlugin,
  removeDeckFromLocalPlugins,
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
