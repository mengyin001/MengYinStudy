import { LEGAL_UPDATED } from '../legal/config';

/**
 * The public origin used by the sitemap, robots.txt and the legal documents.
 *
 * `VITE_PUBLIC_ORIGIN` wins so a staging deploy can describe itself, but the
 * production domain is the fallback: a missing `.env` must not produce a
 * sitemap with relative URLs.
 */
export const FALLBACK_SITE_ORIGIN = 'https://study.mengyin.online';

/**
 * Last material change to the landing page copy. Keep this in sync with real
 * edits; an invented `lastmod` is worse than no `lastmod` because Google
 * learns to distrust the field.
 */
export const LANDING_UPDATED = '2026-11-07';

/**
 * Only these URLs are separate HTTP resources.
 *
 * The app is hash-routed, so `/#/today`, `/#/privacy` and `/#/terms` all return
 * the same document as `/`. Search engines do not index fragments as pages,
 * and a sitemap must not pretend they are separate URLs. The legal documents
 * are emitted as real static HTML by `vite.config.ts`.
 */
export type SitemapPath = '/' | '/privacy/' | '/terms/';

export interface SitemapRoute {
  path: SitemapPath;
  lastmod: string;
}

export function normalizeSiteOrigin(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '') || FALLBACK_SITE_ORIGIN;
}

export function sitemapRoutes(): SitemapRoute[] {
  return [
    { path: '/', lastmod: LANDING_UPDATED },
    { path: '/privacy/', lastmod: LEGAL_UPDATED },
    { path: '/terms/', lastmod: LEGAL_UPDATED },
  ];
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function renderSitemap(origin: string): string {
  const base = normalizeSiteOrigin(origin);
  const urls = sitemapRoutes()
    .map(
      (route) =>
        `  <url>\n    <loc>${escapeXml(`${base}${route.path}`)}</loc>\n    <lastmod>${escapeXml(
          route.lastmod,
        )}</lastmod>\n  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderRobots(origin: string): string {
  const base = normalizeSiteOrigin(origin);
  return `User-agent: *
Allow: /
Disallow: /runtimes/

Sitemap: ${base}/sitemap.xml
`;
}
