/**
 * Visual baselines for responsive board routing (opt-in project, like the other
 * pixel baselines: MOBILE_VISUAL=1 npx playwright test e2e/board-routing-visual.spec.ts
 * --project=chromium-mobile-visual). The numeric, always-on checks are in
 * board-routing.spec.ts; these pin what the routed board actually looks like.
 *
 * Each case mounts the real LiveMatchScreen through the routing harness with a
 * board built by game-core's real placement.
 */
import { expect, test } from '@playwright/test';
import { openRoutingHarness } from './support/boardGeometry';

const shoot = async (page: import('@playwright/test').Page, name: string) => {
  await expect(page).toHaveScreenshot(['board-routing', `${name}.png`], { animations: 'disabled', maxDiffPixelRatio: 0.02 });
};

test.describe('laptop 1512x982 (the reported screenshot class)', () => {
  test.use({ viewport: { width: 1512, height: 982 } });

  test('short chains stay straight inside the bounds', async ({ page }) => {
    await openRoutingHarness(page, 'custom=1&up=3&down=3');
    await shoot(page, 'laptop-1512x982-straight-inside-bounds');
  });

  test('a long upward chain turns into the unused width', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longUpMax');
    await shoot(page, 'laptop-1512x982-long-up-bent');
  });

  test('a long downward chain turns before the rack', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longDown');
    await shoot(page, 'laptop-1512x982-long-down-bent');
  });
});

test.describe('small laptop 1280x720: a double near the threshold (an ordinary tile turns at index 3 here)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('a double exactly at the turn is laid across the arm and the turn is deferred', async ({ page }) => {
    await openRoutingHarness(page, 'custom=1&up=9&upDouble=3');
    await shoot(page, 'laptop-1280x720-double-at-threshold-deferred');
  });

  test('a double just before the threshold', async ({ page }) => {
    await openRoutingHarness(page, 'custom=1&up=9&upDouble=2');
    await shoot(page, 'laptop-1280x720-double-before-threshold');
  });
});

test.describe('laptop 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('long chains above and below at once', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longBoth');
    await shoot(page, 'laptop-1440x900-long-both');
  });
});

test.describe('small laptop 1280x720 (pre-fix this overflowed into the HUD and rack)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('long chains above and below at once', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longBoth');
    await shoot(page, 'laptop-1280x720-long-both');
  });
});

test.describe('phone landscape 844x390 (unchanged tile-count routing)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('long chains above and below at once', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longBoth');
    await shoot(page, 'phone-844x390-long-both');
  });
});
