import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(clientDir, '..');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';
const PHONE = { width: 390, height: 844 } as const;

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
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
        viewport: PHONE,
      },
    },
    {
      name: 'webkit-mobile',
      use: {
        ...devices['iPhone 12'],
        viewport: PHONE,
      },
    },
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
          env: {
            ...process.env,
            // Unlock winningScore=5 so rematch/leave protocol proof can finish in E2E.
            MP_PRIVATE_CERT_MODE: '1',
            E2E_INSPECT: '1',
            DAILY_FRITZ_MEMORY_STORE: '1',
            DAILY_FRITZ_TEST_FIXTURES_ENABLED: 'true',
            NODE_ENV: process.env.NODE_ENV === 'production' ? 'development' : (process.env.NODE_ENV ?? 'development'),
          },
        },
        {
          command: 'npm run dev',
          cwd: clientDir,
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          env: {
            ...process.env,
            VITE_SERVER_URL: 'http://localhost:3001',
          },
        },
      ],
});
