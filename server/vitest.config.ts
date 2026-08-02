import { defineConfig } from 'vitest/config';

export default defineConfig({
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
