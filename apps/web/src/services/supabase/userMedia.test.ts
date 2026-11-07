import { describe, expect, it } from 'vitest';
import type { FigureSpec, Question, QuestionMedia } from '@mengyin/core';
import { sha256Hex } from '@/lib/hash';
import {
  collectUserMediaPaths,
  createSupabaseUserMediaService,
  hasEmbeddedMedia,
  isUserMediaSrc,
  prepareQuestionsForStorage,
  storageMarker,
  userMediaPath,
} from './userMedia';
import type { SupabaseClientLike } from './client';

function imageSrc(media: QuestionMedia | undefined): string | undefined {
  return media?.type === 'image' ? media.src : undefined;
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    type: 'single',
    prompt: 'Pick one',
    options: [{ id: 'a', text: 'A' }],
    answer: { kind: 'single', optionId: 'a' },
    tags: [],
    difficulty: 2,
    ...overrides,
  };
}

describe('user media references', () => {
  it('recognises only our storage marker', () => {
    expect(isUserMediaSrc(storageMarker('user/deck/q1.png'))).toBe(true);
    expect(isUserMediaSrc('data:image/png;base64,abc')).toBe(false);
    expect(isUserMediaSrc('https://example.test/image.png')).toBe(false);
    expect(userMediaPath(storageMarker('user/deck/q1.png'))).toBe('user/deck/q1.png');
    expect(userMediaPath('storage:')).toBeNull();
    expect(userMediaPath('storage:/absolute.png')).toBeNull();
  });

  it('collects question and option images without duplicates', () => {
    const paths = collectUserMediaPaths([
      question({
        media: [{ type: 'image', src: storageMarker('u/d/q1.png') }],
        options: [
          { id: 'a', text: 'A', media: [{ type: 'image', src: storageMarker('u/d/o1.png') }] },
          { id: 'b', text: 'B', media: [{ type: 'image', src: storageMarker('u/d/q1.png') }] },
        ],
      }),
      question({ id: 'q2', media: [{ type: 'image', src: 'data:image/png;base64,abc' }] }),
    ]);
    expect(paths.sort()).toEqual(['u/d/o1.png', 'u/d/q1.png']);
  });

  it('detects a deck that can still be re-uploaded from inline images', () => {
    expect(hasEmbeddedMedia([question({ media: [{ type: 'image', src: 'data:image/png;base64,ab' }] })])).toBe(
      true,
    );
    expect(
      hasEmbeddedMedia([
        question({ options: [{ id: 'a', text: 'A', media: [{ type: 'image', src: '<svg></svg>' }] }] }),
      ]),
    ).toBe(true);
    expect(hasEmbeddedMedia([question({ media: [{ type: 'image', src: storageMarker('u/d/q1.png') }] })])).toBe(
      false,
    );
    expect(hasEmbeddedMedia([question({ media: [{ type: 'image', src: 'https://x.test/a.png' }] })])).toBe(
      false,
    );
  });

  it('reads the combined deck and image usage', async () => {
    const client = {
      rpc: async () => ({
        data: { bytes: 100, deckBytes: 40, storageBytes: 60, limit: 300 },
        error: null,
      }),
    } as unknown as SupabaseClientLike;

    await expect(createSupabaseUserMediaService(client).usage()).resolves.toEqual({
      bytes: 100,
      deckBytes: 40,
      storageBytes: 60,
      limit: 300,
    });
  });

  it('uploads data URLs and replaces them with stable markers', async () => {
    const uploads: string[] = [];
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploads.push(path);
            return { data: { path }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    const prepared = await prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
      question({
        media: [{ type: 'image', src: 'data:image/png;base64,AAAA' }],
        options: [
          { id: 'a', text: 'A', media: [{ type: 'image', src: 'data:image/png;base64,AAAA' }] },
        ],
      }),
    ]);

    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toMatch(/^user-1\/deck-1\/q1-q0-[0-9a-f]{8}\.png$/);
    expect(imageSrc(prepared.questions[0]?.media?.[0])).toBe(storageMarker(uploads[0]!));
    expect(prepared.paths).toHaveLength(2);
    expect(prepared.uploaded).toEqual(uploads);
  });

  it('accepts raw SVG/XML image payloads and uploads them as image/svg+xml', async () => {
    const uploads: { path: string; type: string }[] = [];
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string, blob: Blob) => {
            uploads.push({ path, type: blob.type });
            return { data: { path }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    const prepared = await prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
      question({
        media: [
          {
            type: 'image',
            src: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
          },
        ],
      }),
    ]);
    expect(uploads[0]).toMatchObject({ type: 'image/svg+xml' });
    expect(uploads[0]?.path.endsWith('.svg')).toBe(true);
    expect(imageSrc(prepared.questions[0]?.media?.[0])).toMatch(/^storage:/);
  });

  it('removes images uploaded before a later upload fails', async () => {
    const removed: string[] = [];
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            if (path.includes('-o0-')) throw new Error('quota exceeded');
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            removed.push(...paths);
            return { data: [], error: null };
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    await expect(
      prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
        question({
          media: [{ type: 'image', src: 'data:image/png;base64,AAAA' }],
          options: [
            { id: 'a', text: 'A', media: [{ type: 'image', src: 'data:image/png;base64,BBBB' }] },
          ],
        }),
      ]),
    ).rejects.toThrow(/quota/);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/q1-q0/);
  });

  it('leaves existing markers alone instead of uploading again', async () => {
    const client = {
      storage: {
        from: () => ({
          upload: async () => {
            throw new Error('should not upload');
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    const prepared = await prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
      question({ media: [{ type: 'image', src: storageMarker('user-1/deck-1/old.png') }] }),
    ]);
    expect(imageSrc(prepared.questions[0]?.media?.[0])).toBe(storageMarker('user-1/deck-1/old.png'));
    expect(prepared.paths).toEqual(['user-1/deck-1/old.png']);
    expect(prepared.uploaded).toEqual([]);
  });

  it('passes figures through without touching storage', async () => {
    const figure: FigureSpec = {
      v: 1,
      width: 420,
      height: 280,
      coords: 'cartesian',
      x: { min: -2, max: 2 },
      y: { min: -2, max: 2 },
      grid: false,
      elements: [{ kind: 'plot', expr: 'x^2' }],
    };
    const client = {
      storage: {
        from: () => ({
          upload: async () => {
            throw new Error('figures are not uploaded');
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    const prepared = await prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
      question({ media: [{ type: 'figure', figure, alt: '拋物線' }] }),
    ]);
    expect(prepared.questions[0]?.media?.[0]?.type).toBe('figure');
    expect(prepared.paths).toEqual([]);
    expect(prepared.uploaded).toEqual([]);
  });

  it('refuses an attested image whose bytes changed', async () => {
    const client = {
      storage: {
        from: () => ({
          upload: async () => {
            throw new Error('must not upload a modified image');
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    await expect(
      prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
        question({
          media: [
            {
              type: 'image',
              src: 'data:image/png;base64,AAAA',
              digest: 'f'.repeat(64),
              signature: 'sig',
            },
          ],
        }),
      ]),
    ).rejects.toMatchObject({ code: 'invalid-data' });
  });

  it('uploads an attested image byte-for-byte so its digest still matches', async () => {
    const uploaded: Array<{ path: string; size: number; type: string }> = [];
    const client = {
      storage: {
        from: () => ({
          upload: async (path: string, blob: Blob) => {
            uploaded.push({ path, size: blob.size, type: blob.type });
            return { data: { path }, error: null };
          },
        }),
      },
    } as unknown as SupabaseClientLike;

    // "AAAA" decodes to three zero bytes.
    const digest = await sha256Hex(Uint8Array.from([0, 0, 0]));
    const prepared = await prepareQuestionsForStorage(client, 'user-1', 'deck-1', [
      question({
        media: [
          {
            type: 'image',
            src: 'data:image/png;base64,AAAA',
            digest,
            signature: 'sig',
          },
        ],
      }),
    ]);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ size: 3, type: 'image/png' });
    expect(imageSrc(prepared.questions[0]?.media?.[0])).toMatch(/^storage:.*\.png$/);
  });
});
