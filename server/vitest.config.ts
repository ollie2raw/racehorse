import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  resolve: {
    alias: {
      '@racehorse/game-core': path.resolve(root, 'packages/game-core/src/index.ts'),
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    include: ['src/**/*.test.ts'],
    // The server suite imports several large route/game graphs. Multiple fork
    // heaps exceed GitHub's runner memory near the end of an otherwise green
    // run. One isolated worker is faster than CI retries.
    fileParallelism: false,
    maxWorkers: 1,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        // NODE_OPTIONS on the parent does not reliably apply to vitest forks.
        execArgv: ['--max-old-space-size=8192'],
      },
    },
  },
});
