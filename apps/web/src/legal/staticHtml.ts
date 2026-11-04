import { THEME_STORAGE_KEY } from '../lib/theme';
import type { LegalContext } from './config';
import { LEGAL_CHROME } from './content';
import type { LegalDoc } from './content';
import { fillText, pick, resolveDoc, type DocLocale, type ResolvedDoc } from './render';

/**
 * Build-time renderer for the standalone documents served at `/privacy/` and
 * `/terms/`. App-store review opens these without the app shell, and a
 * reviewer should never need JavaScript (or a login) to read a privacy policy,
 * so the output is a single self-contained HTML file: no bundle, no fonts, no
 * external requests. The only script is the four-line theme bootstrap below;
 * without it the document is still complete and follows the OS theme.
 */

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Four lines of inline JavaScript, and the only script on the page.
 *
 * The app writes its theme mode (`light`, `dark` or `system`) to localStorage.
 * Without this bootstrap, a reader who chose dark in the app would arrive at a
 * light legal page because the static document cannot know about the app's
 * state. `system` is left unset so the stylesheet's `prefers-color-scheme`
 * rules keep tracking the OS; with no key at all the same fallback applies, so
 * the page still works without JavaScript.
 */
function themeBootstrap(): string {
  return `<script>(function(){try{var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )});if(t==="dark"||t==="light"){document.documentElement.dataset.theme=t;}}catch(e){}})();</script>`;
}

function renderBlocks(doc: ResolvedDoc): string {
  return doc.sections
    .map((section, index) => {
      const heading = `<h2 id="${doc.slug}-${escapeHtml(section.id)}"><span class="num">${String(
        index + 1,
      ).padStart(2, '0')}</span>${escapeHtml(section.heading)}</h2>`;
      const body = section.blocks
        .map((block) => {
          switch (block.kind) {
            case 'p':
              return `<p>${escapeHtml(block.text)}</p>`;
            case 'note':
              return `<p class="note">${escapeHtml(block.text)}</p>`;
            case 'ul':
              return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
            case 'ol':
              return `<ol>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`;
            case 'table': {
              const head = block.head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('');
              const rows = block.rows
                .map(
                  (row) =>
                    `<tr>${row
                      .map((cell, cellIndex) => {
                        const label = escapeHtml(block.head[cellIndex] ?? '');
                        return `<td${cellIndex === 0 ? ' class="key"' : ''} data-label="${label}">${escapeHtml(cell)}</td>`;
                      })
                      .join('')}</tr>`,
                )
                .join('');
              return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
            }
            case 'links':
              return `<ul class="links">${block.items
                .map(
                  (item) =>
                    `<li><a href="${escapeHtml(item.href)}" rel="noreferrer noopener">${escapeHtml(item.label)}</a></li>`,
                )
                .join('')}</ul>`;
          }
        })
        .join('\n');
      return `<section>${heading}${body}</section>`;
    })
    .join('\n');
}

function renderArticle(doc: LegalDoc, locale: DocLocale, ctx: LegalContext, anchor: string): string {
  const resolved = resolveDoc(doc, locale, ctx);
  const lang = locale === 'zh-Hant' ? 'zh-Hant' : 'en';
  return `<article id="${anchor}" lang="${lang}" aria-labelledby="${anchor}-title">
  <header class="doc-head">
    <p class="eyebrow">MengYin Study</p>
    <h1 id="${anchor}-title">${escapeHtml(resolved.title)}</h1>
    <p class="lede">${escapeHtml(resolved.summary)}</p>
    <p class="meta">${escapeHtml(pick(LEGAL_CHROME.updated, locale))} ${escapeHtml(
      resolved.updated,
    )} · ${escapeHtml(pick(LEGAL_CHROME.version, locale))} ${escapeHtml(resolved.version)}</p>
  </header>
  ${renderBlocks(resolved)}
  <footer class="doc-foot"><p>${escapeHtml(resolved.footerNote)}</p></footer>
</article>`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --paper: #f5f1e8;
  --surface: #fffdf7;
  --ink: #1b1a16;
  --ink-2: #4a463c;
  --ink-3: #7d7667;
  --rule: #ddd6c7;
  --rule-2: #c8c0ae;
  --accent: #2f5d4e;
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --paper: #131210;
  --surface: #1a1915;
  --ink: #ede8db;
  --ink-2: #c6c0b0;
  --ink-3: #938c7b;
  --rule: #302d24;
  --rule-2: #45402f;
  --accent: #9bc7b2;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --paper: #131210;
    --surface: #1a1915;
    --ink: #ede8db;
    --ink-2: #c6c0b0;
    --ink-3: #938c7b;
    --rule: #302d24;
    --rule-2: #45402f;
    --accent: #9bc7b2;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; background: var(--paper); }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial,
    'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', sans-serif;
  font-size: 15px;
  line-height: 1.75;
}
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
.top {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px 24px; padding: 18px 28px; border-bottom: 1px solid var(--rule);
  background: var(--surface);
}
.brand { font-family: 'Charter', 'Iowan Old Style', Palatino, Georgia, serif; font-size: 18px;
  letter-spacing: -0.01em; color: var(--ink); text-decoration: none; }
.top nav { display: flex; flex-wrap: wrap; gap: 18px; font-size: 13px; }
.top nav a { color: var(--ink-3); text-decoration: none; }
.top nav a:hover { color: var(--accent); }
main { max-width: 780px; margin: 0 auto; padding: 44px 24px 72px; }
article + article { margin-top: 56px; padding-top: 44px; border-top: 1px solid var(--rule-2); }
.eyebrow { margin: 0; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }
h1 { font-family: 'Charter', 'Iowan Old Style', Palatino, Georgia, serif; font-weight: 500;
  font-size: 34px; line-height: 1.2; letter-spacing: -0.015em; margin: 6px 0 0; }
.lede { margin: 14px 0 0; color: var(--ink-2); font-size: 15px; }
.meta { margin: 18px 0 0; padding-bottom: 22px; border-bottom: 1px solid var(--rule);
  font-size: 12px; color: var(--ink-3); letter-spacing: 0.01em; }
section { margin-top: 30px; }
h2 { display: flex; align-items: baseline; gap: 12px; font-family: 'Charter', 'Iowan Old Style',
  Palatino, Georgia, serif; font-weight: 500; font-size: 19px; letter-spacing: -0.005em; margin: 0 0 10px; }
h2 .num { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 11px;
  color: var(--ink-3); letter-spacing: 0.08em; }
p { margin: 10px 0; }
ul, ol { margin: 10px 0; padding-left: 22px; }
li { margin: 6px 0; }
li::marker { color: var(--ink-3); }
.note { border-left: 2px solid var(--rule-2); padding: 2px 0 2px 14px; color: var(--ink-2); font-size: 14px; }
.scroll { overflow-x: auto; margin: 14px 0; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px 9px 0; border-bottom: 1px solid var(--rule); }
th { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-3);
  font-weight: 500; border-bottom-color: var(--rule-2); }
td.key { color: var(--ink); font-weight: 500; white-space: nowrap; }
ul.links { list-style: none; padding-left: 0; }
ul.links li { margin: 6px 0; word-break: break-word; }
.doc-foot { margin-top: 30px; padding-top: 16px; border-top: 1px solid var(--rule);
  font-size: 12.5px; color: var(--ink-3); }
footer.page-foot { max-width: 780px; margin: 0 auto; padding: 0 24px 60px; font-size: 12px; color: var(--ink-3); }
@media (max-width: 560px) {
  main { padding: 30px 18px 56px; }
  h1 { font-size: 27px; }
  .top { padding: 14px 18px; }
}
/* The three-column data table collapses into labelled rows: a squeezed
   table on a phone is unreadable, which matters on a page reviewers open
   from a store listing. */
@media (max-width: 640px) {
  .scroll { overflow: visible; }
  table, thead, tbody, tr, th, td { display: block; }
  thead { display: none; }
  tr { padding: 12px 0; border-bottom: 1px solid var(--rule); }
  td { border: 0; padding: 2px 0; white-space: normal; }
  td::before {
    content: attr(data-label);
    display: block;
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
  td.key::before { content: none; }
}
@media print {
  /* Printing is always ink on white, even when the reader chose dark. */
  :root, :root[data-theme='dark'], :root:not([data-theme='light']) {
    color-scheme: light;
    --paper: #fff;
    --surface: #fff;
    --ink: #1b1a16;
    --ink-2: #33312b;
    --ink-3: #666156;
    --rule: #ccc6b8;
    --rule-2: #aaa496;
    --accent: #2f5d4e;
  }
  body { background: var(--paper); color: var(--ink); font-size: 10.5pt; }
  .top { display: none; }
  main { max-width: none; padding: 0; }
  article + article { border-top: 0; }
  h2 { break-after: avoid; }
  table, ul, ol, p { break-inside: avoid; }
  a { color: var(--ink); }
}
`;

export function renderLegalHtml(doc: LegalDoc, ctx: LegalContext): string {
  const canonical = ctx.origin ? `<link rel="canonical" href="${escapeHtml(`${ctx.origin}/${doc.slug}/`)}" />` : '';
  const appHref = ctx.origin ? `${ctx.origin}/` : '../';
  const updated = ctx.updated;
  // English first: Google's OAuth reviewers read the public URL outside the
  // app, and the bilingual policy should lead with the language they use.
  const title = doc.title.en;
  const description = fillText(doc.summary.en, ctx);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · MengYin Study</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta name="robots" content="index, follow" />
<meta name="theme-color" content="#f5f1e8" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#131210" media="(prefers-color-scheme: dark)" />
${canonical}
${themeBootstrap()}
<style>${STYLE}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="${escapeHtml(appHref)}">MengYin Study</a>
  <nav>
    <a href="#en">English</a>
    <a href="#zh">繁體中文</a>
    <a href="${escapeHtml(appHref)}">${escapeHtml(pick(LEGAL_CHROME.back, 'en'))}</a>
  </nav>
</header>
<main>
${renderArticle(doc, 'en', ctx, 'en')}
${renderArticle(doc, 'zh-Hant', ctx, 'zh')}
</main>
<footer class="page-foot"><p>Last updated ${escapeHtml(updated)} · MengYin Study</p></footer>
</body>
</html>
`;
}
