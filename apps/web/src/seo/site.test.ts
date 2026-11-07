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
    ]);

    for (const loc of locs) {
      expect(loc).toMatch(/^https:\/\//);
      expect(loc).not.toContain('#');
      expect(loc.endsWith('/')).toBe(true);
    }
  });

  it('gives every URL a real lastmod date', () => {
    const xml = renderSitemap(FALLBACK_SITE_ORIGIN);
    expect(xml.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g)).toHaveLength(
      sitemapRoutes().length,
    );
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
