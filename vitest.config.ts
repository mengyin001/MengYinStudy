import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@mengyin/core': resolvePath('./packages/core/src/index.ts'),
      '@mengyin/plugin-sdk': resolvePath('./packages/plugin-sdk/src/index.ts'),
      '@': resolvePath('./apps/web/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    reporters: ['default'],
  },
});
