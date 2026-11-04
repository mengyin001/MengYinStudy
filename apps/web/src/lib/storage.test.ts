import { describe, expect, it } from 'vitest';
import { runStorageMigrations, STORAGE_KEYS, type KeyValueStore } from './storage';

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    kind: 'memory',
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

describe('storage migrations', () => {
  it('clears local decks and the official cache once, preserving progress', async () => {
    const store = memoryStore();
    await store.set(STORAGE_KEYS.progress, { attempts: 3 });
    await store.set(STORAGE_KEYS.localPlugins, [{ id: 'local.old' }]);
    await store.set(STORAGE_KEYS.officialContent, { version: 1 });

    await runStorageMigrations(store);

    expect(await store.get(STORAGE_KEYS.progress)).toEqual({ attempts: 3 });
    expect(await store.get(STORAGE_KEYS.localPlugins)).toBeUndefined();
    expect(await store.get(STORAGE_KEYS.officialContent)).toBeUndefined();
    expect(await store.get(STORAGE_KEYS.storageMigrations)).toBe(true);

    // After the marker is set, new imports are not removed on the next boot.
    await store.set(STORAGE_KEYS.localPlugins, [{ id: 'local.new' }]);
    await runStorageMigrations(store);
    expect(await store.get(STORAGE_KEYS.localPlugins)).toEqual([{ id: 'local.new' }]);
  });
});
