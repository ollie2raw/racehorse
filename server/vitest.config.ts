import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    include: ['src/**/*.test.ts'],
    // Cap parallelism in CI to keep Node heap under ubuntu-latest limits.
    ...(process.env.CI ? { maxWorkers: 1 } : {}),
  },
});
