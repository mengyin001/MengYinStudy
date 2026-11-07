import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

const resolvePath = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@mengyin/ai-contract': resolvePath('./packages/ai-contract/src/index.ts'),
      '@mengyin/core': resolvePath('./packages/core/src/index.ts'),
      '@mengyin/plugin-sdk': resolvePath('./packages/plugin-sdk/src/index.ts'),
      '@': resolvePath('./apps/web/src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
    ],
    reporters: ['default'],
  },
});
