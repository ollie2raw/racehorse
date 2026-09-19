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

// The first-visit welcome modal (useAppSessionUi → welcomeOpen) renders a
// full-screen backdrop that intercepts pointer events until dismissed. Every
// spec that isn't specifically exercising it wants it pre-dismissed; seed the
// `hasSeenWelcome` flag into the default context's storage. Specs that build
// their own `browser.newContext()` seed it themselves (see
// helpers/multiplayerMatch.ts). `welcome-modal.spec.ts` opts back out.
const WELCOME_DISMISSED = {
  cookies: [],
  origins: [
    {
      origin: `http://localhost:${CLIENT_PORT}`,
      localStorage: [{ name: 'hasSeenWelcome', value: '1' }],
    },
  ],
};

const CI = !!process.env.CI;

// CI_SPEED_SCOPING.md §4 (Playwright worker parallelization, 2026-09-18):
// grouped by real, audited shared-state coupling on the CI runner -- not a
// blind numeric split. Every file below was individually checked (an
// exhaustive 23-spec pass, not just the two files originally suspected) for
// touching server-side state that isn't safely per-test: Daily Fritz's
// date-keyed in-memory store (dailyFritzMemoryStore.ts), or a shared-IP
// rate limit. Two real misclassifications were caught and corrected before
// this config existed: `fritz-play-to-completion.spec.ts` was wrongly
// grouped as touching the Daily Fritz store (it's Play vs Fritz -- kept
// serial anyway, for its own reason, below); `mobile-390.spec.ts` was
// missed entirely (its 'daily fritz setup'/'daily fritz in-game' tests
// really do start a Daily Fritz attempt). See CI_SPEED_SCOPING.md §4 for
// the full per-file reasoning, including `routing.spec.ts` and
// `spectator-mode.spec.ts`, deliberately left in the parallel group as an
// open, not-yet-decided question rather than silently guessed either way.
//
// Only the CI runner's worker budget changes here -- local dev runs stay at
// the previous workers:1 behavior (matches the existing `retries` CI-gating
// pattern below), since the state-coupling risk this split manages is
// specific to CI's shared runner IP and shared server process, not a local
// machine.
const DF_SERIAL_DESKTOP_SPECS = [
  'daily-fritz-v2.spec.ts',
  'daily-fritz-server-restore.spec.ts',
  // Not Daily-Fritz-store-coupled (confirmed) -- grouped serial only
  // because it's the suite's single slowest file (real played-out
  // matches); whether it could safely move to the parallel group instead
  // is an open question for a later pass, not settled by this split.
  'fritz-play-to-completion.spec.ts',
];
const MULTIPLAYER_SPECS = ['multiplayer-chaos.spec.ts', 'multiplayer-in-match-reconnect.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  // Aborts the run if the client dev server is serving stale config (issue
  // #119) — see e2e/globalSetup.ts.
  globalSetup: './e2e/globalSetup.ts',
  fullyParallel: CI,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Total worker budget for CI; each project below caps itself under this
  // via its own `workers` (Playwright limits a project's workers to
  // min(project.workers, this total) — CI_SPEED_SCOPING.md §4).
  workers: CI ? 4 : 1,
  reporter: CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    storageState: WELCOME_DISMISSED,
  },
  projects: [
    // Daily-Fritz-store-coupled mobile test -- see DF_SERIAL_DESKTOP_SPECS'
    // comment above. Split out of the general chromium-mobile project
    // (below) specifically so it can stay workers:1 while
    // mobile-390-hub-containment.spec.ts (not DF-coupled) parallelizes.
    {
      name: 'chromium-mobile-df-serial',
      testMatch: ['mobile-390.spec.ts'],
      workers: 1,
      use: {
        ...devices['Pixel 5'],
        viewport: PHONE,
      },
    },
    {
      name: 'chromium-mobile',
      testMatch: /mobile-390.*\.spec\.ts/,
      testIgnore: ['mobile-390.spec.ts'],
      use: {
        ...devices['Pixel 5'],
        viewport: PHONE,
      },
    },
    // WebKit is verified locally; CI only installs Chromium. Local runs stay
    // serial regardless (workers:1 above), so no DF-serial/parallel split is
    // needed here -- this project is unaffected by the CI worker change.
    ...(!CI
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
      name: 'chromium-df-serial',
      testMatch: DF_SERIAL_DESKTOP_SPECS,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-multiplayer',
      testMatch: MULTIPLAYER_SPECS,
      // Parallelize the two files against each other, but at a lower cap
      // than the general pool -- these are the specs most likely to
      // legitimately burst requests (chaos/reconnect scenarios), so this
      // keeps shared-IP rate-limit headroom (CI_SPEED_SCOPING.md §4 point 2).
      // multiplayer-in-match-reconnect.spec.ts already self-serializes its
      // own tests (`test.describe.configure({ mode: 'serial' })`); this
      // only governs whether the two FILES can run concurrently with each
      // other.
      workers: 2,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: [
        /mobile-390.*\.spec\.ts/,
        /mobile-reachability\.spec\.ts/,
        ...DF_SERIAL_DESKTOP_SPECS,
        ...MULTIPLAYER_SPECS,
      ],
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
            // journey-premium-*.spec.ts run anonymously and need to reach
            // Journey content, which is otherwise gated to the admin
            // account (see isAdminUser.ts) — never set outside this
            // Playwright-launched dev server.
            VITE_E2E_ADMIN_BYPASS: '1',
          },
        },
      ],
});
