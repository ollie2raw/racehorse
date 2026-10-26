import { expect, test, type CDPSession, type Page } from '@playwright/test';

/**
 * Dragging a tile from the hand onto an open end (src/components/handDrag/). Tap-then-tap is unchanged
 * and covered by every other match spec; this pins the new gesture in a real browser:
 *   - a mouse drag places the tile on the zone it is released over;
 *   - a touch drag (real touch events through CDP, so pointerType is "touch") does the same;
 *   - a drag released away from every zone places nothing and leaves the tile selected;
 *   - a drag released back over the tile it started on does not turn into a tap (the trailing real
 *     click is swallowed);
 *   - a sideways touch drag is the rack scrolling and does not pick a tile up.
 */

async function startRookieMatch(page: Page) {
  await page.goto('/');
  // The compact phone layout labels the tab "Solo".
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  const start = page.getByText('Start Match', { exact: false }).first();
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
}

async function completePreGameDraw(page: Page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock)').first();
  // The shared CI runner is several times slower than a laptop: allow a minute for the pre-game draw to resolve.
  for (let i = 0; i < 90; i += 1) {
    if (await hand.isVisible().catch(() => false)) return;
    // The draw tiles overlap in a pile: force the click, as the other specs do, so a neighbour cannot intercept it.
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

const PLAYABLE = '.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)';

/** Wait until it is our turn with a playable tile, and return it. */
async function playableTile(page: Page) {
  const tile = page.locator(PLAYABLE).first();
  await expect(tile).toBeVisible({ timeout: 90_000 });
  return tile;
}

async function centre(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const boardTiles = (page: Page) => page.locator('.board-tile-wrapper').count();

async function setup(page: Page) {
  await startRookieMatch(page);
  await completePreGameDraw(page);
  await expect(page.locator('.board-container')).toBeVisible({ timeout: 45_000 });
}

test.describe('mouse', () => {
  test('dragging a tile onto a drop zone places it', async ({ page }) => {
    test.setTimeout(180_000);
    await setup(page);
    const tile = await playableTile(page);
    const before = await boardTiles(page);
    const from = await centre(tile);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 30, { steps: 4 }); // past the drag threshold: picks the tile up
    const zone = page.locator('.placement-zone.active').first();
    await expect(zone).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(1);
    await expect(tile).toHaveAttribute('data-dragging', 'true');

    const target = await centre(zone);
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await expect(zone).toHaveAttribute('data-drag-over', 'true');
    await page.mouse.up();

    await expect.poll(() => boardTiles(page), { timeout: 5000 }).toBe(before + 1);
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(0);
  });

  test('releasing away from every zone places nothing and leaves the tile selected', async ({ page }) => {
    test.setTimeout(180_000);
    await setup(page);
    const tile = await playableTile(page);
    const before = await boardTiles(page);
    const from = await centre(tile);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 30, { steps: 4 });
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(1);
    await page.mouse.move(8, 8, { steps: 8 }); // the far corner: nowhere near a zone
    await page.mouse.up();

    await expect(page.locator('.tile-drag-ghost')).toHaveCount(0);
    expect(await boardTiles(page)).toBe(before);
    await expect(tile).toHaveAttribute('aria-pressed', 'true'); // selected, as after a tap
  });

  test('a drag released over its own tile is not also a tap', async ({ page }) => {
    test.setTimeout(180_000);
    await setup(page);
    const tile = await playableTile(page);
    const before = await boardTiles(page);
    const from = await centre(tile);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 30, { steps: 4 });
    await page.mouse.move(from.x, from.y, { steps: 4 }); // back onto the tile it came from
    await page.mouse.up(); // a real click can follow here
    await page.waitForTimeout(600);

    expect(await boardTiles(page)).toBe(before);
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(0);
    // Selected by the pick-up, not toggled off nor played by a stray click.
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('touch', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

  async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' || x === undefined || y === undefined ? [] : [{ x, y, id: 1 }],
    });
  }

  test('a touch drag places the tile on the zone it is released over', async ({ page }) => {
    test.setTimeout(180_000);
    await setup(page);
    const cdp = await page.context().newCDPSession(page);
    const tile = await playableTile(page);
    const before = await boardTiles(page);
    const from = await centre(tile);

    await touch(cdp, 'touchStart', from.x, from.y);
    for (let i = 1; i <= 5; i += 1) await touch(cdp, 'touchMove', from.x, from.y - i * 8); // upward: a drag, not a scroll
    const zone = page.locator('.placement-zone.active').first();
    await expect(zone).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(1);

    // The held tile is lifted above the fingertip, so aim the FINGER at the zone: that is what is hit-tested.
    const target = await centre(zone);
    for (let i = 1; i <= 10; i += 1) {
      await touch(cdp, 'touchMove', from.x + ((target.x - from.x) * i) / 10, from.y - 40 + ((target.y - (from.y - 40)) * i) / 10);
    }
    await expect(zone).toHaveAttribute('data-drag-over', 'true');
    await touch(cdp, 'touchEnd');

    await expect.poll(() => boardTiles(page), { timeout: 5000 }).toBe(before + 1);
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(0);
  });

  test('a sideways touch drag does not pick a tile up (it is the rack scrolling)', async ({ page }) => {
    test.setTimeout(180_000);
    await setup(page);
    const cdp = await page.context().newCDPSession(page);
    const tile = await playableTile(page);
    const from = await centre(tile);

    await touch(cdp, 'touchStart', from.x, from.y);
    for (let i = 1; i <= 6; i += 1) await touch(cdp, 'touchMove', from.x + i * 10, from.y + 1);
    await expect(page.locator('.tile-drag-ghost')).toHaveCount(0);
    await expect(tile).not.toHaveAttribute('data-dragging', 'true');
    await touch(cdp, 'touchEnd');
  });
});
