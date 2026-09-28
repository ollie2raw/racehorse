import { expect, test, type Page } from '@playwright/test';
import { installMobileFixture } from './fixtures/mobile/loader';
import { MOBILE_LANDSCAPE_VIEWPORTS, MOBILE_PORTRAIT_VIEWPORT, expectNoHorizontalOverflow, mobileScreenshotName, waitForMobileVisualStability } from './fixtures/mobile/visualHarness';

const diagnosticDir = process.env.LEARN_DIAGNOSTIC_DIR;

async function openLearn(page: Page) {
  await installMobileFixture(page, 'learn/default');
  await page.goto('/learn');
  await waitForMobileVisualStability(page);
}

async function assertReachable(page: Page, viewport: { width: number; height: number }) {
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary sections' });
  const compact = viewport.width < 769 || viewport.height < 600;
  if (compact) {
    await expect(nav).toBeVisible();
    await expect(nav.locator('button')).toHaveCount(5);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.learn-hub-main .rh-back-button')).toBeHidden();
  }
  const cards = page.locator('.learn-mode-card');
  await expect(cards).toHaveCount(4);
  for (const card of await cards.all()) {
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  }
  // Every card exposes a single actionable control >=44px tall: an enabled
  // CTA for the three unlocked modes, or the disabled "Coming Soon" button
  // for the locked one.
  for (const card of await cards.all()) {
    const control = card.locator('button');
    await expect(control).toHaveCount(1);
    const box = await control.boundingBox();
    expect(box?.height, 'card action control must stay >=44px tall').toBeGreaterThanOrEqual(44);
  }
}

test('Learn at 844x390 canonical geometry', async ({ page }) => {
  const viewport = { width: 844, height: 390 };
  await page.setViewportSize(viewport);
  await openLearn(page);
  await assertReachable(page, viewport);

  const cards = await page.locator('.learn-mode-card').all();
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  expect(boxes.every((box) => box !== null)).toBe(true);
  if (boxes[0] && boxes[1] && boxes[2] && boxes[3]) {
    // 2x2 grid: cards 0/1 share a row, 2/3 share a row, 0/2 share a column.
    expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[0]!.x - boxes[2]!.x)).toBeLessThan(2);
    expect(Math.abs(boxes[1]!.x - boxes[3]!.x)).toBeLessThan(2);
    expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2);
  }

  await expect(page.locator('.sp-solo-mode-card--locked')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Coming Soon' })).toBeDisabled();

  if (diagnosticDir) await page.screenshot({ path: `${diagnosticDir}/after-learn-844x390.png` });
  if (test.info().project.name === 'chromium-mobile-visual') {
    await expect(page).toHaveScreenshot(mobileScreenshotName('learn/default', viewport), { animations: 'disabled', maxDiffPixelRatio: 0.02 });
  }
});

for (const viewport of [...MOBILE_LANDSCAPE_VIEWPORTS, MOBILE_PORTRAIT_VIEWPORT, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  if (viewport.width === 844 && viewport.height === 390) continue;
  test(`Learn reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openLearn(page);
    await assertReachable(page, viewport);
    if (diagnosticDir) await page.screenshot({ path: `${diagnosticDir}/after-learn-${viewport.width}x${viewport.height}.png` });
  });
}

test('Learn Lesson Library lock is conveyed by more than color alone', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openLearn(page);
  const libraryCta = page.getByRole('button', { name: 'Coming Soon' });
  await expect(libraryCta).toBeDisabled();
  await expect(libraryCta).toHaveText(/Coming Soon/);
  const libraryCard = page.locator('.learn-library-card-container');
  await expect(libraryCard).toHaveAttribute('aria-disabled', 'true');
  await expect(libraryCard.locator('.learn-mode-card__lock')).toBeVisible();
});

test('Learn How to Play CTA keeps native keyboard and focus behavior', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openLearn(page);
  const howToPlay = page.locator('.learn-rules-card-container').locator('button');
  await howToPlay.focus();
  await expect(howToPlay).toBeFocused();
  const outline = await howToPlay.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  expect(outline.style, 'focus must not explicitly suppress the outline').not.toBe('none');
  expect(outline.width, 'focus outline must have nonzero width').toBeGreaterThan(0);
});
