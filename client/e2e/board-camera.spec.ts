import { expect, test, type Page } from '@playwright/test';

/**
 * Board camera / auto-fit behaviour — the safety net D2 (Board.tsx hook
 * decomposition) needs before `useBoardCamera` can be pulled out.
 *
 * `match.spec.ts` asserts the board *renders*; `fritz-play-to-completion` drives
 * placement but never looks at the camera. Nothing today would catch "the board
 * drifts off-screen after a tile is placed", "panning snaps back", or "the zoom
 * tray is dead" — which is exactly where a camera-state / auto-fit-effect split
 * regresses. This spec pins the four behaviours:
 *
 *   1. auto-fit re-centres the board after each placement
 *   2. a drag-pan moves the board and does NOT snap back
 *   3. the zoom-tray buttons change the camera scale
 *   4. double-click re-fits (back to the fitted camera)
 *
 * The camera is `transform: translate(Xpx, Ypx) scale(S)` on `.board-canvas`
 * inside `.board-container`; every assertion reads that inline transform.
 */

const ACTION_TIMEOUT = 5_000;

type Camera = { x: number; y: number; scale: number };

async function readCamera(page: Page): Promise<Camera> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.board-canvas') as HTMLElement | null;
    const t = canvas?.style.transform ?? '';
    const translate = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(t);
    const scale = /scale\(\s*(-?[\d.]+)\s*\)/.exec(t);
    return {
      x: translate ? parseFloat(translate[1]) : NaN,
      y: translate ? parseFloat(translate[2]) : NaN,
      scale: scale ? parseFloat(scale[1]) : NaN,
    };
  });
}

/** Geometric centre of every rendered board tile, and the container rect. */
async function readFraming(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.board-container') as HTMLElement;
    const cr = container.getBoundingClientRect();
    const tiles = Array.from(document.querySelectorAll('.board-tile-wrapper')) as HTMLElement[];
    const rects = tiles.map((el) => el.getBoundingClientRect());
    const minX = Math.min(...rects.map((r) => r.left));
    const maxX = Math.max(...rects.map((r) => r.right));
    const minY = Math.min(...rects.map((r) => r.top));
    const maxY = Math.max(...rects.map((r) => r.bottom));
    return {
      container: { cx: cr.left + cr.width / 2, cy: cr.top + cr.height / 2, w: cr.width, h: cr.height, ...cr.toJSON() },
      tileGroup: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY },
      tileCount: tiles.length,
    };
  });
}

async function startRookieMatch(page: Page) {
  await page.goto('/');
  await page.getByText('Single Player', { exact: false }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  const start = page.getByText('Start Match', { exact: false }).first();
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
}

async function completePreGameDraw(page: Page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock)').first();
  for (let i = 0; i < 20; i += 1) {
    if (await hand.isVisible().catch(() => false)) return;
    if (await pickable.isVisible().catch(() => false)) {
      await pickable.click({ timeout: ACTION_TIMEOUT }).catch(() => {});
    }
    await page.waitForTimeout(750);
  }
}

/** Place up to `target` of our tiles, letting Fritz and hand-overs proceed. */
async function placeTiles(page: Page, target: number): Promise<number> {
  const playable = page
    .locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)')
    .first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('[class*="boneyard"]').first();
  const handOver = page.getByTestId('hand-over-modal');

  let placed = 0;
  const deadline = Date.now() + 120_000;
  while (placed < target && Date.now() < deadline) {
    if (await handOver.isVisible().catch(() => false)) {
      await page.waitForTimeout(1_500);
      continue;
    }
    const before = await page.locator('.board-tile-wrapper').count();
    if (await playable.isVisible().catch(() => false)) {
      await playable.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      if (await zone.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await zone.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      }
    } else if (await boneyard.isVisible().catch(() => false)) {
      await boneyard.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
    }
    await page.waitForTimeout(1_400);
    const after = await page.locator('.board-tile-wrapper').count();
    if (after > before) placed += 1;
  }
  return placed;
}

test.describe.configure({ retries: process.env.CI ? 2 : 1 });

test('board auto-fits after placement and its pan/zoom controls behave', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startRookieMatch(page);
  await completePreGameDraw(page);
  await expect(page.locator('.board-container')).toBeVisible({ timeout: 15_000 });

  // Motion probe: from the first tile on, sample one already-placed tile's on-screen centre every animation
  // frame while more tiles arrive. The camera must glide; it used to snap, which moved every tile tens of px
  // in a single frame on each placement.
  await page.evaluate(() => {
    const w = window as unknown as { __camProbe?: { key: string | null; last: [number, number] | null; maxFramePx: number; frames: number } };
    const probe = (w.__camProbe = { key: null, last: null, maxFramePx: 0, frames: 0 });
    const tick = () => {
      const wrappers = document.querySelectorAll<HTMLElement>('.board-tile-wrapper');
      if (probe.key === null && wrappers.length > 0) probe.key = wrappers[0].dataset.layoutKey ?? null;
      const el = probe.key ? document.querySelector<HTMLElement>(`.board-tile-wrapper[data-layout-key="${probe.key}"]`) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        const c: [number, number] = [r.left + r.width / 2, r.top + r.height / 2];
        if (probe.last) probe.maxFramePx = Math.max(probe.maxFramePx, Math.hypot(c[0] - probe.last[0], c[1] - probe.last[1]));
        probe.last = c;
        probe.frames += 1;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Get a few tiles on the board (ours + Fritz's).
  const placed = await placeTiles(page, 3);
  await expect(page.locator('.board-tile-wrapper').first()).toBeVisible();
  await page.waitForTimeout(1_200); // let the post-placement auto-fit settle

  const motion = await page.evaluate(() => (window as unknown as { __camProbe: { maxFramePx: number; frames: number } }).__camProbe);
  expect(motion.frames, 'the probe should have sampled many frames').toBeGreaterThan(30);
  // The spring's peak is a few px per frame; a snap on a placement moves a tile 30-100 px at once.
  expect(motion.maxFramePx, 'a placed tile must not jump between frames when later tiles arrive').toBeLessThan(20);
  await expect(page.locator('.board-canvas')).toHaveAttribute('data-camera-settled', 'true');

  // ── 1. Framing: auto-fit keeps the board group centred in the container ──
  const framed = await readFraming(page);
  expect(framed.tileCount).toBeGreaterThan(0);
  // The tile group is centred in the container. Centring is carried by the camera translate (tiles are
  // positioned against a world origin that moves with them), so this checks the rendered result, not x/y.
  expect(Math.abs(framed.tileGroup.cx - framed.container.cx)).toBeLessThan(framed.container.w * 0.15);
  expect(Math.abs(framed.tileGroup.cy - framed.container.cy)).toBeLessThan(framed.container.h * 0.15);
  // And it is not scaled into oblivion or off the edge entirely.
  const fitCam = await readCamera(page);
  expect(fitCam.scale).toBeGreaterThan(0);

  // ── 2. Pan: dragging the board moves it and it does NOT snap back ──
  const box = (await page.locator('.board-container').boundingBox())!;
  // Start from a corner area unlikely to hold a tile or an active placement zone.
  const sx = box.x + box.width * 0.15;
  const sy = box.y + box.height * 0.2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 130, sy + 90, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const panned = await readCamera(page);
  expect(panned.x).toBeGreaterThan(fitCam.x + 60);
  expect(panned.y).toBeGreaterThan(fitCam.y + 40);

  await page.waitForTimeout(1_200); // past any rAF / ResizeObserver refit
  const afterSettle = await readCamera(page);
  expect(Math.abs(afterSettle.x - panned.x)).toBeLessThan(12);
  expect(Math.abs(afterSettle.y - panned.y)).toBeLessThan(12);

  // ── 3. Zoom tray: the +/- buttons change scale ──
  const base = await readCamera(page);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(250);
  const zoomedIn = await readCamera(page);
  expect(zoomedIn.scale).toBeGreaterThan(base.scale * 1.1);

  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(250);
  const zoomedOut = await readCamera(page);
  expect(zoomedOut.scale).toBeLessThan(base.scale);

  // ── 4. Double-click re-fits: the camera returns to the fitted position ──
  await page.locator('.board-container').dblclick({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await page.waitForTimeout(1_200);
  const refit = await readCamera(page);
  expect(refit.scale).toBeGreaterThan(0);
  // (Fritz may have moved since the first fit, so compare the framing, not the earlier camera numbers.)
  const reframed = await readFraming(page);
  expect(Math.abs(reframed.tileGroup.cx - reframed.container.cx)).toBeLessThan(reframed.container.w * 0.15);
  expect(Math.abs(reframed.tileGroup.cy - reframed.container.cy)).toBeLessThan(reframed.container.h * 0.15);

  expect(placed, 'expected to place at least one tile').toBeGreaterThan(0);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
