import { expect, type Page } from '@playwright/test';

type Rect = { left: number; right: number; top: number; bottom: number };

function overlaps(a: Rect, b: Rect, tolerancePx = 2): boolean {
  return (
    a.left < b.right - tolerancePx
    && b.left < a.right - tolerancePx
    && a.top < b.bottom
    && b.top < a.bottom
  );
}

export async function assertDesktopNavRegionsDoNotOverlap(page: Page) {
  const result = await page.evaluate(() => {
    const read = (selector: string) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    };

    const brand = read('.rh-nav-brand');
    const center = read('.rh-nav-center-desktop');
    const stats = read('.rh-nav-stats');
    if (!brand || !center || !stats) {
      return { ok: false, reason: 'missing nav region', brand, center, stats };
    }

    return {
      ok: true,
      brand,
      center,
      stats,
    };
  });

  expect(result.ok, result.reason ?? 'nav regions should exist').toBe(true);
  if (!result.ok || !result.brand || !result.center || !result.stats) return;

  expect(
    overlaps(result.brand, result.center),
    `brand (${result.brand.right}px) must not overlap center tabs (${result.center.left}px)`,
  ).toBe(false);
  expect(
    overlaps(result.center, result.stats),
    `center tabs (${result.center.right}px) must not overlap stats (${result.stats.left}px)`,
  ).toBe(false);
  expect(
    overlaps(result.brand, result.stats),
    `brand (${result.brand.right}px) must not overlap stats (${result.stats.left}px)`,
  ).toBe(false);
}
