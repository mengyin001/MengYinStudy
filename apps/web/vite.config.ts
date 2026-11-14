import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { legalContext } from './src/legal/config';
import { LEGAL_DOCS } from './src/legal/content';
import { renderLegalHtml } from './src/legal/staticHtml';
import {
  officialRoutes,
  renderOfficialPages,
  type OfficialDeck,
  type OfficialPack,
  type OfficialQuestion,
} from './src/seo/official';
import { normalizeSiteOrigin, renderRobots, renderSitemap, sitemapRoutes } from './src/seo/site';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];

const zhText = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  return textOrUndefined(value['zh-Hant']);
};

const SAFE_SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Bundled guest decks are not part of the published official catalogue. The
 * SEO pages follow the same catalogue the app receives from Supabase, not the
 * demo plugin that ships in the repository.
 */
const NON_CATALOGUE_PACK_IDS = new Set(['starter.study']);

function toQuestion(value: unknown, deckId: string, index: number): OfficialQuestion | null {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !value.prompt.trim()) return null;
  return {
    id: typeof value.id === 'string' && value.id ? value.id : `${deckId}-q${index + 1}`,
    type: typeof value.type === 'string' && value.type ? value.type : 'single',
    prompt: value.prompt,
    tags: textList(value.tags),
    ...(typeof value.difficulty === 'number' ? { difficulty: value.difficulty } : {}),
  };
}

function toDeck(value: unknown): OfficialDeck | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || !SAFE_SLUG.test(value.id)) return null;
  if (typeof value.title !== 'string' || !value.title.trim()) return null;
  const questions = Array.isArray(value.questions)
    ? value.questions.flatMap((question, index) => {
        const mapped = toQuestion(question, value.id as string, index);
        return mapped ? [mapped] : [];
      })
    : [];
  if (questions.length === 0) return null;

  return {
    id: value.id,
    title: value.title,
    ...(zhText(value.titleI18n) ? { titleZh: zhText(value.titleI18n) } : {}),
    ...(textOrUndefined(value.description) ? { description: textOrUndefined(value.description) } : {}),
    ...(zhText(value.descriptionI18n) ? { descriptionZh: zhText(value.descriptionI18n) } : {}),
    tags: textList(value.tags),
    ...(typeof value.examMinutes === 'number' ? { examMinutes: value.examMinutes } : {}),
    questions,
  };
}

/**
 * The official catalogue is a set of plugin JSON files under `plugins/`. They
 * are the same files the app syncs into `public/plugins`, so the SEO pages and
 * the in-app decks can never disagree.
 */
function loadOfficialPacks(): OfficialPack[] {
  const root = resolvePath('../../plugins');
  if (!existsSync(root)) return [];

  const packs: OfficialPack[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    if (!SAFE_SLUG.test(entry.name)) continue;

    const packDir = join(root, entry.name);
    const manifestFile = join(packDir, 'manifest.json');
    const decksDir = join(packDir, 'decks');
    if (!existsSync(manifestFile) || !existsSync(decksDir)) continue;

    try {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as unknown;
      if (!isRecord(manifest) || typeof manifest.id !== 'string' || typeof manifest.name !== 'string') {
        continue;
      }
      if (NON_CATALOGUE_PACK_IDS.has(manifest.id)) continue;

      const decks: OfficialDeck[] = [];
      for (const file of readdirSync(decksDir).filter((name) => name.endsWith('.json')).sort()) {
        try {
          const deck = toDeck(JSON.parse(readFileSync(join(decksDir, file), 'utf8')) as unknown);
          if (deck) decks.push(deck);
        } catch (error) {
          console.warn(`[seo] skipped ${entry.name}/decks/${file}: ${String(error)}`);
        }
      }
      if (decks.length === 0) continue;

      packs.push({
        dir: entry.name,
        id: manifest.id,
        name: manifest.name,
        ...(textOrUndefined(manifest.description) ? { description: textOrUndefined(manifest.description) } : {}),
        ...(textOrUndefined(manifest.author) ? { author: textOrUndefined(manifest.author) } : {}),
        ...(textOrUndefined(manifest.license) ? { license: textOrUndefined(manifest.license) } : {}),
        tags: textList(manifest.tags),
        decks,
      });
    } catch (error) {
      console.warn(`[seo] skipped official pack ${entry.name}: ${String(error)}`);
    }
  }

  return packs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Emits `/privacy/index.html` and `/terms/index.html` from the same content the
 * in-app pages use.
 *
 * App stores ask for two URLs and open them outside the app, so the output is
 * self-contained HTML: readable with JavaScript disabled, no bundle to load,
 * and not affected by the hash-routed SPA.
 */
function legalDocuments(env: Record<string, string>): Plugin {
  const overrides: Parameters<typeof legalContext>[0] = {
    origin: normalizeSiteOrigin(env.VITE_PUBLIC_ORIGIN),
  };
  const operator = (env.VITE_LEGAL_OPERATOR ?? '').trim();
  if (operator) overrides.operator = operator;
  // Empty means "use the published address in config.ts", not "hide it".
  const contactEmail = (env.VITE_LEGAL_CONTACT_EMAIL ?? '').trim();
  if (contactEmail) overrides.contactEmail = contactEmail;
  const ctx = legalContext(overrides);

  return {
    name: 'mengyin:legal-documents',
    generateBundle() {
      for (const doc of Object.values(LEGAL_DOCS)) {
        this.emitFile({
          type: 'asset',
          fileName: `${doc.slug}/index.html`,
          source: renderLegalHtml(doc, ctx),
        });
      }
    },
    // The production build writes real /privacy/ and /terms/ files. Vite's
    // dev server has no such files, so serve the same HTML from memory there;
    // otherwise testing the homepage's legal links would land on the SPA.
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0] ?? '';
        const match = /^\/(privacy|terms)\/?$/.exec(pathname);
        if (!match) {
          next();
          return;
        }
        const doc = LEGAL_DOCS[match[1] as keyof typeof LEGAL_DOCS];
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(renderLegalHtml(doc, ctx));
      });
    },
  };
}

/**
 * Emits `/sitemap.xml`, `/robots.txt`, the public guide and one page per
 * official collection and question bank.
 *
 * Keeping them out of `public/` means the production domain is defined once
 * and the sitemap follows the legal documents and the official catalogue.
 * Vite's dev server has no build output, so the same files are served from
 * memory there.
 */
function seoFiles(env: Record<string, string>): Plugin {
  const origin = normalizeSiteOrigin(env.VITE_PUBLIC_ORIGIN);
  const packs = loadOfficialPacks();
  const pages = renderOfficialPages(packs, origin);
  const files = new Map<string, { body: string; type: string }>([
    [
      '/sitemap.xml',
      {
        body: renderSitemap(origin, sitemapRoutes(officialRoutes(packs))),
        type: 'application/xml; charset=utf-8',
      },
    ],
    ['/robots.txt', { body: renderRobots(origin), type: 'text/plain; charset=utf-8' }],
  ]);
  for (const page of pages) {
    files.set(page.path, { body: page.html, type: 'text/html; charset=utf-8' });
  }

  return {
    name: 'mengyin:seo-files',
    generateBundle() {
      for (const [pathname, file] of files) {
        const fileName = pathname.endsWith('/')
          ? `${pathname.slice(1)}index.html`
          : pathname.slice(1);
        this.emitFile({
          type: 'asset',
          fileName,
          source: file.body,
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0] ?? '';
        const file = files.get(pathname);
        if (file) {
          response.statusCode = 200;
          response.setHeader('Content-Type', file.type);
          response.end(file.body);
          return;
        }
        const section = files.get(`${pathname}/`);
        if (section) {
          response.statusCode = 301;
          response.setHeader('Location', `${pathname}/`);
          response.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // One .env at the repository root, shared by the web app and the tooling.
  const envDir = resolvePath('../..');
  const env = loadEnv(mode, envDir, 'VITE_');
  // `npm run dev:api` serves the Worker locally on 8787. A separate deployment
  // can point VITE_AI_API_BASE at an absolute URL instead.
  const apiProxy = (env.VITE_AI_API_PROXY ?? '').trim() || 'http://127.0.0.1:8787';
  const proxy = { '/api': { target: apiProxy, changeOrigin: true } };

  return {
    // Relative base keeps the build working from file:// (Electron/desktop shell).
    base: './',
    envDir,
    plugins: [react(), legalDocuments(env), seoFiles(env)],
    resolve: {
      alias: {
        '@mengyin/ai-contract': resolvePath('../../packages/ai-contract/src/index.ts'),
        '@mengyin/core': resolvePath('../../packages/core/src/index.ts'),
        '@mengyin/plugin-sdk': resolvePath('../../packages/plugin-sdk/src/index.ts'),
        '@': resolvePath('./src'),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      host: '127.0.0.1',
      // The sandbox iframe is an opaque origin; its runtime fetches need CORS.
      cors: true,
      // Editing tools write through temporary directories; watching those
      // files can fail with EBUSY on Windows and take the dev server down.
      watch: { ignored: ['**/.*.tmpdir/**', '**/*.tmp'] },
      proxy,
    },
    preview: {
      port: 4173,
      strictPort: true,
      cors: true,
      proxy,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
    },
  };
});
