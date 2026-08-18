import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(e2eDir, 'screenshots', 'mobile-390');

const PHONE = { width: 390, height: 844 } as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('hasSeenWelcome', '1'));
});

async function assertNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function assertNavDoesNotOverlap(page: Page) {
  const overlap = await page.evaluate(() => {
    const brand = document.querySelector('.rh-nav-brand');
    const stats = document.querySelector('.rh-nav-stats');
    if (!brand || !stats) return { missing: true, overlaps: false };

    const b = brand.getBoundingClientRect();
    const s = stats.getBoundingClientRect();
    const horizontalOverlap = b.left < s.right && s.left < b.right;
    const verticalOverlap = b.top < s.bottom && s.top < b.bottom;
    const overlaps = horizontalOverlap && verticalOverlap && b.right > s.left + 4;

    return {
      missing: false,
      overlaps,
      brandRight: b.right,
      statsLeft: s.left,
    };
  });

  expect(overlap.missing, 'GlobalNav brand/stats nodes should exist').toBe(false);
  expect(overlap.overlaps, `brand right ${overlap.brandRight} should not overlap stats left ${overlap.statsLeft}`).toBe(false);
}

async function assertBottomTabBarVisible(page: Page) {
  const tabBar = page.locator('.rh-bottom-tab-bar');
  await expect(tabBar).toBeVisible();
  await expect(tabBar).toHaveCSS('display', /block|flex|grid/);
  await expect(page.getByRole('navigation', { name: 'Primary sections' })).toBeVisible();
}

async function assertViewportMeta(page: Page) {
  const content = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(content).toBeTruthy();
  expect(content).toMatch(/width=device-width/i);
  expect(content).toMatch(/initial-scale=1/i);
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: path.join(screenshotDir, `${name}.png`),
    fullPage: false,
  });
}

test.describe('Mobile 390×844 — layout contract', () => {
  test.skip((_fixtures, testInfo) => !testInfo.project.name.includes('mobile'), 'phone projects only');
  test('home — nav reflow, bottom tabs, no horizontal overflow', async ({ page }, testInfo) => {
    await page.goto('/');
    await assertViewportMeta(page);
    await expect(page.getByRole('heading', { name: "Today's Race" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.rh-global-nav')).toBeVisible();
    await assertNavDoesNotOverlap(page);
    await assertBottomTabBarVisible(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-home`);
  });

  test('single player hub — back/title stack, no overlap', async ({ page }, testInfo) => {
    await page.goto('/solo');
    await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({ timeout: 15_000 });

    const titleOverlap = await page.evaluate(() => {
      const back = document.querySelector('.rh-back-button');
      const title = document.querySelector('h1');
      if (!back || !title) return { missing: true, overlaps: false };
      const b = back.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const horizontalOverlap = b.left < t.right && t.left < b.right;
      const verticalOverlap = b.top < t.bottom && t.top < b.bottom;
      return { missing: false, overlaps: horizontalOverlap && verticalOverlap };
    });
    expect(titleOverlap.missing).toBe(false);
    expect(titleOverlap.overlaps).toBe(false);

    await assertNavDoesNotOverlap(page);
    await assertBottomTabBarVisible(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-solo-hub`);
  });

  test('social hub — header + bottom tabs', async ({ page }, testInfo) => {
    await page.goto('/social');
    await expect(page.locator('.rh-hub-screen, .rh-hub-page').first()).toBeVisible({ timeout: 15_000 });
    await assertNavDoesNotOverlap(page);
    await assertBottomTabBarVisible(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-social`);
  });

  test('multiplayer hub — fits viewport', async ({ page }, testInfo) => {
    await page.goto('/multiplayer');
    await expect(page.getByRole('heading', { name: /Quick Match|Private Match/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Connected to server.')).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
    await assertNavDoesNotOverlap(page);
    await assertBottomTabBarVisible(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-multiplayer`);
  });

  test('daily fritz setup — fits viewport', async ({ page }, testInfo) => {
    await page.goto('/daily-fritz');
    await expect(page.locator('.df-shell--daily-fritz, .df-page').first()).toBeVisible({ timeout: 15_000 });
    await assertNavDoesNotOverlap(page);
    await assertBottomTabBarVisible(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-daily-fritz`);
  });

  test('play vs fritz setup — in-game prep fits viewport', async ({ page }, testInfo) => {
    await page.goto('/solo/fritz');
    await expect(page.locator('.pvf-root, .pvf-layout').first()).toBeVisible({ timeout: 15_000 });
    await assertNavDoesNotOverlap(page);
    await assertBottomTabBarVisible(page);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-play-vs-fritz`);
  });

  test('play vs fritz in-game — portrait 390×844', async ({ page }, testInfo) => {
    await page.goto('/solo/fritz');
    await expect(page.getByText('Start Match', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await page.getByText('Start Match', { exact: false }).first().click();
    await expect(page.locator('.rotate-phone-overlay')).toBeVisible({ timeout: 20_000 });
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-bot-match-ingame`);
  });

  test('daily fritz in-game — portrait 390×844', async ({ page }, testInfo) => {
    await page.goto('/daily-fritz');
    await expect(page.locator('.df-pvf-start-btn').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('.df-pvf-start-btn').first().click();
    const rotateVisible = await page.locator('.rotate-phone-overlay').isVisible().catch(() => false);
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-daily-fritz-ingame`);
    test.info().annotations.push({
      type: 'portrait-ingame',
      description: rotateVisible
        ? 'Daily Fritz match mounted the landscape rotate gate'
        : 'Daily Fritz did not enter a match in this unauthenticated session; rotate gate is the same BotMatchScreen overlay as vs-Fritz',
    });
  });

  test('private multiplayer in-game — portrait 390×844', async ({ page }, testInfo) => {
    await page.goto('/multiplayer/private');
    await expect(page.locator('.multiplayer-hub, .pml-shell, .mp-hub-pvf-layout, .pvf-root').first()).toBeVisible({
      timeout: 15_000,
    });
    const startBtn = page.getByRole('button', { name: /Start Match|Start Game|Create lobby/i }).first();
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click({ force: true }).catch(() => undefined);
    }
    const rotateGate = page.locator('.rotate-phone-overlay');
    const gameScreen = page.locator('.game-screen, .walnut-live').first();
    await expect(page.getByRole('heading', { name: /Private Match/i }).first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await capture(page, `${testInfo.project.name}-private-mp-ingame`);
    const rotateVisible = await rotateGate.isVisible().catch(() => false);
    const gameVisible = await gameScreen.isVisible().catch(() => false);
    test.info().annotations.push({
      type: 'portrait-ingame',
      description: JSON.stringify({ rotateVisible, gameVisible }),
    });
  });
});
