import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { legalContext } from './src/legal/config';
import { LEGAL_DOCS } from './src/legal/content';
import { renderLegalHtml } from './src/legal/staticHtml';
import { normalizeSiteOrigin, renderRobots, renderSitemap } from './src/seo/site';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

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
 * Emits `/sitemap.xml` and `/robots.txt` from the same origin and route list.
 *
 * Keeping them out of `public/` means the production domain is defined once
 * and the sitemap's dates follow the legal documents. Vite's dev server has no
 * build output, so the same files are served from memory there.
 */
function seoFiles(env: Record<string, string>): Plugin {
  const origin = normalizeSiteOrigin(env.VITE_PUBLIC_ORIGIN);
  const files = new Map([
    ['/sitemap.xml', { body: renderSitemap(origin), type: 'application/xml; charset=utf-8' }],
    ['/robots.txt', { body: renderRobots(origin), type: 'text/plain; charset=utf-8' }],
  ]);

  return {
    name: 'mengyin:seo-files',
    generateBundle() {
      for (const [pathname, file] of files) {
        this.emitFile({
          type: 'asset',
          fileName: pathname.slice(1),
          source: file.body,
        });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?')[0] ?? '';
        const file = files.get(pathname);
        if (!file) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', file.type);
        response.end(file.body);
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
