import { describe, expect, it } from 'vitest';
import { emptyProgress, type Attempt, type CardState, type ProgressState } from './index';
import { learningFingerprint, mergeProgress } from './sync';

function attempt(id: string, at: number): Attempt {
  return {
    id,
    questionKey: `deck::${id}`,
    questionId: id,
    deckKey: 'deck',
    pluginId: 'plugin',
    sessionId: 'session',
    mode: 'practice',
    at,
    msSpent: 1000,
    status: 'correct',
    ratio: 1,
    skipped: false,
  };
}

function card(lastAt: number, reps: number): CardState {
  return { reps, lapses: 0, ease: 2.5, intervalDays: 1, dueAt: lastAt + 86_400_000, lastAt, lastGrade: 4 };
}

function withAttempts(...ids: string[]): ProgressState {
  return {
    ...emptyProgress(1),
    attempts: ids.map((id, index) => attempt(id, 1000 + index)),
  };
}

describe('progress merge', () => {
  it('unions attempts and sessions by id', () => {
    const left = withAttempts('a', 'b');
    const right = withAttempts('b', 'c');
    right.sessions = [
      {
        id: 's2',
        mode: 'practice',
        label: 'B',
        deckKeys: ['deck'],
        startedAt: 10,
        endedAt: 20,
        total: 1,
        correct: 1,
        partial: 0,
        incorrect: 0,
        skipped: 0,
        score: 100,
        msSpent: 10,
        byTag: {},
      },
    ];

    const merged = mergeProgress(left, right);

    expect(merged.attempts.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged.sessions.map((item) => item.id)).toEqual(['s2']);
  });

  it('keeps the card with the newest review', () => {
    const left = emptyProgress(1);
    left.cards = { q1: card(100, 1), q2: card(300, 3) };
    const right = emptyProgress(1);
    right.cards = { q1: card(200, 2), q3: card(50, 1) };

    const merged = mergeProgress(left, right);

    expect(merged.cards.q1?.reps).toBe(2);
    expect(merged.cards.q2?.lastAt).toBe(300);
    expect(merged.cards.q3?.lastAt).toBe(50);
  });

  it('lets a newer flag removal win over an older set', () => {
    const right = emptyProgress(1);
    right.flags = { q1: true };
    right.meta.flags = { q1: 100 };

    const left = { ...emptyProgress(1), flags: {}, meta: { flags: { q1: 200 }, notes: {} } };

    expect(mergeProgress(left, right).flags.q1).toBeUndefined();
    expect(mergeProgress(right, left).flags.q1).toBeUndefined();
  });

  it('lets a newer note removal win over an older note', () => {
    const right = emptyProgress(1);
    right.notes = { q1: 'old note' };
    right.meta.notes = { q1: 100 };

    const left = { ...emptyProgress(1), notes: {}, meta: { flags: {}, notes: { q1: 200 } } };

    expect(mergeProgress(left, right).notes.q1).toBeUndefined();
  });

  it('keeps a note written after the removal', () => {
    const right = emptyProgress(1);
    right.notes = { q1: 'new note' };
    right.meta.notes = { q1: 300 };
    const left = { ...emptyProgress(1), notes: {}, meta: { flags: {}, notes: { q1: 200 } } };

    expect(mergeProgress(left, right).notes.q1).toBe('new note');
  });

  it('unions legacy flags that have no stamps', () => {
    const left = emptyProgress(1);
    left.flags = { q1: true };
    const right = emptyProgress(1);
    right.flags = { q2: true };

    expect(mergeProgress(left, right).flags).toEqual({ q1: true, q2: true });
  });

  it('lets a higher epoch replace the learning record', () => {
    const stale = withAttempts('old');
    stale.notes = { q1: 'stale' };
    const reset = { ...emptyProgress(2), epoch: 1, settings: { ...stale.settings, locale: 'zh-Hant' as const } };

    const fromOldDevice = mergeProgress(stale, reset);
    const fromResetDevice = mergeProgress(reset, stale);

    expect(fromOldDevice.attempts).toHaveLength(0);
    expect(fromOldDevice.notes).toEqual({});
    expect(fromOldDevice.epoch).toBe(1);
    expect(fromResetDevice.attempts).toHaveLength(0);
    expect(fromResetDevice.epoch).toBe(1);
  });

  it('keeps local settings and ignores them in the fingerprint', () => {
    const left = emptyProgress(1);
    left.settings = { ...left.settings, locale: 'zh-Hant', theme: 'dark' };
    const right = emptyProgress(1);
    right.settings = { ...right.settings, locale: 'en', theme: 'light' };

    const merged = mergeProgress(left, right);
    expect(merged.settings.locale).toBe('zh-Hant');
    expect(merged.settings.theme).toBe('dark');
    expect(learningFingerprint(left)).toBe(learningFingerprint(right));
  });

  it('fingerprints attempts and epoch but not updatedAt', () => {
    const left = withAttempts('a');
    const right = { ...left, updatedAt: left.updatedAt + 999 };
    expect(learningFingerprint(left)).toBe(learningFingerprint(right));
    expect(learningFingerprint(withAttempts('a', 'b'))).not.toBe(learningFingerprint(left));
    expect(learningFingerprint({ ...left, epoch: 1 })).not.toBe(learningFingerprint(left));
  });

  it('converges on the same note when both sides have the same stamp', () => {
    const left = { ...emptyProgress(1), notes: { q1: 'apple' }, meta: { flags: {}, notes: { q1: 5 } } };
    const right = { ...emptyProgress(1), notes: { q1: 'banana' }, meta: { flags: {}, notes: { q1: 5 } } };

    const a = mergeProgress(left, right).notes.q1;
    const b = mergeProgress(right, left).notes.q1;
    expect(a).toBe(b);
  });
});
