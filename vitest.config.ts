import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@racehorse/game-core/bot': path.resolve(root, 'packages/game-core/src/botHeuristics.ts'),
      '@racehorse/game-core/build-stamp': path.resolve(root, 'packages/game-core/src/buildStamp.ts'),
      '@racehorse/game-core': path.resolve(root, 'packages/game-core/src/index.ts'),
      '@racehorse/match-protocol': path.resolve(root, 'packages/match-protocol/src/index.ts'),
    },
  },
  plugins: [react()],
  test: {
    root: root,
    environment: 'node',
    globals: true,
    // Server tests use module-level mutable state — run in a single process to avoid cross-test pollution
    fileParallelism: false,
    maxWorkers: 1,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        execArgv: ['--max-old-space-size=8192'],
      },
    },
    environmentMatchGlobs: [
      // Client tests need DOM APIs
      ['client/src/**', 'jsdom'],
      ['client/scripts/**', 'jsdom'],
    ],
    setupFiles: [path.join(root, 'vitest.setup.ts')],
    include: [
      'client/src/**/*.test.ts',
      'client/src/**/*.test.tsx',
      'client/scripts/**/*.test.ts',
      'server/src/**/*.test.ts',
      'packages/game-core/src/**/*.test.ts',
      'packages/match-protocol/src/**/*.test.ts',
    ],
    // e2e Playwright specs must never run under vitest
    exclude: ['**/node_modules/**', '**/dist/**', 'client/e2e/**'],
  },
});
