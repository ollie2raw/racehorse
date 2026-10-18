import { defineConfig } from '@playwright/test';

/** Isolated frontend fixtures: no backend, accounts, or production connections. */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['game-feel.spec.ts', 'board-routing.spec.ts'],
  timeout: 30_000,
  outputDir: 'test-results/game-feel',
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5199' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'phone-landscape', testMatch: 'game-feel.spec.ts', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
    { name: 'safari-landscape', testMatch: 'game-feel.spec.ts', use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5199',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: !process.env.CI,
  },
});
