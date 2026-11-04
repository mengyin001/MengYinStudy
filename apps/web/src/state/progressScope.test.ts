import { describe, expect, it } from 'vitest';
import { emptyProgress, type Locale, type ProgressState } from '@mengyin/core';
import { STORAGE_KEYS, type KeyValueStore } from '@/lib/storage';
import {
  hasLearningRecord,
  loadScopeProgress,
  progressKey,
  progressScopeFor,
  sameProgressScope,
  saveScopeProgress,
} from './progressScope';

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

function record(attemptCount: number, locale: Locale = 'en'): ProgressState {
  const progress = emptyProgress(1_700_000_000_000);
  return {
    ...progress,
    attempts: Array.from({ length: attemptCount }, (_, index) => ({
      id: `attempt-${index}`,
      questionKey: `deck::q${index}`,
      questionId: `q${index}`,
      deckKey: 'deck',
      pluginId: 'plugin',
      sessionId: 'session',
      mode: 'practice' as const,
      at: 1_700_000_000_000 + index,
      msSpent: 1000,
      status: 'correct' as const,
      ratio: 1,
      skipped: false,
    })),
    settings: { ...progress.settings, locale },
  };
}

const guest = progressScopeFor(null);
const alice = progressScopeFor('user-alice');
const bob = progressScopeFor('user-bob');

describe('progress scopes', () => {
  it('keeps one key per identity', () => {
    expect(progressKey(guest)).toBe('progress:v2:guest');
    expect(progressKey(alice)).toBe('progress:v2:user:user-alice');
    expect(sameProgressScope(alice, progressScopeFor('user-alice'))).toBe(true);
    expect(sameProgressScope(alice, guest)).toBe(false);
    expect(hasLearningRecord(record(1))).toBe(true);
    expect(hasLearningRecord(emptyProgress())).toBe(false);
    expect(hasLearningRecord({ ...emptyProgress(), epoch: 1 })).toBe(true);
    expect(hasLearningRecord({ ...emptyProgress(), settings: { ...emptyProgress().settings, locale: 'zh-Hant' } })).toBe(
      false,
    );
  });

  it('never lets a guest read the shared legacy record history', async () => {
    const store = memoryStore();
    await store.set(STORAGE_KEYS.progress, record(30, 'zh-Hant'));

    const loaded = await loadScopeProgress(store, guest);

    expect(loaded.attempts).toHaveLength(0);
    // Appearance still carries over, so signing out does not reset the language.
    expect(loaded.settings.locale).toBe('zh-Hant');
    expect(await store.get(STORAGE_KEYS.progress)).toBeDefined();
  });

  it('gives the shared legacy history to the first account that signs in', async () => {
    const store = memoryStore();
    await store.set(STORAGE_KEYS.progress, record(30));

    const adopted = await loadScopeProgress(store, alice);

    expect(adopted.attempts).toHaveLength(30);
    expect(await store.get(STORAGE_KEYS.progress)).toBeUndefined();
    expect((await loadScopeProgress(store, alice)).attempts).toHaveLength(30);
    // A second account on the same browser starts empty.
    expect((await loadScopeProgress(store, bob)).attempts).toHaveLength(0);
  });

  it("does not show one account the other account's record", async () => {
    const store = memoryStore();
    await saveScopeProgress(store, alice, record(5));

    expect((await loadScopeProgress(store, alice)).attempts).toHaveLength(5);
    expect((await loadScopeProgress(store, bob)).attempts).toHaveLength(0);
    expect((await loadScopeProgress(store, guest)).attempts).toHaveLength(0);
  });

  it('adopts guest practice into a new account and clears the guest record', async () => {
    const store = memoryStore();
    await saveScopeProgress(store, guest, record(4));

    const adopted = await loadScopeProgress(store, alice);
    expect(adopted.attempts).toHaveLength(4);

    const afterSignOut = await loadScopeProgress(store, guest);
    expect(afterSignOut.attempts).toHaveLength(0);
    expect(hasLearningRecord(afterSignOut)).toBe(false);
  });

  it('still adopts guest practice when the account only has saved settings', async () => {
    const store = memoryStore();
    await saveScopeProgress(store, alice, {
      ...emptyProgress(),
      settings: { ...emptyProgress().settings, locale: 'zh-Hant' },
    });
    await saveScopeProgress(store, guest, record(2));

    const adopted = await loadScopeProgress(store, alice);
    expect(adopted.attempts).toHaveLength(2);
    // The account's own appearance wins over the guest record's.
    expect(adopted.settings.locale).toBe('zh-Hant');
  });
});
