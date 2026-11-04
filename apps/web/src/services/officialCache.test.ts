import { describe, expect, it } from 'vitest';
import { adaptDeck, parseManifest, type LoadedPlugin } from '@mengyin/plugin-sdk';
import {
  cacheToLoadedPlugins,
  parseOfficialCache,
  readOfficialCache,
  writeOfficialCache,
  type OfficialCache,
} from './officialCache';

const manifest = parseManifest({
  schemaVersion: 1,
  id: 'mengyin.official.math',
  name: 'Official Maths',
  version: '1.0.0',
  tags: ['Maths'],
  content: [],
});
if (!manifest.ok) throw new Error('test manifest must parse');
const manifestValue = manifest.value;

const deck = adaptDeck('mengyin.official.math', {
  id: 'basics',
  title: 'Basics',
  tags: ['Numbers'],
  examMinutes: 18,
  questions: [
    {
      id: 'q1',
      type: 'single',
      prompt: 'Pick two',
      options: [
        { id: 'a', text: '1' },
        { id: 'b', text: '2' },
      ],
      answer: { kind: 'single', optionId: 'b' },
      tags: [],
      difficulty: 1,
    },
  ],
});

function cache(): OfficialCache {
  return {
    schemaVersion: 1,
    sourceUrl: 'https://example.supabase.co',
    version: '12',
    syncedAt: 1_700_000_000_000,
    packs: [
      {
        manifest: manifestValue,
        decks: [deck],
        updatedAt: '2026-11-03T00:00:00.000Z',
      },
    ],
  };
}

function memoryStore() {
  const data = new Map<string, unknown>();
  return {
    kind: 'memory' as const,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
    },
    async remove(key: string) {
      data.delete(key);
    },
  };
}

describe('official cache', () => {
  it('round-trips through a key-value store and revalidates the deck', async () => {
    const store = memoryStore();
    await writeOfficialCache(cache(), store);
    const loaded = await readOfficialCache(store);
    expect(loaded?.version).toBe('12');
    expect(loaded?.sourceUrl).toBe('https://example.supabase.co');
    expect(loaded?.packs[0]?.decks[0]?.key).toBe('mengyin.official.math::basics');
    expect(loaded?.packs[0]?.decks[0]?.examMinutes).toBe(18);
    expect(loaded?.packs[0]?.manifest.content).toEqual([]);
  });

  it('rejects a cache written by an incompatible schema version', () => {
    expect(parseOfficialCache({ ...cache(), schemaVersion: 2 })).toBeNull();
  });

  it('rejects a cache with an invalid deck instead of returning partial data', () => {
    const base = cache();
    const pack = base.packs[0];
    if (!pack) throw new Error('test cache must have a pack');
    const broken = {
      ...base,
      packs: [
        {
          ...pack,
          decks: [{ id: 'broken', title: 'Broken', questions: [] }],
        },
      ],
    };
    expect(parseOfficialCache(broken)).toBeNull();
  });

  it('turns cached packs into loaded plugins for the app state', () => {
    const [plugin] = cacheToLoadedPlugins(cache()) as LoadedPlugin[];
    expect(plugin?.dir).toBe('official:mengyin.official.math');
    expect(plugin?.module).toBeNull();
    expect(plugin?.decks[0]?.key).toBe('mengyin.official.math::basics');
  });
});
