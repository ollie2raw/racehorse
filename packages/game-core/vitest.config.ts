import { defineConfig } from 'vitest/config';

// game-core is a pure, dependency-free package — its tests import only from
// `./src`. Scoped config so `npm run test -w @racehorse/game-core` (and the CI
// step of the same name) runs exactly these files and does not walk up to the
// repo-root config, which would pull in the client + server suites.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
