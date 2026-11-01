/**
 * Menu and hub tap targets: every listed control must be hittable over a 44 x 44pt area (Apple HIG / WCAG 2.5.5).
 *
 * Measured, not read from CSS: for each control, sweep document.elementFromPoint over the 44 x 44 box centred on it and
 * take the extent of the points that land on the control (or something inside it). A control that is already wider (or
 * taller) than 44px only has to cover its own width (or height). Slop that is clipped by a container, painted over by a
 * neighbour or never applied shows up here as a short extent. Companion to the compact in-match targets in
 * compact-touch-targets.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test';

const MIN = 44;
// Hit-testing is exclusive at a box's exact edge, so the sweep covers the central 42 x 42 of the 44 x 44 box.
const HALF = MIN / 2 - 1;

/**
 * A row of many equal-width controls cannot give each of them 44px of width: the hit area ends where the neighbour's
 * begins. The how-to-play progress markers are 8 steps sharing about 310px (a 39px pitch on a phone), so they get the
 * full 44px of height and as much width as the pitch allows; widening them further would mean fewer steps or a
 * scrolling row. Anything else must meet the full 42px sweep.
 */
const PITCH_LIMITED_WIDTH: Record<string, number> = { '.learn-academy__path-node': 36 };

type Case = { route: string; selectors: string[]; note?: string };

const CASES: Case[] = [
  { route: '/multiplayer', selectors: ['.mp-topbar__seg-btn', '.mm-cta'] },
  { route: '/multiplayer/private', selectors: ['.mp-topbar__seg-btn', '.pml-tab-seg'] },
  { route: '/settings', selectors: ['.rh-settings-toggle'] },
  { route: '/daily-fritz', selectors: ['.df-start-match-btn', '.df-pvf-leaderboard-link'] },
  { route: '/daily-fritz/leaderboard', selectors: ['.dfl-btn', '.rh-hub-filter'] },
  { route: '/puzzle-rush', selectors: ['.df-start-match-btn', '.df-pvf-leaderboard-link'] },
  { route: '/practice', selectors: ['.rh-modal-close', '.rh-btn--lg'] },
  { route: '/learn/how-to-play', selectors: ['.learn-academy__path-node', '.pvf-back-btn', '.pvf-start-btn', '.rh-htp-page__jump'] },
  { route: '/social', selectors: ['.rh-sb-filter', '.rh-sb-btn', '.rh-hub-rail-link', '.rh-sb-row'] },
];

const VIEWPORTS = [
  { name: 'native landscape 844x390', width: 844, height: 390, native: true },
  { name: 'phone portrait 390x844', width: 390, height: 844, native: false },
] as const;

async function sweep(page: Page, selector: string) {
  return page.evaluate(
    ({ selector, HALF }) => {
      const out: { label: string; w: number; h: number; spanW: number; spanH: number }[] = [];
      for (const el of Array.from(document.querySelectorAll(selector))) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (b.width === 0 || b.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (b.bottom < 0 || b.top > window.innerHeight || b.right < 0 || b.left > window.innerWidth) continue;
        const cx = b.left + b.width / 2;
        const cy = b.top + b.height / 2;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let dx = -HALF; dx <= HALF; dx += 1) {
          for (let dy = -HALF; dy <= HALF; dy += 1) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit && el.contains(hit)) {
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
          }
        }
        out.push({
          label: ((el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 24)) || el.className.toString().slice(0, 24),
          w: Math.round(b.width),
          h: Math.round(b.height),
          spanW: maxX >= minX ? maxX - minX : 0,
          spanH: maxY >= minY ? maxY - minY : 0,
        });
      }
      return out;
    },
    { selector, HALF },
  );
}

for (const viewport of VIEWPORTS) {
  test.describe(`menu tap targets, ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: true });

    for (const { route, selectors } of CASES) {
      test(`${route}`, async ({ page }) => {
        if (viewport.native) {
          await page.addInitScript(() => {
            document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('rh-native'));
          });
        }
        await page.goto(route);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await page.waitForTimeout(800);
        await page.mouse.move(1, 1); // hover lifts and rescales some controls and would fake overlaps

        const failures: string[] = [];
        let measured = 0;
        for (const selector of selectors) {
          for (const r of await sweep(page, selector)) {
            measured += 1;
            const need = HALF * 2;
            if (r.spanW < (PITCH_LIMITED_WIDTH[selector] ?? need) || r.spanH < need) {
              failures.push(`${selector} "${r.label}" is ${r.w}x${r.h}, hit area only ${Math.round(r.spanW)}x${Math.round(r.spanH)}`);
            }
          }
        }
        expect(measured, `no listed control was found on ${route}; the selectors or the route changed`).toBeGreaterThan(0);
        expect(failures).toEqual([]);
      });
    }
  });
}
