import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(clientDir, '..');
// The reachability harness runs on its own port with a guaranteed-fresh dev
// server (reuseExistingServer:false below). A stale server on :5173 — one left
// running from before a postcss.config.js / breakpoint change — silently serves
// unresolved `@media (--phone)` etc. and makes the whole matrix a lie. Isolating
// the port + forcing a rebuild is the fix.
const REACHABILITY = !!process.env.REACHABILITY || !!process.env.REACHABILITY_AUTHED;
const CLIENT_PORT = REACHABILITY ? 5233 : 5173;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${CLIENT_PORT}`;
const PHONE = { width: 390, height: 844 } as const;

export default defineConfig({
  testDir: './e2e',
  // Aborts the run if the client dev server is serving stale config (issue
  // #119) — see e2e/globalSetup.ts.
  globalSetup: './e2e/globalSetup.ts',
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
      testMatch: /mobile-390.*\.spec\.ts/,
      use: {
        ...devices['Pixel 5'],
        viewport: PHONE,
      },
    },
    // WebKit is verified locally; CI only installs Chromium.
    ...(!process.env.CI
      ? [
          {
            name: 'webkit-mobile',
            testMatch: /mobile-390.*\.spec\.ts/,
            use: {
              ...devices['iPhone 12'],
              viewport: PHONE,
            },
          },
        ]
      : []),
    {
      name: 'chromium',
      testIgnore: [/mobile-390.*\.spec\.ts/, /mobile-reachability\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    // Repo-wide mobile reachability harness (tap targets + h-overflow across
    // 21 routes × 3 viewports). Sets its own viewport per test. Opt-in via
    // REACHABILITY=1 (npm run e2e:reachability) so it stays out of the blocking
    // `e2e` gate until its matrix is green. See docs/breakpoints.md.
    ...(process.env.REACHABILITY && !process.env.REACHABILITY_AUTHED
      ? [
          {
            name: 'mobile-reachability',
            testMatch: /mobile-reachability\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
            // Each test settles, then measures twice 500ms apart; live-socket
            // routes can burn the full settle cap. 90s keeps well clear.
            timeout: 90_000,
          },
        ]
      : []),
    // Authenticated reachability pass (issue #116) — same matrix, signed in via
    // the .auth/daily-fritz-qa.json fixture so /friends, /stats, /settings etc.
    // render real content. Local-only, informational; auto-skips without a
    // fixture. `npm run e2e:reachability:authed`.
    ...(process.env.REACHABILITY_AUTHED
      ? [
          {
            name: 'mobile-reachability-authed',
            testMatch: /mobile-reachability\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
            timeout: 90_000,
          },
        ]
      : []),
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
          command: `npm run dev -- --port ${CLIENT_PORT} --strictPort`,
          cwd: clientDir,
          url: `http://localhost:${CLIENT_PORT}`,
          // Reachability always builds fresh — never inherit a stale server's
          // unresolved custom-media. Other projects keep the reuse convenience.
          reuseExistingServer: REACHABILITY ? false : !process.env.CI,
          timeout: 60_000,
          env: {
            ...process.env,
            VITE_SERVER_URL: 'http://localhost:3001',
          },
        },
      ],
});
