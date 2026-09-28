import { expect, test, type Page } from '@playwright/test';
import { installMobileFixture } from './fixtures/mobile/loader';
import { MOBILE_LANDSCAPE_VIEWPORTS, MOBILE_PORTRAIT_VIEWPORT, expectNoHorizontalOverflow, mobileScreenshotName, waitForMobileVisualStability } from './fixtures/mobile/visualHarness';

const diagnosticDir = process.env.SOLO_DIAGNOSTIC_DIR;
type SoloState = 'solo/empty' | 'solo/populated' | 'solo/journey-locked';
const SOLO_STATES: SoloState[] = ['solo/empty', 'solo/populated', 'solo/journey-locked'];
const RAIL_MAX_WIDTH = 700;

async function openSolo(page: Page, state: SoloState) {
  const fixture = await installMobileFixture(page, state);
  await page.goto('/solo');
  await waitForMobileVisualStability(page);
  fixture.assertNoUnexpectedApiCalls();
  fixture.assertApiUsed('/api/ranking/history/e2e-mobile-user');
  fixture.assertApiUsed('/api/ghost/profile/e2e-mobile-user');
}

async function assertReachable(page: Page, viewport: { width: number; height: number }) {
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary sections' });
  const compact = viewport.width < 769 || viewport.height < 600;
  if (compact) {
    await expect(nav).toBeVisible();
    await expect(nav.locator('button')).toHaveCount(5);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.sp-solo-main .rh-back-button')).toBeHidden();
  }
  const cards = page.locator('.sp-solo-mode-card');
  await expect(cards).toHaveCount(3);
  const isRail = viewport.width <= RAIL_MAX_WIDTH && compact && viewport.height <= 430;
  const firstCard = cards.first();
  await expect(firstCard).toBeVisible();
  const firstBox = await firstCard.boundingBox();
  expect(firstBox).not.toBeNull();
  if (firstBox) {
    expect(firstBox.x).toBeGreaterThanOrEqual(0);
    if (!isRail) expect(firstBox.x + firstBox.width).toBeLessThanOrEqual(viewport.width + 1);
  }
  const cta = firstCard.locator('.sp-solo-mode-card__cta');
  await expect(cta).toBeVisible();
  const ctaBox = await cta.boundingBox();
  expect(ctaBox?.height, 'CTA must stay >=44px tall').toBeGreaterThanOrEqual(44);
}

for (const state of SOLO_STATES) {
  test(`Solo ${state} at 844x390 canonical geometry`, async ({ page }) => {
    const viewport = { width: 844, height: 390 };
    await page.setViewportSize(viewport);
    await openSolo(page, state);
    await assertReachable(page, viewport);
    const cards = await page.locator('.sp-solo-mode-card').all();
    const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
    expect(boxes.every((box) => box !== null)).toBe(true);
    if (boxes[0] && boxes[1] && boxes[2]) {
      for (const box of boxes) {
        expect(box!.width).toBeGreaterThanOrEqual(255);
        expect(box!.width).toBeLessThanOrEqual(272);
      }
      const gap1 = boxes[1]!.x - boxes[0]!.x - boxes[0]!.width;
      const gap2 = boxes[2]!.x - boxes[1]!.x - boxes[1]!.width;
      expect(gap1).toBeGreaterThanOrEqual(9);
      expect(gap1).toBeLessThanOrEqual(15);
      expect(Math.abs(gap1 - gap2)).toBeLessThan(2);
      expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
      expect(Math.abs(boxes[1]!.y - boxes[2]!.y)).toBeLessThan(2);
    }
    if (state === 'solo/empty') {
      await expect(page.locator('.sp-solo-mode-card').first().getByText('—')).toHaveCount(2);
    }
    if (state === 'solo/journey-locked' || state === 'solo/empty' || state === 'solo/populated') {
      await expect(page.locator('.sp-solo-mode-card--locked')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Coming Soon' })).toBeDisabled();
    }
    if (diagnosticDir) await page.screenshot({ path: `${diagnosticDir}/after-solo-844x390-${state.split('/')[1]}.png` });
    if (test.info().project.name === 'chromium-mobile-visual') {
      await expect(page).toHaveScreenshot(mobileScreenshotName(state, viewport), { animations: 'disabled', maxDiffPixelRatio: 0.02 });
    }
  });
}

for (const viewport of [...MOBILE_LANDSCAPE_VIEWPORTS, MOBILE_PORTRAIT_VIEWPORT, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  if (viewport.width === 844 && viewport.height === 390) continue;
  test(`Solo reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openSolo(page, 'solo/populated');
    await assertReachable(page, viewport);
    if (diagnosticDir) await page.screenshot({ path: `${diagnosticDir}/after-solo-${viewport.width}x${viewport.height}.png` });
  });
}

test('Solo actions use real mode destinations', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openSolo(page, 'solo/populated');
  await page.locator('.sp-solo-mode-card').nth(1).locator('.sp-solo-mode-card__cta').click();
  await expect(page).toHaveURL(/\/solo\/ghost$/);
  const fritzPage = await page.context().newPage();
  try {
    await fritzPage.setViewportSize({ width: 844, height: 390 });
    await openSolo(fritzPage, 'solo/populated');
    await fritzPage.locator('.sp-solo-mode-card').first().locator('.sp-solo-mode-card__cta').click();
    await expect(fritzPage).toHaveURL(/\/solo\/fritz$/);
  } finally {
    await fritzPage.close();
  }
});

test('Solo Fritz card keeps native keyboard and focus behavior', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openSolo(page, 'solo/populated');
  const playFritz = page.locator('.sp-solo-mode-card').first().locator('.sp-solo-mode-card__cta');
  await playFritz.focus();
  await expect(playFritz).toBeFocused();
  await expect(playFritz).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/solo\/fritz$/);
});

test('Journey lock is conveyed by more than color alone', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openSolo(page, 'solo/journey-locked');
  const journeyCta = page.getByRole('button', { name: 'Coming Soon' });
  await expect(journeyCta).toBeDisabled();
  await expect(journeyCta).toHaveText(/Coming Soon/);
  const journeyCard = page.locator('.journey-card-container');
  await expect(journeyCard).toHaveAttribute('aria-disabled', 'true');
});
