import { describe, expect, it } from 'vitest';
import {
  officialRoutes,
  renderCollectionPage,
  renderOfficialPages,
  type OfficialPack,
} from './official';
import { FALLBACK_SITE_ORIGIN } from './site';

const pack: OfficialPack = {
  dir: 'cpp-runoob',
  id: 'cpp.runoob',
  name: 'C++ Programming · 程式設計入門',
  description: 'Bilingual C++ practice.',
  author: 'MengYin Study',
  license: 'CC BY-SA 4.0',
  tags: ['C++'],
  decks: [
    {
      id: 'cpp-01-tutorial',
      title: 'C++ Tutorial: From Source to Program',
      titleZh: 'C++ 教程：由原始碼到程式',
      description: 'The orientation chapter.',
      descriptionZh: '導覽章節。',
      tags: ['C++', 'Basics'],
      examMinutes: 14,
      questions: [
        {
          id: 'cpp-01-q01',
          type: 'single',
          prompt: 'Which header must be included to use std::cout?',
          tags: ['I/O'],
          difficulty: 1,
        },
        {
          id: 'cpp-01-q02',
          type: 'boolean',
          prompt: 'A C++ program is normally compiled into a native executable.',
          tags: ['Toolchain'],
        },
      ],
    },
    {
      id: 'cpp-02-intro',
      title: 'C++ Introduction',
      description: 'What C++ is and where it came from.',
      tags: ['C++'],
      questions: [
        {
          id: 'cpp-02-q01',
          type: 'boolean',
          prompt: 'C++ is a compiled language.',
          tags: ['Basics'],
        },
      ],
    },
  ],
};

describe('official collection page', () => {
  it('emits one guide page and one page per collection, never per bank', () => {
    const pages = renderOfficialPages([pack], FALLBACK_SITE_ORIGIN);
    const paths = pages.map((page) => page.path);

    expect(paths).toEqual(['/guide/', '/collections/cpp-runoob/']);
    for (const page of pages) {
      expect(page.html.startsWith('<!doctype html>')).toBe(true);
      expect(page.html).toContain('MengYin Study');
      expect(page.html).not.toContain('/banks/');
    }
  });

  it('lists every bank on the collection page with one sample question', () => {
    const html = renderCollectionPage(pack, FALLBACK_SITE_ORIGIN);

    expect(html).toContain('<title>C++ Programming · 程式設計入門 · MengYin Study</title>');
    expect(html).toContain(
      '<link rel="canonical" href="https://study.mengyin.online/collections/cpp-runoob/" />',
    );
    expect(html).toContain('C++ Tutorial: From Source to Program');
    expect(html).toContain('C++ Introduction');
    expect(html).toContain('Which header must be included to use std::cout?');
    expect(html).toContain('C++ is a compiled language.');
    expect(html).toContain('CollectionPage');
    expect(html).toContain('CC BY-SA 4.0');
    expect(html).not.toContain('optionId');
    expect(html).not.toContain('/collections/cpp-runoob/cpp-01-tutorial/');
  });

  it('adds exactly one sitemap route per collection', () => {
    expect(officialRoutes([pack])).toEqual([
      { path: '/collections/cpp-runoob/', lastmod: '2026-11-08' },
    ]);
  });
});
