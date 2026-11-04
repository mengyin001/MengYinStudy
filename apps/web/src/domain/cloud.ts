import type { Deck } from '@mengyin/core';
import type { LoadedPlugin, PluginManifest } from '@mengyin/plugin-sdk';
import type { UserDeck } from '@/services/types';

/** Turn a private cloud row back into the same Deck shape the rest of the app uses. */
export function userDeckToDeck(record: UserDeck): Deck {
  return {
    key: record.clientKey,
    id: record.deckId,
    pluginId: record.pluginId,
    title: record.title,
    ...(record.description ? { description: record.description } : {}),
    tags: record.tags,
    questions: record.questions,
    ...(record.examMinutes ? { examMinutes: record.examMinutes } : {}),
  };
}

/**
 * Group cloud rows by their original plugin id. The manifest is synthetic:
 * cloud decks have no entry module, content glob or custom question types.
 */
export function buildCloudPlugins(records: readonly UserDeck[]): LoadedPlugin[] {
  const groups = new Map<string, { manifest: PluginManifest; decks: Deck[] }>();

  for (const record of records) {
    const deck = userDeckToDeck(record);
    const existing = groups.get(record.pluginId);
    if (existing) {
      existing.decks.push(deck);
      for (const tag of record.tags) {
        if (!existing.manifest.tags.includes(tag)) existing.manifest.tags.push(tag);
      }
      continue;
    }
    groups.set(record.pluginId, {
      manifest: {
        schemaVersion: 1,
        id: record.pluginId,
        name: record.title,
        version: '1.0.0',
        ...(record.description ? { description: record.description } : {}),
        tags: [...record.tags],
        content: [],
        questionTypes: [],
      },
      decks: [deck],
    });
  }

  return [...groups.values()].map(({ manifest, decks }) => ({
    dir: `cloud:${manifest.id}`,
    manifest,
    decks: [...decks].sort((a, b) => a.key.localeCompare(b.key)),
    module: null,
    entryUrl: null,
    issues: [],
  }));
}
