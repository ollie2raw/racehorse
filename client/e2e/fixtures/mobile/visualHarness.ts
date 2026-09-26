import { expect, type Page } from '@playwright/test';
import type { MobileFixtureStateId } from './schema';

export const MOBILE_LANDSCAPE_VIEWPORTS = [
  { width: 667, height: 375 },
  { width: 740, height: 360 },
  { width: 844, height: 390 },
  { width: 852, height: 393 },
  { width: 915, height: 412 },
  { width: 932, height: 430 },
] as const;
export const MOBILE_CANONICAL_VIEWPORT = MOBILE_LANDSCAPE_VIEWPORTS[2];
export const MOBILE_PORTRAIT_VIEWPORT = { width: 390, height: 844 } as const;

export async function setMobileViewport(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
}

export async function waitForMobileVisualStability(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((image) => image.complete === false).map((image) => new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    })));
  });
  await page.waitForLoadState('networkidle');
}

export async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth + 1));
}

export async function expectReachable(page: Page, selector: string) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `No bounding box for ${selector}`).not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;
  expect(box.x + box.width).toBeGreaterThan(0);
  expect(box.x).toBeLessThan(viewport.width);
  expect(box.y + box.height).toBeGreaterThan(0);
  expect(box.y).toBeLessThan(viewport.height);
}

export function mobileScreenshotName(stateId: MobileFixtureStateId, viewport: { width: number; height: number }) {
  const [screen, state] = stateId.split('/');
  return `mobile-landscape/${screen}/${state}-${viewport.width}x${viewport.height}.png`;
}
