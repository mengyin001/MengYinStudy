import { describe, expect, it } from 'vitest';
import type { AiMaterial } from './types';
import {
  buildChunks,
  chunkText,
  queryTerms,
  scoreChunk,
  selectChunksForBatch,
} from './chunks';

function material(id: string, text: string, name = `${id}.txt`): AiMaterial {
  return {
    id,
    name,
    size: text.length,
    kind: 'text',
    chars: text.length,
    truncated: false,
    addedAt: 1,
    text,
  };
}

const LONG = Array.from({ length: 60 }, (_, index) => `Paragraph ${index} about recursion and trees.`).join(
  '\n\n',
);

describe('chunkText', () => {
  it('splits long text into overlapping prose-sized chunks', () => {
    const chunks = chunkText(LONG, 400, 40);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
    expect(chunks.join(' ')).toContain('Paragraph 59');
  });

  it('returns one chunk for short text and none for blank text', () => {
    expect(chunkText('Short notes about arrays.')).toEqual(['Short notes about arrays.']);
    expect(chunkText('   ')).toEqual([]);
  });

  it('keeps every chunk non-empty and under the cap', () => {
    const chunks = chunkText('x'.repeat(5000), 1000, 100);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 1000)).toBe(true);
  });
});

describe('chunk selection', () => {
  const chunks = buildChunks([
    material('a', `Binary search halves the range.\n\n${LONG}`),
    material('b', `Recursion needs a base case.\n\n${LONG}`),
  ]);

  it('scores the topic and extracts CJK bigrams', () => {
    const terms = queryTerms('遞迴 recursion');
    expect(terms).toContain('recursion');
    expect(terms).toContain('遞迴');
    expect(scoreChunk('recursion recursion', ['recursion'])).toBe(2);
  });

  it('respects the character budget', () => {
    const selected = selectChunksForBatch(chunks, {
      batchIndex: 0,
      batches: 2,
      maxChars: 900,
      topic: 'recursion',
    });
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.reduce((sum, chunk) => sum + chunk.text.length, 0)).toBeLessThanOrEqual(900);
  });

  it('starts each batch at a different window', () => {
    const first = selectChunksForBatch(chunks, { batchIndex: 0, batches: 3, maxChars: 800, topic: 'trees' });
    const second = selectChunksForBatch(chunks, { batchIndex: 1, batches: 3, maxChars: 800, topic: 'trees' });
    expect(first.map((chunk) => chunk.id)).not.toEqual(second.map((chunk) => chunk.id));
  });

  it('returns everything when it fits in one call', () => {
    const small = buildChunks([material('c', 'Tiny note on stacks.')]);
    const selected = selectChunksForBatch(small, {
      batchIndex: 0,
      batches: 1,
      maxChars: 14_000,
      topic: 'stacks',
    });
    expect(selected).toHaveLength(1);
  });
});
