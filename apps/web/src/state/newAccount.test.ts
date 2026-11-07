import { describe, expect, it } from 'vitest';
import {
  forgetNewAccount,
  isFreshAccount,
  rememberedNewAccount,
  rememberNewAccount,
  type NewAccountStorage,
} from './newAccount';

const DAY = 24 * 60 * 60_000;

function memoryStorage(): NewAccountStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('new-account markers', () => {
  it('remembers a sign-up on this browser until it is consumed', () => {
    const storage = memoryStorage();
    const now = Date.parse('2026-11-05T12:00:00.000Z');

    rememberNewAccount('user-alice', storage, now);

    expect(rememberedNewAccount('user-alice', storage, now + 1_000)).toBe(true);
    expect(rememberedNewAccount('user-bob', storage, now)).toBe(false);
    forgetNewAccount('user-alice', storage);
    expect(rememberedNewAccount('user-alice', storage, now)).toBe(false);
  });

  it('expires a marker after a week and ignores corrupt values', () => {
    const storage = memoryStorage();
    const now = Date.parse('2026-11-05T12:00:00.000Z');
    rememberNewAccount('user-alice', storage, now);
    expect(rememberedNewAccount('user-alice', storage, now + 8 * DAY)).toBe(false);

    storage.setItem('mengyin:new-account:user-bob', 'not-a-time');
    expect(rememberedNewAccount('user-bob', storage, now)).toBe(false);
  });

  it('tolerates blocked storage without throwing', () => {
    const blocked: NewAccountStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };

    expect(() => rememberNewAccount('user-alice', blocked)).not.toThrow();
    expect(() => forgetNewAccount('user-alice', blocked)).not.toThrow();
    expect(rememberedNewAccount('user-alice', blocked)).toBe(false);
    expect(rememberedNewAccount('user-alice', null)).toBe(false);
  });
});

describe('OAuth first sign-in', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');

  it('accepts an account created moments ago', () => {
    expect(isFreshAccount({ createdAt: new Date(now - 5_000).toISOString() }, now)).toBe(true);
  });

  it('rejects an existing account', () => {
    expect(isFreshAccount({ createdAt: new Date(now - 2 * DAY).toISOString() }, now)).toBe(false);
  });

  it('rejects missing or unparseable timestamps', () => {
    expect(isFreshAccount({ createdAt: null }, now)).toBe(false);
    expect(isFreshAccount({ createdAt: 'yesterday' }, now)).toBe(false);
  });
});
