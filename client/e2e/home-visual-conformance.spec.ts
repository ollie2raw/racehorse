import { expect, test, type Page } from '@playwright/test';
import { installMobileFixture } from './fixtures/mobile/loader';
import { MOBILE_LANDSCAPE_VIEWPORTS, MOBILE_PORTRAIT_VIEWPORT, expectNoHorizontalOverflow, mobileScreenshotName, waitForMobileVisualStability } from './fixtures/mobile/visualHarness';

const diagnosticDir = process.env.HOME_DIAGNOSTIC_DIR;
type HomeState = 'home/not-played' | 'home/completed';

async function openHome(page: Page, state: HomeState) {
  const fixture = await installMobileFixture(page, state);
  await page.goto('/');
  await waitForMobileVisualStability(page);
  fixture.assertNoUnexpectedApiCalls();
  fixture.assertApiUsed('/api/home/daily-summary');
}

async function assertReachable(page: Page, viewport: { width: number; height: number }) {
  await expectNoHorizontalOverflow(page);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(documentHeight).toBeLessThanOrEqual(viewport.height + 1);
  await expect(page.getByRole('heading', { name: "Today's Race" })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary sections' });
  const compact = viewport.width < 769 || viewport.height < 600;
  if (compact) {
    await expect(nav).toBeVisible();
    await expect(nav.locator('button')).toHaveCount(5);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  }
  const navBox = compact ? await nav.boundingBox() : null;
  if (compact && viewport.width > 500) {
    const homeScroll = await page.locator('.home-main').evaluate((element) => ({ content: element.scrollHeight, viewport: element.clientHeight }));
    expect(homeScroll.content, 'landscape Home should compose without internal scrolling').toBeLessThanOrEqual(homeScroll.viewport + 1);
  }
  for (const selector of ['.daily-fritz-card-container button', '.daily-puzzle-card-container button', '.streak-strip']) {
    const target = page.locator(selector).first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box, `${selector} has no box`).not.toBeNull();
    if (!box) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    if (compact && viewport.width > 500) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${selector} falls under tabs`).toBeLessThanOrEqual((navBox?.y ?? viewport.height) + 1);
    }
  }
}

for (const state of ['home/not-played', 'home/completed'] as const) {
  test(`approved Home ${state} at 844x390`, async ({ page }) => {
    const viewport = { width: 844, height: 390 };
    await page.setViewportSize(viewport);
    await openHome(page, state);
    await assertReachable(page, viewport);
    const cards = await Promise.all(['.daily-fritz-card-container', '.daily-puzzle-card-container'].map((selector) => page.locator(selector).boundingBox()));
    expect(cards[0]).not.toBeNull();
    expect(cards[1]).not.toBeNull();
    if (cards[0] && cards[1]) {
      expect(Math.abs(cards[0].width - cards[1].width)).toBeLessThan(3);
      const gap = cards[1].x - cards[0].x - cards[0].width;
      expect(gap).toBeGreaterThanOrEqual(9);
      expect(gap).toBeLessThanOrEqual(16);
      expect(Math.abs(cards[0].y - cards[1].y)).toBeLessThan(2);
      const streak = await page.locator('.streak-strip').boundingBox();
      expect((streak?.y ?? 0) - (cards[0].y + cards[0].height)).toBeGreaterThanOrEqual(5);
    }
    const boxes = await Promise.all(['.daily-fritz-card-container button', '.daily-puzzle-card-container button'].map((selector) => page.locator(selector).first().boundingBox()));
    expect(boxes.every((box) => box && box.height >= 44)).toBe(true);
    expect(Math.abs((boxes[0]?.y ?? 0) - (boxes[1]?.y ?? 0))).toBeLessThan(3);
    if (state === 'home/completed') {
      await expect(page.locator('.daily-fritz-card-container')).toContainText('Placement');
      await expect(page.locator('.daily-fritz-card-container')).toContainText('View Results');
      await expect(page.locator('.streak-label')).toContainText('4 Day Streak');
      await expect(page.locator('.daily-puzzle-card-container')).toContainText('Not played yet today');
      await expect(page.locator('.daily-puzzle-card-container button').first()).toHaveAccessibleName(/play/i);
    } else {
      await expect(page.locator('.daily-fritz-card-container')).toContainText('Not played yet today');
      await expect(page.locator('.daily-puzzle-card-container')).toContainText('Not played yet today');
      await expect(page.locator('.streak-label')).toContainText('3 Day Streak');
    }
    if (diagnosticDir) await page.screenshot({ path: `${diagnosticDir}/after-home-844x390-${state.split('/')[1]}.png` });
    await expect(page).toHaveScreenshot(mobileScreenshotName(state, viewport), { animations: 'disabled', maxDiffPixelRatio: 0.02 });
  });
}

for (const viewport of [...MOBILE_LANDSCAPE_VIEWPORTS, MOBILE_PORTRAIT_VIEWPORT, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  if (viewport.width === 844) continue;
  test(`Home reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openHome(page, 'home/not-played');
    await assertReachable(page, viewport);
    if (diagnosticDir) await page.screenshot({ path: `${diagnosticDir}/after-home-${viewport.width}x${viewport.height}.png` });
  });
}

test('Home actions use real daily destinations', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openHome(page, 'home/not-played');
  await page.locator('.daily-puzzle-card-container button').first().click();
  await expect(page).toHaveURL(/\/puzzle-rush$/);
  const completed = await page.context().newPage();
  try {
    await completed.setViewportSize({ width: 844, height: 390 });
    await openHome(completed, 'home/completed');
    await completed.locator('.daily-fritz-card-container button').first().click();
    await expect(completed).toHaveURL(/\/daily-fritz$/);
  } finally {
    await completed.close();
  }
});

test('Home Fritz action keeps native keyboard and focus behavior', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openHome(page, 'home/not-played');
  const playFritz = page.locator('.daily-fritz-card-container button').first();
  await page.keyboard.press('Tab');
  await playFritz.focus();
  await expect(playFritz).toBeFocused();
  await expect(playFritz).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/daily-fritz$/);
});
