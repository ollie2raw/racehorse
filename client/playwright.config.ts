import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(clientDir, '..');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'teardown',
      testMatch: /auth\.teardown\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      teardown: 'teardown',
    },
    {
      name: 'circuit-smoke',
      testMatch: /circuit-(smoke|capture)\.spec\.ts|solo-hub-no-circuit\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'stakes-smoke',
      testMatch: /stakes-prototype-smoke\.spec\.ts|capture-stakes-screenshots\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
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
