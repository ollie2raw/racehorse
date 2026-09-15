import { defineConfig } from 'vitest/config';

// review-engine's tests import only from `./src` (plus @racehorse/game-core
// contract types). Scoped config so `npm run test -w @racehorse/review-engine`
// (and the CI step of the same name) runs exactly these files and does not
// walk up to the repo-root config, which would pull in the client + server
// suites — same reasoning as game-core/vitest.config.ts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
