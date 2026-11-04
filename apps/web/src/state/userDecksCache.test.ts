import { describe, expect, it } from 'vitest';
import type { UserDeck } from '@/services/types';
import { isCachedDeck, userDeckFingerprint } from './UserDecksContext';

function deck(overrides: Partial<UserDeck> = {}): UserDeck {
  return {
    id: 'row-1',
    clientKey: 'ai.test::d1',
    pluginId: 'ai.test',
    deckId: 'd1',
    title: 'Test deck',
    description: null,
    tags: ['Test'],
    examMinutes: null,
    entrySource: null,
    questions: [
      {
        id: 'q1',
        type: 'single',
        prompt: 'Which option is correct?',
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        answer: { kind: 'single', optionId: 'a' },
        tags: ['Test'],
        difficulty: 1,
      },
    ],
    createdAt: '2026-11-04T00:00:00.000Z',
    updatedAt: '2026-11-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('cloud deck cache', () => {
  it('uses an order-independent fingerprint', () => {
    const first = deck();
    const second = deck({ id: 'row-2', clientKey: 'ai.test::d2', deckId: 'd2' });
    expect(userDeckFingerprint([first, second])).toBe(userDeckFingerprint([second, first]));
    expect(userDeckFingerprint([first])).not.toBe(
      userDeckFingerprint([{ ...first, updatedAt: '2026-11-04T00:00:01.000Z' }]),
    );
  });

  it('rejects a cache entry whose client key does not match its ids', () => {
    expect(isCachedDeck(deck())).toBe(true);
    expect(isCachedDeck(deck({ clientKey: 'ai.other::d1' }))).toBe(false);
  });

  it('rejects a cache entry with an invalid question', () => {
    expect(
      isCachedDeck(
        deck({
          questions: [
            {
              id: 'q1',
              type: 'single',
              prompt: 'Broken',
              options: [{ id: 'a', text: 'A' }],
              answer: { kind: 'single', optionId: 'z' },
              tags: ['Test'],
              difficulty: 1,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});
