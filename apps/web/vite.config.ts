import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { legalContext } from './src/legal/config';
import { LEGAL_DOCS } from './src/legal/content';
import { renderLegalHtml } from './src/legal/staticHtml';

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
  return {
    name: 'mengyin:legal-documents',
    apply: 'build',
    generateBundle() {
      const overrides: Parameters<typeof legalContext>[0] = {
        origin: (env.VITE_PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, ''),
      };
      const operator = (env.VITE_LEGAL_OPERATOR ?? '').trim();
      if (operator) overrides.operator = operator;
      // Empty means "use the published address in config.ts", not "hide it".
      const contactEmail = (env.VITE_LEGAL_CONTACT_EMAIL ?? '').trim();
      if (contactEmail) overrides.contactEmail = contactEmail;

      const ctx = legalContext(overrides);
      for (const doc of Object.values(LEGAL_DOCS)) {
        this.emitFile({
          type: 'asset',
          fileName: `${doc.slug}/index.html`,
          source: renderLegalHtml(doc, ctx),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // One .env at the repository root, shared by the web app and the tooling.
  const envDir = resolvePath('../..');
  const env = loadEnv(mode, envDir, 'VITE_');

  return {
    // Relative base keeps the build working from file:// (Electron/desktop shell).
    base: './',
    envDir,
    plugins: [react(), legalDocuments(env)],
    resolve: {
      alias: {
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
    },
    preview: {
      port: 4173,
      strictPort: true,
      cors: true,
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      target: 'es2022',
      sourcemap: true,
    },
  };
});
