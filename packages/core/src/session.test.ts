import { describe, expect, it } from 'vitest';
import {
  MAX_REQUEUES,
  addTime,
  advance,
  createSession,
  finishSession,
  gradeSession,
  progressOf,
  setDraftAnswer,
  skipCurrent,
  submitAnswer,
  summarize,
} from './session';
import type { Deck, QuestionEntry } from './types';

const deck: Deck = {
  key: 'demo::deck',
  id: 'deck',
  pluginId: 'demo',
  title: 'Deck',
  tags: [],
  questions: [
    {
      id: 'a',
      type: 'single',
      prompt: 'A?',
      options: [
        { id: 'x', text: 'x' },
        { id: 'y', text: 'y' },
      ],
      answer: { kind: 'single', optionId: 'x' },
      tags: ['t1'],
      difficulty: 1,
    },
    {
      id: 'b',
      type: 'boolean',
      prompt: 'B?',
      answer: { kind: 'boolean', value: true },
      tags: ['t1', 't2'],
      difficulty: 2,
    },
  ],
};

const entries: QuestionEntry[] = deck.questions.map((question) => ({
  deck,
  question,
  key: `${deck.key}#${question.id}`,
}));

describe('createSession', () => {
  it('applies the limit', () => {
    const session = createSession({ mode: 'practice', entries, limit: 1 });
    expect(session.items).toHaveLength(1);
    expect(session.mode).toBe('practice');
    expect(session.reveal).toBe(true);
  });

  it('keeps order when shuffle is disabled', () => {
    const session = createSession({ mode: 'practice', entries, shuffle: false });
    expect(session.items.map((item) => item.entry.question.id)).toEqual(['a', 'b']);
  });

  it('hides feedback in exam mode', () => {
    const session = createSession({ mode: 'exam', entries, timeLimitMs: 60_000 });
    expect(session.reveal).toBe(false);
    expect(session.timeLimitMs).toBe(60_000);
  });
});

describe('session flow', () => {
  it('grades, advances and summarises', () => {
    let session = createSession({ mode: 'practice', entries, shuffle: false });
    session = submitAnswer(session, { kind: 'single', optionId: 'x' }, 1000);
    expect(session.items[0]?.result?.status).toBe('correct');
    session = advance(session);
    expect(session.index).toBe(1);
    session = submitAnswer(session, { kind: 'boolean', value: false }, 2000);
    expect(session.items[1]?.result?.status).toBe('incorrect');
    session = advance(session);

    expect(session.finished).toBe(true);
    const summary = summarize(session);
    expect(summary.total).toBe(2);
    expect(summary.correct).toBe(1);
    expect(summary.incorrect).toBe(1);
    expect(summary.score).toBe(50);
    expect(summary.byTag.t1?.attempts).toBe(2);
  });

  it('marks unanswered items as skipped when finishing early', () => {
    let session = createSession({ mode: 'exam', entries, shuffle: false });
    session = finishSession(session, Date.now());
    const summary = summarize(session);
    expect(summary.skipped).toBe(2);
    expect(summary.score).toBe(0);
    expect(progressOf(session).answered).toBe(0);
  });

  it('does not double grade an answered item', () => {
    let session = createSession({ mode: 'practice', entries, shuffle: false });
    session = submitAnswer(session, { kind: 'single', optionId: 'y' }, 10);
    const graded = session;
    session = submitAnswer(session, { kind: 'single', optionId: 'x' }, 10);
    expect(session.items[0]?.result?.status).toBe('incorrect');
    expect(session).toEqual(graded);
  });
});

describe('answer streak', () => {
  it('counts a run and keeps the best after a miss', () => {
    let session = createSession({ mode: 'practice', entries, shuffle: false });
    expect(session.answerStreak).toBe(0);
    expect(session.bestAnswerStreak).toBe(0);

    session = submitAnswer(session, { kind: 'single', optionId: 'x' }, 10);
    expect(session.answerStreak).toBe(1);
    session = advance(session);
    session = submitAnswer(session, { kind: 'boolean', value: false }, 10);
    expect(session.answerStreak).toBe(0);
    expect(session.bestAnswerStreak).toBe(1);

    expect(summarize(session).bestAnswerStreak).toBe(1);
  });

  it('resets the run when a question is skipped', () => {
    let session = createSession({ mode: 'practice', entries, shuffle: false });
    session = submitAnswer(session, { kind: 'single', optionId: 'x' }, 10);
    session = advance(session);
    session = skipCurrent(session, 10);
    expect(session.answerStreak).toBe(0);
    expect(session.bestAnswerStreak).toBe(1);
  });

  it('keeps exams out of the streak', () => {
    let session = createSession({ mode: 'exam', entries, shuffle: false });
    session = setDraftAnswer(session, 0, { kind: 'single', optionId: 'x' });
    session = setDraftAnswer(session, 1, { kind: 'boolean', value: true });
    session = gradeSession(session);
    expect(session.answerStreak).toBe(0);
    expect(session.bestAnswerStreak).toBe(0);
    expect(summarize(session).bestAnswerStreak).toBe(0);
  });
});

describe('drill mode', () => {
  it('re-queues a missed question at the end of the queue', () => {
    let session = createSession({ mode: 'drill', entries, shuffle: false, requeueMissed: true });
    expect(session.requeueMissed).toBe(true);
    expect(session.reveal).toBe(true);

    session = submitAnswer(session, { kind: 'single', optionId: 'y' }, 10);
    session = advance(session);
    expect(session.items).toHaveLength(3);
    expect(session.index).toBe(1);
    expect(session.items[0]?.entry.question.id).toBe('a');
    expect(session.items[2]?.entry.question.id).toBe('a');
    expect(session.items[2]?.result).toBeNull();
    expect(session.items[2]?.requeued).toBe(1);
  });

  it('does not re-queue a correct answer', () => {
    let session = createSession({ mode: 'drill', entries, shuffle: false, requeueMissed: true });
    session = submitAnswer(session, { kind: 'single', optionId: 'x' }, 10);
    session = advance(session);
    expect(session.items).toHaveLength(2);
    expect(session.index).toBe(1);
  });

  it('stops re-queueing after the cap', () => {
    let session = createSession({ mode: 'drill', entries: entries.slice(0, 1), requeueMissed: true, shuffle: false });
    for (let round = 0; round < MAX_REQUEUES + 2; round += 1) {
      session = submitAnswer(session, { kind: 'single', optionId: 'y' }, 5);
      session = advance(session);
    }
    expect(session.finished).toBe(true);
    expect(session.items.length).toBeLessThanOrEqual(1 + MAX_REQUEUES);
  });

  it('practice mode never re-queues', () => {
    let session = createSession({ mode: 'practice', entries, shuffle: false });
    session = submitAnswer(session, { kind: 'single', optionId: 'y' }, 10);
    session = advance(session);
    expect(session.items).toHaveLength(2);
  });
});

describe('exam drafts', () => {
  it('stores and replaces draft answers without grading', () => {
    let session = createSession({ mode: 'exam', entries, shuffle: false });
    session = setDraftAnswer(session, 0, { kind: 'single', optionId: 'y' });
    expect(session.items[0]?.answer).toEqual({ kind: 'single', optionId: 'y' });
    expect(session.items[0]?.result).toBeNull();

    session = setDraftAnswer(session, 0, { kind: 'single', optionId: 'x' });
    expect(session.items[0]?.answer).toEqual({ kind: 'single', optionId: 'x' });
    expect(session.items[0]?.result).toBeNull();
  });

  it('accumulates time per question', () => {
    let session = createSession({ mode: 'exam', entries, shuffle: false });
    session = addTime(session, 0, 1200);
    session = addTime(session, 0, 800);
    expect(session.items[0]?.msSpent).toBe(2000);
    expect(session.items[1]?.msSpent).toBe(0);
  });

  it('grades every draft at submission and skips blanks', () => {
    let session = createSession({ mode: 'exam', entries, shuffle: false });
    session = setDraftAnswer(session, 0, { kind: 'single', optionId: 'x' });
    session = gradeSession(session);

    expect(session.finished).toBe(true);
    expect(session.items[0]?.result?.status).toBe('correct');
    expect(session.items[1]?.skipped).toBe(true);

    const summary = summarize(session);
    expect(summary.correct).toBe(1);
    expect(summary.skipped).toBe(1);
  });

  it('keeps an ungraded short answer as skipped', () => {
    const base = entries[0]!;
    const shortEntry = {
      ...base,
      key: `${base.key}-short`,
      question: {
        ...base.question,
        id: 'short-1',
        type: 'short',
        answer: { kind: 'short' as const, model: 'model' },
      },
    };
    let session = createSession({ mode: 'exam', entries: [shortEntry], shuffle: false });
    session = setDraftAnswer(session, 0, { kind: 'short', value: 'answer', selfGrade: null });
    session = gradeSession(session);
    expect(session.items[0]?.skipped).toBe(true);
  });
});
