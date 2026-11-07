import { describe, expect, it } from 'vitest';
import { WAITING_MESSAGE_KEYS, waitingMessageKey } from './progress';

describe('waiting message rotation', () => {
  it('starts on the first message and changes every nine seconds', () => {
    expect(waitingMessageKey(0)).toBe('gen.wait1');
    expect(waitingMessageKey(8)).toBe('gen.wait1');
    expect(waitingMessageKey(9)).toBe('gen.wait2');
    expect(waitingMessageKey(17)).toBe('gen.wait2');
    expect(waitingMessageKey(18)).toBe('gen.wait3');
  });

  it('cycles through every message', () => {
    const seen = new Set<string>();
    for (let index = 0; index < WAITING_MESSAGE_KEYS.length; index += 1) {
      seen.add(waitingMessageKey(index * 9));
    }
    expect([...seen]).toEqual([...WAITING_MESSAGE_KEYS]);
    expect(waitingMessageKey(WAITING_MESSAGE_KEYS.length * 9)).toBe('gen.wait1');
  });

  it('handles nonsense elapsed values', () => {
    expect(waitingMessageKey(-5)).toBe('gen.wait1');
    expect(waitingMessageKey(Number.NaN)).toBe('gen.wait1');
    expect(waitingMessageKey(Number.POSITIVE_INFINITY)).toBe('gen.wait1');
  });
});
