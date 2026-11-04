import { describe, expect, it } from 'vitest';
import { emptyProgress, type Attempt, type ProgressState } from '@mengyin/core';
import { migrateKey, migrateLegacyProgress } from './legacy';

function attempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: 'a1',
    questionKey: 'cityu.demo.cs::complexity#q1',
    questionId: 'q1',
    deckKey: 'cityu.demo.cs::complexity',
    pluginId: 'cityu.demo.cs',
    sessionId: 's1',
    mode: 'practice',
    at: 1,
    msSpent: 1000,
    status: 'correct',
    ratio: 1,
    skipped: false,
    ...overrides,
  };
}

function legacyProgress(): ProgressState {
  return {
    ...emptyProgress(1),
    attempts: [attempt()],
    cards: {
      'cityu.demo.cs::complexity#q1': {
        reps: 1,
        lapses: 0,
        ease: 2.5,
        intervalDays: 1,
        dueAt: 2,
        lastAt: 1,
        lastGrade: 1,
      },
    },
    flags: { 'cityu.demo.cs::complexity#q1': true },
    notes: { 'cityu.demo.cs::complexity#q1': 'stored note' },
    sessions: [
      {
        id: 's1',
        mode: 'practice',
        label: 'Practice',
        deckKeys: ['cityu.demo.cs::complexity'],
        startedAt: 1,
        endedAt: 2,
        total: 1,
        correct: 1,
        partial: 0,
        incorrect: 0,
        skipped: 0,
        score: 1,
        msSpent: 1000,
        byTag: {},
      },
    ],
  };
}

describe('legacy remap', () => {
  it('rewrites only the renamed demo plugin prefix', () => {
    expect(migrateKey('cityu.demo.cs::complexity#q1')).toBe('mengyin.demo.cs::complexity#q1');
    expect(migrateKey('cityu.demo.psychology')).toBe('mengyin.demo.psychology');
    expect(migrateKey('demo.numeric::basics#q1')).toBe('demo.numeric::basics#q1');
    expect(migrateKey('ai.json-week1::generated#q1')).toBe('ai.json-week1::generated#q1');
    expect(migrateKey('hk.cityu.calculus::week1#q1')).toBe('hk.cityu.calculus::week1#q1');
  });

  it('keeps attempts, cards, flags, notes and sessions attached to the renamed decks', () => {
    const migrated = migrateLegacyProgress(legacyProgress());

    expect(migrated.attempts[0]).toMatchObject({
      questionKey: 'mengyin.demo.cs::complexity#q1',
      deckKey: 'mengyin.demo.cs::complexity',
      pluginId: 'mengyin.demo.cs',
    });
    expect(migrated.cards['mengyin.demo.cs::complexity#q1']).toBeDefined();
    expect(migrated.flags['mengyin.demo.cs::complexity#q1']).toBe(true);
    expect(migrated.notes['mengyin.demo.cs::complexity#q1']).toBe('stored note');
    expect(migrated.sessions[0]?.deckKeys).toEqual(['mengyin.demo.cs::complexity']);
  });

  it('returns the same object when nothing needs migrating', () => {
    const current: ProgressState = {
      ...emptyProgress(1),
      attempts: [
        attempt({
          questionKey: 'demo.numeric::basics#q1',
          deckKey: 'demo.numeric::basics',
          pluginId: 'demo.numeric',
        }),
      ],
    };
    expect(migrateLegacyProgress(current)).toBe(current);
    expect(migrateLegacyProgress(emptyProgress(1))).toEqual(emptyProgress(1));
  });
});
