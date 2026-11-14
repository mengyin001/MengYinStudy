import { describe, expect, it } from 'vitest';
import type { Deck } from '@mengyin/core';
import type { PluginManifest } from '@mengyin/plugin-sdk';
import type { LocalPluginRecord } from './pluginHost';
import { editableDeckKeys } from './library';

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

function deck(key: string, pluginId = 'ai.test'): Deck {
  return { key, id: key.split('::')[1] ?? key, pluginId, title: key } as unknown as Deck;
}

describe('editable deck keys', () => {
  it('includes a generated local deck', () => {
    const keys = editableDeckKeys([record({ decks: [deck('ai.test::one')] })], []);
    expect(keys.has('ai.test::one')).toBe(true);
  });

  it('excludes an imported local plugin', () => {
    const keys = editableDeckKeys(
      [record({ id: 'imported.deck', origin: 'imported', decks: [deck('imported.deck::one', 'imported.deck')] })],
      [],
    );
    expect(keys.size).toBe(0);
  });

  it('includes an AI cloud deck and excludes an imported cloud deck', () => {
    const keys = editableDeckKeys([], [deck('ai.cloud::one', 'ai.cloud'), deck('imported.cloud::one', 'imported.cloud')]);
    expect(keys.has('ai.cloud::one')).toBe(true);
    expect(keys.has('imported.cloud::one')).toBe(false);
  });

  it('does not duplicate a deck that is both local and in the cloud', () => {
    const one = deck('ai.test::one');
    const keys = editableDeckKeys([record({ decks: [one] })], [one]);
    expect([...keys]).toEqual(['ai.test::one']);
  });
});
