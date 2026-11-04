import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  // Relative base keeps the build working from file:// (Electron/desktop shell).
  base: './',
  // One .env at the repository root, shared by the web app and the tooling.
  envDir: resolvePath('../..'),
  plugins: [react()],
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
});
