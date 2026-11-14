import { describe, expect, it } from 'vitest';
import {
  FALLBACK_SITE_ORIGIN,
  normalizeSiteOrigin,
  renderRobots,
  renderSitemap,
  sitemapRoutes,
} from './site';

describe('SEO files', () => {
  it('publishes only canonical, absolute, trailing-slash URLs', () => {
    const xml = renderSitemap(FALLBACK_SITE_ORIGIN);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? '');

    expect(locs).toEqual([
      'https://study.mengyin.online/',
      'https://study.mengyin.online/privacy/',
      'https://study.mengyin.online/terms/',
      'https://study.mengyin.online/guide/',
    ]);

    for (const loc of locs) {
      expect(loc).toMatch(/^https:\/\//);
      expect(loc).not.toContain('#');
      expect(loc.endsWith('/')).toBe(true);
    }
  });

  it('emits a sitemap document, never an HTML page', () => {
    const xml = renderSitemap(FALLBACK_SITE_ORIGIN);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).not.toMatch(/<html[\s>]/i);
    expect(xml).not.toContain('<body');
  });

  it('gives every URL a real lastmod date', () => {
    const xml = renderSitemap(FALLBACK_SITE_ORIGIN);
    expect(xml.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)).toHaveLength(
      sitemapRoutes().length,
    );
  });

  it('appends the official collection without duplicating static routes', () => {
    const routes = sitemapRoutes([
      { path: '/collections/cpp-runoob/', lastmod: '2026-11-08' },
      { path: '/guide/', lastmod: '2026-11-15' },
    ]);
    const xml = renderSitemap(FALLBACK_SITE_ORIGIN, routes);

    expect(routes.filter((route) => route.path === '/guide/')).toHaveLength(1);
    expect(routes.map((route) => route.path)).toEqual([
      '/',
      '/privacy/',
      '/terms/',
      '/guide/',
      '/collections/cpp-runoob/',
    ]);
    expect(xml).toContain('https://study.mengyin.online/collections/cpp-runoob/');
    expect(xml).not.toContain('/banks/');
    expect(xml.match(/<url>/g)).toHaveLength(5);
  });

  it('points robots.txt at the sitemap without blocking the app shell', () => {
    const robots = renderRobots(FALLBACK_SITE_ORIGIN);

    expect(robots).toContain('Sitemap: https://study.mengyin.online/sitemap.xml');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Disallow: /runtimes/');
    expect(robots).not.toContain('Disallow: /assets/');
    expect(robots.split('\n')).not.toContain('Disallow: /');
  });

  it('normalizes a trailing slash and falls back to production when empty', () => {
    expect(normalizeSiteOrigin('https://example.com/')).toBe('https://example.com');
    expect(normalizeSiteOrigin('  ')).toBe(FALLBACK_SITE_ORIGIN);
    expect(normalizeSiteOrigin(undefined)).toBe(FALLBACK_SITE_ORIGIN);
  });
});
