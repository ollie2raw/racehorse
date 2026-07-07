import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(clientDir, '..');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: 'npm run dev',
          cwd: path.join(repoRoot, 'server'),
          url: 'http://127.0.0.1:3001/ping',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: 'npm run dev',
          cwd: clientDir,
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
});
