import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  resolve: {
    alias: {
      '@racehorse/game-core/bot': path.resolve(root, 'packages/game-core/src/botHeuristics.ts'),
      '@racehorse/game-core/build-stamp': path.resolve(root, 'packages/game-core/src/buildStamp.ts'),
      // E2: @racehorse/review-engine's own source imports this subpath
      // internally (reviewAccuracy.ts, gameAccuracyModel.ts) -- aliased so
      // it resolves to source under vitest the same way the bare
      // @racehorse/game-core alias below does, not just via a pre-built
      // dist (which CI always has ready, but local dev may not).
      '@racehorse/game-core/review': path.resolve(root, 'packages/game-core/src/reviewContracts.ts'),
      '@racehorse/game-core/invariants': path.resolve(root, 'packages/game-core/src/invariants.ts'),
      '@racehorse/game-core': path.resolve(root, 'packages/game-core/src/index.ts'),
      '@racehorse/review-engine': path.resolve(root, 'packages/review-engine/src/index.ts'),
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
