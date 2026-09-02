import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Hub layout contract for phones, in BOTH orientations.
 *
 * The existing mobile-390 spec asserts "no horizontal overflow" in portrait.
 * That passed while every one of these was broken, so it is not a sufficient
 * contract on its own. The assertions here are the ones that actually fail when
 * the bugs are present:
 *
 *  - reachability: content must not be permanently parked under the fixed
 *    bottom tab bar or below the fold with nothing able to scroll to it. The
 *    hub scroll containers used to be gated behind `max-width: 768px`, so a
 *    handset in landscape (844px wide) got the desktop fixed-viewport layout
 *    inside a 390px-tall window and simply clipped everything below the fold.
 *  - containment: card art must render inside its own parent's box. Art is
 *    framed with `transform: scale(...)`, which pushes it past the card border
 *    unless the slot clips.
 *
 * Landscape is a first-class case here: it is where a width-only breakpoint
 * misidentifies a phone as a desktop.
 */

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const screenshotDir = path.join(e2eDir, 'screenshots', 'mobile-hub-containment');

const PORTRAIT = { width: 390, height: 844 } as const;
const LANDSCAPE = { width: 844, height: 390 } as const;

const HUBS = [
  { name: 'home', route: '/' },
  { name: 'solo', route: '/solo' },
  { name: 'social', route: '/social' },
  { name: 'multiplayer', route: '/multiplayer' },
  { name: 'daily-fritz', route: '/daily-fritz' },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('hasSeenWelcome', '1'));
});

/** Scroll every scrollable container to its end, mirroring what a user can reach. */
async function scrollEverythingToBottom(page: Page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (/auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
    }
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(350);
}

async function findUnreachableContent(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const bar = document.querySelector('.rh-bottom-tab-bar');
    const barRect = bar && visible(bar) ? bar.getBoundingClientRect() : null;
    const found: { text: string; why: string; px: number }[] = [];

    for (const el of document.querySelectorAll('button, a, h1, h2, h3, p, span')) {
      if (!visible(el) || el.children.length > 0) continue;
      if (el.closest('.rh-bottom-tab-bar')) continue;
      const text = (el.textContent ?? '').trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.top > window.innerHeight - 1) {
        found.push({ text: text.slice(0, 48), why: 'below the fold with nothing left to scroll', px: Math.round(r.top) });
      } else if (barRect && r.bottom > barRect.top + 1 && r.top < barRect.bottom) {
        found.push({ text: text.slice(0, 48), why: 'under the bottom tab bar', px: Math.round(r.bottom - barRect.top) });
      }
    }
    const seen = new Set<string>();
    return found.filter((f) => (seen.has(f.text + f.why) ? false : (seen.add(f.text + f.why), true))).slice(0, 10);
  });
}

async function findArtEscapingItsParent(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('img, div')]
      .filter((el) => {
        // Card art only. Full-page background decoration is absolutely
        // positioned against the page by design and is not what this guards.
        const cls = el.className?.toString() ?? '';
        if (!/(^|[\s-])(art|art-slot)([\s-]|$)|card__art|card-art/.test(cls)) return false;
        const s = getComputedStyle(el);
        if (s.position !== 'absolute' && s.position !== 'fixed') return false;
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0;
      })
      .map((el) => {
        const parent = (el as HTMLElement).offsetParent ?? el.parentElement;
        if (!parent) return null;
        const p = parent.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        const escape = Math.max(e.right - p.right, p.left - e.left, e.bottom - p.bottom, p.top - e.top);
        if (escape <= 2 || getComputedStyle(parent).overflow !== 'visible') return null;
        return { el: el.className?.toString().slice(0, 60) ?? el.tagName, escapePx: Math.round(escape) };
      })
      .filter(Boolean),
  );
}

/**
 * Hubs fetch data and reflow before reaching their final height. Poll until the
 * page geometry stops changing rather than sleeping a fixed interval, so the
 * assertions below never race a still-settling layout.
 */
const HUB_CONTENT = '.home-main, .sp-solo-main, .rh-hub-inner, .df-layout, .pvf-layout';

async function waitForLayoutToSettle(page: Page, quietMs = 700, timeoutMs = 25_000) {
  // Settle only once real hub content is mounted. Several hubs render a loading
  // screen first, whose geometry is perfectly stable — polling alone would
  // happily settle on it and then measure a layout that is about to change.
  await page.waitForSelector(HUB_CONTENT, { state: 'attached', timeout: timeoutMs });
  const measure = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .reduce((acc, el) => acc + el.scrollHeight + el.clientHeight, 0)
        .toString(),
    );
  const deadline = Date.now() + timeoutMs;
  let last = await measure();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const next = await measure();
    if (next !== last) {
      last = next;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
  }
}

async function assertNoHorizontalOverflow(page: Page) {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(m.scrollWidth, 'document must not scroll horizontally').toBeLessThanOrEqual(m.clientWidth + 1);
}

for (const orientation of ['portrait', 'landscape'] as const) {
  const viewport = orientation === 'portrait' ? PORTRAIT : LANDSCAPE;

  test.describe(`Hub containment — ${orientation} ${viewport.width}×${viewport.height}`, () => {
    for (const hub of HUBS) {
      test(`${hub.name} — all content reachable, art contained, no h-overflow`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.goto(hub.route);
        await waitForLayoutToSettle(page);

        await assertNoHorizontalOverflow(page);

        const escaping = await findArtEscapingItsParent(page);
        expect(escaping, `card art must stay inside its parent: ${JSON.stringify(escaping)}`).toEqual([]);

        await scrollEverythingToBottom(page);
        const unreachable = await findUnreachableContent(page);
        expect(
          unreachable,
          `content must be reachable on a phone: ${JSON.stringify(unreachable, null, 1)}`,
        ).toEqual([]);

        await page.screenshot({
          path: path.join(screenshotDir, `${testInfo.project.name}-${orientation}-${hub.name}.png`),
        });
      });
    }
  });
}
