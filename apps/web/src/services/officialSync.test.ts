import { describe, expect, it } from 'vitest';
import { buildOfficialPacks } from './officialSync';
import type { OfficialCatalog, OfficialDeckPayload } from './types';

const question = {
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
};

function deck(overrides: Partial<OfficialDeckPayload> = {}): OfficialDeckPayload {
  return {
    id: 'basics',
    title: 'Basics',
    tags: ['Numbers'],
    questions: [question],
    mediaBaseUrl: null,
    version: '1',
    updatedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  };
}

function catalog(overrides: Partial<OfficialCatalog> = {}): OfficialCatalog {
  return {
    version: '7',
    packs: [
      {
        id: 'mengyin.official.math',
        name: 'Official Maths',
        version: '1.2.0',
        description: 'Number sense',
        author: 'MengYin',
        tags: ['Maths'],
        updatedAt: '2026-11-03T00:00:00.000Z',
        decks: [deck()],
      },
    ],
    ...overrides,
  };
}

describe('buildOfficialPacks', () => {
  it('validates official content with the plugin schema and builds stable deck keys', () => {
    const result = buildOfficialPacks(catalog());
    expect(result.issues).toEqual([]);
    expect(result.packs).toHaveLength(1);
    const pack = result.packs[0];
    expect(pack?.manifest.id).toBe('mengyin.official.math');
    expect(pack?.manifest.content).toEqual([]);
    expect(pack?.decks[0]?.key).toBe('mengyin.official.math::basics');
    expect(pack?.decks[0]?.questions[0]?.prompt).toBe(question.prompt);
    expect(pack?.decks[0]?.examMinutes).toBeUndefined();
  });

  it('carries the official paper length onto the deck', () => {
    const base = catalog().packs[0];
    if (!base) throw new Error('test catalogue must have a pack');
    const result = buildOfficialPacks(
      catalog({ packs: [{ ...base, decks: [deck({ examMinutes: 40 })] }] }),
    );
    expect(result.packs[0]?.decks[0]?.examMinutes).toBe(40);
  });

  it('keeps bilingual deck text from the catalogue', () => {
    const base = catalog().packs[0];
    if (!base) throw new Error('test catalogue must have a pack');
    const result = buildOfficialPacks(
      catalog({
        packs: [
          {
            ...base,
            decks: [
              deck({
                titleI18n: { 'zh-Hant': '指標' },
                descriptionI18n: { 'zh-Hant': '指標入門。' },
                questions: [
                  {
                    ...question,
                    i18n: {
                      prompt: { 'zh-Hant': '哪個數字是偶數？' },
                      options: { a: { 'zh-Hant': '3' }, b: { 'zh-Hant': '4' } },
                    },
                  },
                ],
              }),
            ],
          },
        ],
      }),
    );
    const built = result.packs[0]?.decks[0];
    expect(built?.titleI18n).toEqual({ 'zh-Hant': '指標' });
    expect(built?.descriptionI18n).toEqual({ 'zh-Hant': '指標入門。' });
    expect(built?.questions[0]?.i18n?.prompt).toEqual({ 'zh-Hant': '哪個數字是偶數？' });
  });

  it('resolves relative media against the deck media base URL', () => {
    const result = buildOfficialPacks(
      catalog({
        packs: [
          {
            id: 'mengyin.official.visual',
            name: 'Visual',
            version: '1',
            tags: [],
            updatedAt: '2026-11-03T00:00:00.000Z',
            decks: [
              deck({
                id: 'images',
                mediaBaseUrl: 'https://example.supabase.co/storage/v1/object/public/official-media/p/images/',
                questions: [
                  {
                    ...question,
                    media: [{ type: 'image', src: './assets/chart.svg' }],
                    options: [
                      { id: 'a', text: '3', media: [{ type: 'image', src: 'assets/a.svg' }] },
                      { id: 'b', text: '4' },
                    ],
                  },
                ],
              }),
            ],
          },
        ],
      }),
    );
    const built = result.packs[0]?.decks[0];
    const media = built?.questions[0]?.media?.[0];
    expect(media?.type).toBe('image');
    if (media?.type === 'image') {
      expect(media.src).toBe(
        'https://example.supabase.co/storage/v1/object/public/official-media/p/images/assets/chart.svg',
      );
    }
    const optionMedia = built?.questions[0]?.options?.[0]?.media?.[0];
    expect(optionMedia?.type).toBe('image');
    if (optionMedia?.type === 'image') {
      expect(optionMedia.src).toBe(
        'https://example.supabase.co/storage/v1/object/public/official-media/p/images/assets/a.svg',
      );
    }
  });

  it('drops an invalid deck and reports it instead of failing the whole pack', () => {
    const result = buildOfficialPacks(
      catalog({
        packs: [
          {
            id: 'mengyin.official.math',
            name: 'Official Maths',
            version: '1',
            tags: [],
            updatedAt: '2026-11-03T00:00:00.000Z',
            decks: [
              deck({ id: 'broken', questions: [] }),
              deck({ id: 'good' }),
            ],
          },
        ],
      }),
    );
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]?.decks.map((entry) => entry.id)).toEqual(['good']);
    expect(result.issues.some((entry) => entry.path.includes('broken'))).toBe(true);
  });

  it('skips a pack that has no valid decks', () => {
    const result = buildOfficialPacks(
      catalog({
        packs: [
          {
            id: 'mengyin.official.empty',
            name: 'Empty',
            version: '1',
            tags: [],
            updatedAt: '2026-11-03T00:00:00.000Z',
            decks: [deck({ id: 'bad', questions: [{ nope: true }] })],
          },
        ],
      }),
    );
    expect(result.packs).toEqual([]);
    expect(result.issues.some((entry) => entry.message.includes('no valid published decks'))).toBe(
      true,
    );
  });

  it('reports duplicate deck ids', () => {
    const result = buildOfficialPacks(
      catalog({
        packs: [
          {
            id: 'mengyin.official.math',
            name: 'Official Maths',
            version: '1',
            tags: [],
            updatedAt: '2026-11-03T00:00:00.000Z',
            decks: [deck(), deck()],
          },
        ],
      }),
    );
    expect(result.packs[0]?.decks).toHaveLength(1);
    expect(result.issues.some((entry) => entry.message.includes('Duplicate deck id'))).toBe(true);
  });
});
