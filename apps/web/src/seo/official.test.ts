import { describe, expect, it } from 'vitest';
import {
  officialRoutes,
  renderDeckPage,
  renderOfficialPages,
  renderPackPage,
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
  ],
};

describe('official SEO pages', () => {
  it('emits a collection page and every question bank', () => {
    const pages = renderOfficialPages([pack], FALLBACK_SITE_ORIGIN);
    const paths = pages.map((page) => page.path);

    expect(paths).toEqual([
      '/guide/',
      '/banks/',
      '/banks/cpp-runoob/',
      '/banks/cpp-runoob/cpp-01-tutorial/',
    ]);
    for (const page of pages) {
      expect(page.html.startsWith('<!doctype html>')).toBe(true);
      expect(page.html).toContain('MengYin Study');
      expect(page.html).not.toContain('<html lang="zh"');
    }
  });

  it('renders the bank title, questions and canonical URL, but keeps answers out', () => {
    const html = renderDeckPage(pack, pack.decks[0]!, FALLBACK_SITE_ORIGIN);

    expect(html).toContain('<title>C++ Tutorial: From Source to Program · MengYin Study</title>');
    expect(html).toContain('C++ 教程：由原始碼到程式');
    expect(html).toContain('Which header must be included to use std::cout?');
    expect(html).toContain(
      '<link rel="canonical" href="https://study.mengyin.online/banks/cpp-runoob/cpp-01-tutorial/" />',
    );
    expect(html).toContain('LearningResource');
    expect(html).not.toContain('optionId');
  });

  it('lists banks on the collection page and adds sitemap routes', () => {
    const html = renderPackPage(pack, FALLBACK_SITE_ORIGIN);
    expect(html).toContain('C++ Tutorial: From Source to Program');
    expect(html).toContain('/banks/cpp-runoob/cpp-01-tutorial/');

    expect(officialRoutes([pack])).toEqual([
      { path: '/banks/', lastmod: '2026-11-08' },
      { path: '/banks/cpp-runoob/', lastmod: '2026-11-08' },
      { path: '/banks/cpp-runoob/cpp-01-tutorial/', lastmod: '2026-11-08' },
    ]);
  });
});
