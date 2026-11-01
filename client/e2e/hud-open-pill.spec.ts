/**
 * The OPEN pill on a phone in landscape (components/board/useHudMetaSlot.ts, docs/board-camera-baseline.md).
 *
 * On the installed app the board is height-bound, so the pill is drawn into the HUD row instead of over the board's corner,
 * which gives the camera that room back. In the browser (no `.rh-native`) it stays on the board. Either way it must never sit on
 * top of another HUD element.
 */
import { expect, test, type Page } from '@playwright/test';
import { openRoutingHarness } from './support/boardGeometry';

const PHONES = [
  { name: '844x390', width: 844, height: 390 },
  { name: '932x430', width: 932, height: 430 },
];

async function pillState(page: Page) {
  return page.evaluate(() => {
    const pill = document.querySelector('.open-ends-pill') as HTMLElement | null;
    if (!pill) return null;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    const hud = document.querySelector('.rh-hud-rail');
    const overlaps: string[] = [];
    if (hud) {
      const p = rect(pill);
      for (const el of Array.from(hud.querySelectorAll('*'))) {
        if (el === pill || pill.contains(el) || el.contains(pill)) continue;
        const r = rect(el);
        if (r.right - r.left < 2 || r.bottom - r.top < 2) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;
        const overlapX = Math.min(p.right, r.right) - Math.max(p.left, r.left);
        const overlapY = Math.min(p.bottom, r.bottom) - Math.max(p.top, r.top);
        if (overlapX > 1 && overlapY > 1) overlaps.push(`${(el as HTMLElement).className.toString().split(' ')[0] || el.tagName}`);
      }
    }
    return {
      inHudSlot: Boolean(pill.closest('[data-ui="hud-meta-slot"]')),
      onBoard: Boolean(pill.closest('.rh-board-meta-bar')),
      pill: rect(pill),
      hud: hud ? rect(hud) : null,
      container: rect(document.querySelector('.board-container') as Element),
      overlaps,
    };
  });
}

for (const vp of PHONES) {
  test.describe(`OPEN pill on a ${vp.name} phone`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });

    test('the installed app draws it in the HUD row, clear of everything in it and off the board', async ({ page }) => {
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('rh-native'));
      });
      await openRoutingHarness(page, 'fixture=longBoth');
      const s = await pillState(page);
      expect(s).not.toBeNull();
      expect(s!.inHudSlot).toBe(true);
      expect(s!.onBoard).toBe(false);
      // inside the HUD row, and clear of the board container below it
      expect(s!.pill.top).toBeGreaterThanOrEqual(s!.hud!.top);
      expect(s!.pill.bottom).toBeLessThanOrEqual(s!.hud!.bottom + 1);
      expect(s!.pill.bottom).toBeLessThanOrEqual(s!.container.top);
      expect(s!.overlaps).toEqual([]);
    });

    test('the browser keeps it on the board, as before', async ({ page }) => {
      await openRoutingHarness(page, 'fixture=longBoth');
      const s = await pillState(page);
      expect(s).not.toBeNull();
      expect(s!.inHudSlot).toBe(false);
      expect(s!.onBoard).toBe(true);
    });
  });
}
