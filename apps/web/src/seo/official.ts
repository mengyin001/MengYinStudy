import { escapeHtml, GUIDE_UPDATED, type SitemapRoute } from './site';

/**
 * Last material change to the published official catalogue. The source decks
 * live in `plugins/<pack>/decks/*.json`; update this when their content
 * changes so the sitemap's `lastmod` stays honest.
 */
export const OFFICIAL_UPDATED = '2026-11-08';

export interface OfficialQuestion {
  id: string;
  type: string;
  prompt: string;
  tags: string[];
  difficulty?: number;
}

export interface OfficialDeck {
  id: string;
  title: string;
  titleZh?: string;
  description?: string;
  descriptionZh?: string;
  tags: string[];
  examMinutes?: number;
  questions: OfficialQuestion[];
}

export interface OfficialPack {
  /** Filesystem-safe directory name, used in the public URL. */
  dir: string;
  id: string;
  name: string;
  description?: string;
  author?: string;
  license?: string;
  tags: string[];
  decks: OfficialDeck[];
}

export interface OfficialPage {
  /** Absolute site path, always ending in `/`. */
  path: string;
  html: string;
}

const TYPE_LABELS: Record<string, string> = {
  single: 'Multiple choice',
  multi: 'Select all that apply',
  boolean: 'True or false',
  fill: 'Fill in the blank',
  short: 'Short answer',
  code: 'Code',
};

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #f5f1e8; }
body {
  margin: 0;
  background: #f5f1e8;
  color: #1b1a16;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial,
    'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif;
  line-height: 1.6;
}
a { color: #2f5d4e; text-underline-offset: 2px; }
.top {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 18px clamp(20px, 4vw, 48px);
  border-bottom: 1px solid #ddd6c7;
}
.brand {
  font-family: 'Charter', 'Iowan Old Style', Palatino, Georgia, serif;
  font-size: 20px;
  color: #1b1a16;
  text-decoration: none;
}
.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-left: auto;
  font-size: 13px;
}
.nav a { color: #4a463c; text-decoration: none; }
main {
  max-width: 920px;
  margin: 0 auto;
  padding: clamp(36px, 6vw, 64px) clamp(20px, 4vw, 32px) 72px;
}
.breadcrumb { font-size: 12px; color: #7d7667; margin: 0 0 24px; }
.breadcrumb a { color: #4a463c; }
.eyebrow {
  margin: 0;
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #7d7667;
}
h1 {
  margin: 8px 0 0;
  font-family: 'Charter', 'Iowan Old Style', Palatino, Georgia, serif;
  font-size: clamp(36px, 6vw, 56px);
  font-weight: 500;
  line-height: 1.05;
  letter-spacing: -0.03em;
}
h2 {
  margin: 40px 0 12px;
  font-family: 'Charter', 'Iowan Old Style', Palatino, Georgia, serif;
  font-size: clamp(24px, 3.5vw, 32px);
  font-weight: 500;
  letter-spacing: -0.02em;
}
h3 { margin: 0 0 6px; font-size: 18px; }
.lede {
  margin: 20px 0 0;
  max-width: 62ch;
  font-family: 'Charter', 'Iowan Old Style', Palatino, Georgia, serif;
  font-size: 21px;
  line-height: 1.4;
}
.zh { color: #4a463c; }
.meta { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0 0; }
.tag {
  border: 1px solid #d8d0c0;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  color: #4a463c;
}
.grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-top: 28px; }
.card {
  display: block;
  background: #fffdf7;
  border: 1px solid #ddd6c7;
  border-radius: 12px;
  padding: 18px;
  color: inherit;
  text-decoration: none;
}
.card--link:hover { border-color: #2f5d4e; }
.card p { margin: 0 0 12px; color: #4a463c; font-size: 14px; }
.card__meta { color: #7d7667; font-size: 12px; }
.note {
  margin: 24px 0 0;
  padding-left: 14px;
  border-left: 2px solid #2f5d4e;
  color: #4a463c;
  font-size: 14px;
}
.cta {
  display: inline-block;
  margin: 8px 12px 0 0;
  background: #2f5d4e;
  color: #fff;
  border-radius: 8px;
  padding: 10px 16px;
  text-decoration: none;
}
.cta--quiet { background: transparent; color: #2f5d4e; border: 1px solid #2f5d4e; }
.questions { list-style: none; margin: 0; padding: 0; }
.q { border-top: 1px solid #e4ddcf; padding: 18px 0; }
.q__num { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 12px; color: #7d7667; }
.q__prompt { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.foot {
  margin-top: 56px;
  padding-top: 18px;
  border-top: 1px solid #ddd6c7;
  color: #7d7667;
  font-size: 12px;
}
.foot a { color: #4a463c; }
@media (max-width: 640px) {
  .nav { width: 100%; margin-left: 0; }
}
`;

const typeLabel = (type: string): string => TYPE_LABELS[type] ?? type;

const packPath = (pack: OfficialPack): string => `/banks/${pack.dir}/`;
const deckPath = (pack: OfficialPack, deck: OfficialDeck): string =>
  `/banks/${pack.dir}/${deck.id}/`;

function tags(values: readonly string[]): string {
  return values
    .filter(Boolean)
    .map((value) => `<span class="tag">${escapeHtml(value)}</span>`)
    .join('');
}

function page(input: {
  origin: string;
  title: string;
  description: string;
  canonicalPath: string;
  body: string;
  jsonLd?: unknown;
}): string {
  const origin = input.origin.replace(/\/+$/, '');
  const canonical = `${origin}${input.canonicalPath}`;
  const jsonLd = input.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(input.jsonLd).replace(/</g, '\\u003c')}</script>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(input.title)} · MengYin Study</title>
    <meta name="description" content="${escapeHtml(input.description)}" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="MengYin Study" />
    <meta property="og:title" content="${escapeHtml(input.title)}" />
    <meta property="og:description" content="${escapeHtml(input.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${origin}/icons/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="/favicon.ico" sizes="32x32" />
    ${jsonLd}
    <style>${CSS}</style>
  </head>
  <body>
    <header class="top">
      <a class="brand" href="/">MengYin Study</a>
      <nav class="nav" aria-label="Site">
        <a href="/banks/">Question banks</a>
        <a href="/guide/">Study guide</a>
        <a href="/#/plaza">Plaza</a>
        <a href="/privacy/">Privacy</a>
        <a href="/terms/">Terms</a>
      </nav>
    </header>
    <main>${input.body}</main>
    <footer class="foot">
      <p>MengYin Study · revision and practice. Official question banks are published under their
      stated licence; see each collection for attribution.</p>
      <p><a href="/">Home</a> · <a href="/banks/">Question banks</a> · <a href="/guide/">Study guide</a>
      · <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></p>
    </footer>
  </body>
</html>
`;
}

function packCards(packs: readonly OfficialPack[]): string {
  return packs
    .map((pack) => {
      const questionCount = pack.decks.reduce((sum, deck) => sum + deck.questions.length, 0);
      return `<a class="card card--link" href="${packPath(pack)}">
        <h3>${escapeHtml(pack.name)}</h3>
        ${pack.description ? `<p>${escapeHtml(pack.description)}</p>` : ''}
        <p class="card__meta">${pack.decks.length} banks · ${questionCount} questions${
          pack.license ? ` · ${escapeHtml(pack.license)}` : ''
        }</p>
        <p>${tags(pack.tags)}</p>
      </a>`;
    })
    .join('\n');
}

export function renderBanksPage(packs: readonly OfficialPack[], origin: string): string {
  const questionCount = packs.reduce(
    (sum, pack) => sum + pack.decks.reduce((deckSum, deck) => deckSum + deck.questions.length, 0),
    0,
  );
  const body = `<p class="eyebrow">Official catalogue</p>
    <h1>Official question banks</h1>
    <p class="lede">Free, bilingual practice banks published by MengYin Study. Add a bank in the
    app, then practise it, sit an exam, or drill only the questions you missed.</p>
    ${
      packs.length === 0
        ? '<p class="note">The official catalogue is not available in this build.</p>'
        : `<p class="note">${packs.length} collection${packs.length === 1 ? '' : 's'} ·
          ${questionCount} questions. Every bank is also available inside the app.</p>
          <div class="grid">${packCards(packs)}</div>`
    }
    <h2>How to use a bank</h2>
    <p>Open the Plaza in the app, add the bank to your library, and choose Practice, Exam or
    Mistakes. Progress and scheduling stay with your account, and the same decks work offline once
    they have been added.</p>
    <p><a class="cta" href="/#/plaza">Open the Plaza</a>
    <a class="cta cta--quiet" href="/guide/">Read the study guide</a></p>`;

  return page({
    origin,
    title: 'Official question banks',
    description:
      'Bilingual practice question banks from MengYin Study, covering C++ from first program to classes, templates, concurrency and the standard library.',
    canonicalPath: '/banks/',
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Official question banks',
      url: `${origin.replace(/\/+$/, '')}/banks/`,
      isPartOf: { '@type': 'WebSite', name: 'MengYin Study', url: origin.replace(/\/+$/, '') + '/' },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: packs.length,
        itemListElement: packs.map((pack, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${origin.replace(/\/+$/, '')}${packPath(pack)}`,
          name: pack.name,
        })),
      },
    },
  });
}

export function renderPackPage(pack: OfficialPack, origin: string): string {
  const questionCount = pack.decks.reduce((sum, deck) => sum + deck.questions.length, 0);
  const base = origin.replace(/\/+$/, '');
  const body = `<p class="breadcrumb"><a href="/">Home</a> / <a href="/banks/">Question banks</a> / ${escapeHtml(
    pack.name,
  )}</p>
    <p class="eyebrow">Official collection</p>
    <h1>${escapeHtml(pack.name)}</h1>
    ${pack.description ? `<p class="lede">${escapeHtml(pack.description)}</p>` : ''}
    <div class="meta">
      <span class="tag">${pack.decks.length} banks</span>
      <span class="tag">${questionCount} questions</span>
      ${pack.license ? `<span class="tag">${escapeHtml(pack.license)}</span>` : ''}
      ${pack.author ? `<span class="tag">${escapeHtml(pack.author)}</span>` : ''}
      ${tags(pack.tags)}
    </div>
    <p class="note">Each bank is a complete chapter: ten questions with answers, explanations and
    bilingual prompts. Add the collection in the Plaza to keep it in your library.</p>
    <h2>Banks in this collection</h2>
    <div class="grid">
      ${pack.decks
        .map(
          (deck) => `<a class="card card--link" href="${deckPath(pack, deck)}">
            <h3>${escapeHtml(deck.title)}</h3>
            ${deck.titleZh ? `<p class="zh" lang="zh-Hant">${escapeHtml(deck.titleZh)}</p>` : ''}
            ${deck.description ? `<p>${escapeHtml(deck.description)}</p>` : ''}
            <p class="card__meta">${deck.questions.length} questions${
              deck.examMinutes ? ` · ${deck.examMinutes} min exam` : ''
            }</p>
            <p>${tags(deck.tags)}</p>
          </a>`,
        )
        .join('\n')}
    </div>
    <h2>Practise this collection</h2>
    <p>Open the Plaza, add the collection, and the app schedules practice around what you miss.
    You can also sit the paper in exam mode or review only the questions you got wrong.</p>
    <p><a class="cta" href="/#/plaza">Open the Plaza</a>
    <a class="cta cta--quiet" href="/guide/">How to study</a></p>
    ${
      pack.license
        ? `<p class="note">Licence: ${escapeHtml(pack.license)}. Please keep the attribution and
          share alike when you reuse these questions.</p>`
        : ''
    }`;

  return page({
    origin,
    title: pack.name,
    description:
      pack.description ??
      `Official question banks from MengYin Study: ${pack.decks.length} bilingual banks and ${questionCount} practice questions.`,
    canonicalPath: packPath(pack),
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: pack.name,
      description: pack.description,
      url: `${base}${packPath(pack)}`,
      isPartOf: { '@type': 'WebSite', name: 'MengYin Study', url: `${base}/` },
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: pack.decks.length,
        itemListElement: pack.decks.map((deck, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${base}${deckPath(pack, deck)}`,
          name: deck.title,
        })),
      },
    },
  });
}

export function renderDeckPage(pack: OfficialPack, deck: OfficialDeck, origin: string): string {
  const base = origin.replace(/\/+$/, '');
  const body = `<p class="breadcrumb"><a href="/">Home</a> / <a href="/banks/">Question banks</a> /
    <a href="${packPath(pack)}">${escapeHtml(pack.name)}</a> / ${escapeHtml(deck.title)}</p>
    <p class="eyebrow">Official question bank</p>
    <h1>${escapeHtml(deck.title)}</h1>
    ${deck.titleZh ? `<p class="lede zh" lang="zh-Hant">${escapeHtml(deck.titleZh)}</p>` : ''}
    ${deck.description ? `<p class="lede">${escapeHtml(deck.description)}</p>` : ''}
    ${deck.descriptionZh ? `<p class="zh" lang="zh-Hant">${escapeHtml(deck.descriptionZh)}</p>` : ''}
    <div class="meta">
      <span class="tag">${deck.questions.length} questions</span>
      ${deck.examMinutes ? `<span class="tag">${deck.examMinutes} min exam</span>` : ''}
      ${tags(deck.tags)}
      ${pack.license ? `<span class="tag">${escapeHtml(pack.license)}</span>` : ''}
    </div>
    <p class="note">Practice, exam and mistake drills are in the app. Answers, explanations and
    scheduling are not shown here so the questions stay useful for revision.</p>
    <h2>Questions in this bank</h2>
    <ol class="questions">
      ${deck.questions
        .map(
          (question, index) => `<li class="q">
            <span class="q__num">${String(index + 1).padStart(2, '0')} · ${escapeHtml(
              typeLabel(question.type),
            )}${question.difficulty ? ` · level ${question.difficulty}` : ''}</span>
            <p class="q__prompt">${escapeHtml(question.prompt)}</p>
          </li>`,
        )
        .join('\n')}
    </ol>
    <h2>Practise this bank</h2>
    <p>Add the collection in the Plaza and this bank appears in your library. Use Practice for
    spaced review, Exam for a timed paper, and Mistakes to redo only what you missed.</p>
    <p><a class="cta" href="/#/plaza">Open the Plaza</a>
    <a class="cta cta--quiet" href="${packPath(pack)}">All banks in this collection</a></p>
    ${
      pack.license
        ? `<p class="note">From <a href="${packPath(pack)}">${escapeHtml(pack.name)}</a>, published
          under ${escapeHtml(pack.license)}. ${pack.author ? `Author: ${escapeHtml(pack.author)}.` : ''}</p>`
        : ''
    }`;

  return page({
    origin,
    title: deck.title,
    description:
      deck.description ??
      `${deck.questions.length} practice questions on ${deck.title}, from the official MengYin Study catalogue.`,
    canonicalPath: deckPath(pack, deck),
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'LearningResource',
      name: deck.title,
      description: deck.description,
      url: `${base}${deckPath(pack, deck)}`,
      inLanguage: ['en', 'zh-Hant'],
      learningResourceType: 'Quiz',
      educationalLevel: 'Beginner',
      isPartOf: {
        '@type': 'CollectionPage',
        name: pack.name,
        url: `${base}${packPath(pack)}`,
      },
      provider: { '@type': 'Organization', name: 'MengYin Study', url: `${base}/` },
      keywords: deck.tags.join(', '),
    },
  });
}

export function renderGuidePage(packs: readonly OfficialPack[], origin: string): string {
  const base = origin.replace(/\/+$/, '');
  const bankLinks = packs
    .map((pack) => `<li><a href="${packPath(pack)}">${escapeHtml(pack.name)}</a></li>`)
    .join('');
  const body = `<p class="eyebrow">Study guide</p>
    <h1>How to study with MengYin Study</h1>
    <p class="lede">A practical loop for turning a question bank into remembered answers: try the
    question, review what went wrong, and come back at the right time.</p>

    <h2>1. Start with an official bank</h2>
    <p>The official catalogue groups questions into short, focused banks. Each bank is a chapter:
    ten questions, a bilingual prompt for every question, and an explanation for the answer. The
    C++ collection starts at the first program and continues through classes, templates,
    concurrency and the standard library.</p>
    ${bankLinks ? `<ul>${bankLinks}</ul>` : '<p><a href="/banks/">Browse the official banks</a>.</p>'}
    <p>Open the Plaza, add the collection to your library, and the app keeps the decks available
    offline after the first sync.</p>
    <p><a class="cta" href="/#/plaza">Open the Plaza</a></p>

    <h2>2. Practise, then review the mistakes</h2>
    <p>Practice mode schedules questions with spaced repetition. When an answer is wrong, the
    question enters the mistake queue; a mistake drill brings it back without the rest of the
    paper. Exam mode hides feedback until you submit, so it is the better test of what you can
    recall without prompting.</p>
    <p>The useful signal is not a single score. It is whether a question you missed last week is
    easy this week. Review the mistake queue before adding another bank.</p>

    <h2>3. Generate questions from your own material</h2>
    <p>If the official banks do not cover your course, import your notes and generate a deck with
    the built-in AI service. The free plan includes 200 questions a month; paid plans add points
    and stronger models. Generated questions are labelled, and you should check facts, citations
    and code against an independent source before relying on them.</p>

    <h2>4. Run code questions locally</h2>
    <p>Code questions execute in an isolated sandbox in the browser: JavaScript and TypeScript on
    the browser engine, Python on Pyodide, SQL on sql.js, Java on javac and TeaVM, and C++ on the
    JSCPP interpreter. Nothing is sent to an execution server. Use Run to test a snippet, then
    submit the answer when the tests pass.</p>

    <h2>5. Track what you have learned</h2>
    <p>The Today page shows what is due. Statistics show accuracy, streaks and the topics that
    keep returning. A short daily session is more useful than a long one once a week: the schedule
    only works if the questions come back.</p>

    <h2>Frequently asked questions</h2>
    <h3>Are the official banks free?</h3>
    <p>Yes. Adding and practising official banks is free. AI generation has a free monthly
    allowance and optional paid plans.</p>
    <h3>Do the banks work offline?</h3>
    <p>After a bank has been added and synced, the decks are cached for offline practice. AI
    generation and account sync need a connection.</p>
    <h3>Can I reuse the questions?</h3>
    <p>The official collection states its licence on the collection page. Keep the attribution and
    share alike when a licence requires it.</p>

    <p class="note">Ready to try it? <a href="/banks/">Browse the official question banks</a>, or
    <a href="/#/plaza">open the Plaza</a> and pick a chapter.</p>`;

  return page({
    origin,
    title: 'How to study',
    description:
      'A practical guide to practising with question banks: spaced review, mistake drills, exam mode, AI-generated questions, local code practice and progress tracking.',
    canonicalPath: '/guide/',
    body,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'How to study with MengYin Study',
      description:
        'A practical guide to practising with question banks: spaced review, mistake drills, exam mode, AI-generated questions, local code practice and progress tracking.',
      url: `${base}/guide/`,
      dateModified: GUIDE_UPDATED,
      author: { '@type': 'Organization', name: 'MengYin Study', url: `${base}/` },
      publisher: { '@type': 'Organization', name: 'MengYin Study', url: `${base}/` },
      mainEntityOfPage: `${base}/guide/`,
    },
  });
}

export function officialRoutes(packs: readonly OfficialPack[]): SitemapRoute[] {
  const routes: SitemapRoute[] = [{ path: '/banks/', lastmod: OFFICIAL_UPDATED }];
  for (const pack of packs) {
    routes.push({ path: packPath(pack), lastmod: OFFICIAL_UPDATED });
    for (const deck of pack.decks) {
      routes.push({ path: deckPath(pack, deck), lastmod: OFFICIAL_UPDATED });
    }
  }
  return routes;
}

export function renderOfficialPages(
  packs: readonly OfficialPack[],
  origin: string,
): OfficialPage[] {
  const pages: OfficialPage[] = [
    { path: '/guide/', html: renderGuidePage(packs, origin) },
    { path: '/banks/', html: renderBanksPage(packs, origin) },
  ];
  for (const pack of packs) {
    pages.push({ path: packPath(pack), html: renderPackPage(pack, origin) });
    for (const deck of pack.decks) {
      pages.push({ path: deckPath(pack, deck), html: renderDeckPage(pack, deck, origin) });
    }
  }
  return pages;
}
