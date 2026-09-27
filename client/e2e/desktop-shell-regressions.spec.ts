import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { waitForGameServerReady } from './helpers/multiplayerMatch';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await waitForGameServerReady();
});

async function signedInPage(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((id) => {
    localStorage.setItem('racehorse_e2e_user_id', id);
    localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
    localStorage.setItem('hasSeenWelcome', '1');
  }, randomUUID());
  return { context, page: await context.newPage() };
}

async function expectWideShell(page: Page, contentSelector: string) {
  const nav = page.locator('.rh-presentation > .rh-global-nav');
  await expect(nav).toHaveCount(1);
  const navBox = await nav.boundingBox();
  const contentBox = await page.locator(contentSelector).boundingBox();
  expect(navBox).not.toBeNull();
  expect(contentBox).not.toBeNull();
  expect(navBox!.height).toBeGreaterThanOrEqual(70);
  expect(navBox!.height).toBeLessThanOrEqual(86);
  expect(contentBox!.y - navBox!.y - navBox!.height).toBeLessThan(120);
  await expect(page.locator('.rh-bottom-tab-bar')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1536, height: 1024 }]) {
  test(`Daily Fritz leaderboard retains desktop geometry at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const { context, page } = await signedInPage(browser, viewport);
    try {
      await page.route('**/api/daily-fritz/leaderboard/*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, leaderboard: [{
          rank: 1, username: 'geometry-fixture', won: true, finalScore: 150,
          opponentScore: 100, pointDiff: 50, movesUsed: 12, completedAt: new Date().toISOString(),
        }] }),
      }));
      await page.goto('/daily-fritz/leaderboard');
      await expect(page.locator('.dfl-title')).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.dfl-row').first()).toContainText('geometry-fixture');
      await expectWideShell(page, '.dfl-page');
      const navBottom = (await page.locator('.rh-global-nav').boundingBox())!.y +
        (await page.locator('.rh-global-nav').boundingBox())!.height;
      const heading = (await page.locator('.dfl-title').boundingBox())!;
      const row = (await page.locator('.dfl-row').first().boundingBox())!;
      expect(heading.y - navBottom).toBeLessThan(150);
      expect(row.y).toBeLessThan(viewport.height - 80);
    } finally {
      await context.close();
    }
  });
}

test('Daily Fritz loading and start never duplicate app navigation', async ({ browser }) => {
  const { context, page } = await signedInPage(browser, { width: 1440, height: 900 });
  let releaseToday: (() => void) | undefined;
  const todayGate = new Promise<void>((resolve) => { releaseToday = resolve; });
  let releaseStart: (() => void) | undefined;
  const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
  try {
    await page.route('**/api/daily-fritz/today*', async (route) => {
      await todayGate;
      await route.continue();
    });
    await page.route('**/api/daily-fritz/start', async (route) => {
      await startGate;
      await route.continue();
    });
    await page.goto('/daily-fritz');
    await expect(page.locator('.df-fritz-loading-root')).toBeVisible();
      await expect(page.locator('.rh-global-nav, .df-fritz-loading-nav')).toHaveCount(1);
    await expectWideShell(page, '.df-fritz-loading-root');
    releaseToday?.();
    const start = page.locator('.df-pvf-start-btn');
    await expect(start).toBeEnabled({ timeout: 20_000 });
    await expect(page.locator('.rh-global-nav, .df-fritz-loading-nav')).toHaveCount(1);
    await start.click();
    await expect(start).toBeDisabled();
    await expect(page.locator('.rh-global-nav, .df-fritz-loading-nav')).toHaveCount(1);
    releaseStart?.();
    await expect(page.locator('.bot-match-screen.bot-match-mode-daily-fritz')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-surface-shell="gameplay"]')).toBeVisible();
    await expect(page.locator('.rh-global-nav')).toHaveCount(0);
  } finally {
    releaseToday?.();
    releaseStart?.();
    await context.close();
  }
});

for (const route of [
  { path: '/social', content: '.rh-sf-screen', primary: '.rh-sb-title' },
  { path: '/friends', content: '.friends-page', primary: '.friends-page-list-title' },
  { path: '/stats', content: '.rh-stats-page', primary: '.rh-stats' },
  { path: '/learn/how-to-play', content: '.learn-academy__title', primary: '.learn-academy__title' },
]) {
  test(`${route.path} keeps one desktop header and reachable content`, async ({ browser }) => {
    const { context, page } = await signedInPage(browser, { width: 1440, height: 900 });
    try {
      await page.goto(route.path);
      await expect(page.locator(route.primary)).toBeVisible({ timeout: 20_000 });
      await expectWideShell(page, route.content);
    } finally {
      await context.close();
    }
  });
}
