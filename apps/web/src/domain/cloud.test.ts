import { describe, expect, it } from 'vitest';
import { buildCloudPlugins, userDeckToDeck } from './cloud';
import type { UserDeck } from '@/services/types';

function cloudDeck(overrides: Partial<UserDeck> = {}): UserDeck {
  return {
    id: 'row-1',
    clientKey: 'ai.numbers::basics',
    pluginId: 'ai.numbers',
    deckId: 'basics',
    title: 'Numbers',
    description: 'A private deck',
    tags: ['Numbers'],
    examMinutes: null,
    entrySource: null,
    questions: [
      {
        id: 'q1',
        type: 'single',
        prompt: 'Which number is even?',
        options: [
          { id: 'a', text: '3' },
          { id: 'b', text: '4' },
        ],
        answer: { kind: 'single', optionId: 'b' },
        tags: ['Numbers'],
        difficulty: 1,
      },
    ],
    createdAt: '2026-11-03T00:00:00.000Z',
    updatedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('cloud deck views', () => {
  it('keeps the original deck key and groups rows by plugin', () => {
    const plugins = buildCloudPlugins([cloudDeck(), cloudDeck({ id: 'row-2', deckId: 'extra', clientKey: 'ai.numbers::extra', title: 'Extra' })]);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.manifest.id).toBe('ai.numbers');
    expect(plugins[0]?.decks.map((deck) => deck.key)).toEqual([
      'ai.numbers::basics',
      'ai.numbers::extra',
    ]);
  });

  it('turns a row into the same Deck shape used locally', () => {
    const deck = userDeckToDeck(cloudDeck({ examMinutes: 18 }));
    expect(deck).toMatchObject({
      key: 'ai.numbers::basics',
      pluginId: 'ai.numbers',
      id: 'basics',
      title: 'Numbers',
      examMinutes: 18,
    });
  });
});
