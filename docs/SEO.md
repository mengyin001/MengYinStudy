# Search discovery

MengYin Study is a static Vite build on `https://study.mengyin.online`. This
document covers what search engines can index, how the sitemap is produced, and
the manual steps that make a new site appear in Google and Bing.

## What is indexable

The app uses hash routing (`/#/today`, `/#/library`). A fragment is not a
separate HTTP request, so search engines do not treat those routes as pages.
Only these URLs are real documents:

| URL | What it is | `lastmod` source |
| --- | --- | --- |
| `https://study.mengyin.online/` | Public landing page, readable without JavaScript | `LANDING_UPDATED` in `src/seo/site.ts` |
| `https://study.mengyin.online/guide/` | Static study guide: practice, exam, mistakes, AI and code modes | `GUIDE_UPDATED` in `src/seo/site.ts` |
| `https://study.mengyin.online/banks/` | Official catalogue index | `OFFICIAL_UPDATED` in `src/seo/official.ts` |
| `https://study.mengyin.online/banks/cpp-runoob/` | Official collection: 44 bilingual C++ banks | `OFFICIAL_UPDATED` |
| `https://study.mengyin.online/banks/cpp-runoob/<deck-id>/` | One page per official question bank, with every question prompt and a link to practise | `OFFICIAL_UPDATED` |
| `https://study.mengyin.online/privacy/` | Standalone privacy policy HTML | `LEGAL_UPDATED` in `src/legal/config.ts` |
| `https://study.mengyin.online/terms/` | Standalone terms of service HTML | `LEGAL_UPDATED` in `src/legal/config.ts` |

`/privacy` and `/terms` redirect to the trailing-slash URL with a 301
(`public/_redirects`); `/banks` and `/guide` do the same. Do not put the
redirecting form in the sitemap.

The official pages are generated from the same plugin JSON files the app
syncs (`plugins/<pack>/decks/*.json`). A bank page is real static HTML: title,
description, licence, every question prompt and a link to the app. Answers and
explanations are deliberately left to the app. The bundled `starter.study`
demo is not part of the published catalogue and is excluded.

## Generated files

`vite.config.ts` emits these into `apps/web/dist`:

- `/sitemap.xml` — every real document above, each with a `lastmod` date. No
  `changefreq` or `priority`: Google ignores both, and stale values are noise.
- `/robots.txt` — allows the site, blocks the large versioned `/runtimes/`
  files, and advertises the sitemap.
- `/guide/index.html`, `/banks/index.html`, one collection page and one page per
  official question bank.

`VITE_PUBLIC_ORIGIN` sets the origin. If it is unset, the production domain is
used, so a build without `.env` still produces absolute URLs. The Vite dev
server serves the same files from memory.

Do not create `public/sitemap.xml`, `public/robots.txt` or static bank pages:
the build emits them, and a second copy would be overwritten or drift.

The landing page has a pre-JavaScript shell in `index.html` with the name,
purpose, legal links and AI NCII statement. This is what a crawler sees before
React mounts, and it is also what Google's OAuth brand review reads.

## Submit to Google Search Console

A sitemap only helps discovery. A new domain is not indexed until Google
crawls it, and the reliable way to trigger that is Search Console.

1. Open <https://search.google.com/search-console> and add a **URL-prefix**
   property for `https://study.mengyin.online/`.
2. Verify ownership. The DNS TXT record on `mengyin.online` is the least
   fragile. The HTML-tag method also works: add the meta tag Google gives you
   to `apps/web/index.html`, deploy, then click **Verify**.
3. Open **Indexing → Sitemaps**, enter `sitemap.xml`, and submit. The status
   should become **Success**; the discovered URL count should be 3.
4. Open **URL Inspection**, enter `https://study.mengyin.online/`, and click
   **Request indexing**. Do the same for `/privacy/` and `/terms/` if they are
   not discovered within a few days.
5. Wait. Indexing normally takes a few days to two weeks for a new domain.
   Check with `site:study.mengyin.online` in Google.

If the sitemap reports **Couldn't fetch**, open
`https://study.mengyin.online/sitemap.xml` in a private window. It must return
HTTP 200 and `application/xml`, with no login and no redirect.

If it reports **Sitemap is HTML** (站点地图可读取，但存在错误 / Sitemap 是 HTML),
Search Console last read an HTML document at the submitted URL. That is not the
sitemap endpoint: check the URL row above the error. It must end in
`/sitemap.xml`. The two usual causes are:

- The bare domain or the homepage was submitted instead of the sitemap. The
  homepage is intentionally HTML, so Google cannot parse it as a sitemap.
- The entry predates the generated sitemap and still holds that old read. The
  server now returns XML, but Search Console keeps the last result until the
  entry is fetched again.

Fix it by deleting the errored entry and adding
`https://study.mengyin.online/sitemap.xml` (not `sitemap.xml/`, not
`robots.txt`, not the domain). The status should become **Success** with every
page discovered (currently 50 URLs). To verify what Google will see:

```bash
curl -sS -D - https://study.mengyin.online/sitemap.xml | head
curl -sS https://study.mengyin.online/sitemap.xml | head -1
```

The first line of the body must be `<?xml version="1.0" encoding="UTF-8"?>`,
and the headers must say `Content-Type: application/xml`. The SEO files are
served with `max-age=0, must-revalidate` (`public/_headers`), so a deploy or a
cache refresh cannot leave a stale HTML body behind for an hour.

## Submit to Bing

1. Open <https://www.bing.com/webmasters> and sign in.
2. Choose **Import from Google Search Console** (fastest), or add the site
   manually.
3. Submit `https://study.mengyin.online/sitemap.xml` under **Sitemaps**.
4. Use **URL Submission** for the landing page.

Bing also powers DuckDuckGo and some ChatGPT search results, so it is worth
doing even if Google is the main target.

## Ranking, not just indexing

A sitemap does not create rankings. The site has a landing page, a study guide,
the official catalogue and one page per bank, but the official pages are question
prompts rather than long-form articles. To get search traffic:

- Add public pages with real content, for example a guide to building a
  question deck or a page explaining the AI endpoint setup. Each one needs its
  own canonical URL and an entry in `sitemapRoutes()`.
- Keep the landing page's title, H1 and first paragraph aligned with what
  people search for, without renaming the OAuth app: the OAuth brand name must
  stay exactly `MengYin Study`.
- Earn links: the GitHub repository, product directories, relevant forums and
  a link from `mengyin.online`. Search engines discover new sites mostly
  through links, not sitemaps.
- Do not add `noindex`, do not block `/assets/` in `robots.txt`, and do not
  serve the landing page only after login.

## Maintenance

- Change `LANDING_UPDATED` in `src/seo/site.ts` when the landing copy changes
  materially.
- Change `GUIDE_UPDATED` when the study guide copy changes.
- Change `OFFICIAL_UPDATED` in `src/seo/official.ts` when the plugin decks are
  reseeded; the bank pages and their sitemap entries follow the JSON files.
- Change `LEGAL_UPDATED` and `LEGAL_VERSION` together when either legal
  document changes; the sitemap follows automatically.
- After a deploy, fetch `/sitemap.xml` and confirm the dates and the URL count.
  The file is plain XML; a mistake is visible immediately.
- `npm test` covers the sitemap URLs, `lastmod` format, the robots reference
  and the official page renderer (`src/seo/site.test.ts` and
  `src/seo/official.test.ts`).
