import { expect, test, type Page } from '@playwright/test';

/**
 * The opening deal (src/components/deal/): when the pre-game draw ends, the face-down tiles you were picking from are
 * scrambled in a heap, 14 are dealt into both hands and the rest sweep into the boneyard counter. The real tiles are
 * held hidden until their card lands, and then everything is back to normal. A per-frame sampler watches a real
 * Play vs Fritz match, and these pin it:
 *   - it happens, with a card for every tile of the pile (the pile itself, not a stand-in);
 *   - the hand is held hidden while cards are in the air and ALL visible afterwards;
 *   - Fritz does not play a tile through it, even when he starts;
 *   - it lasts a couple of seconds, and leaves no cards and no hide marker behind;
 *   - your hand is playable the moment it ends.
 */

interface Frame {
  t: number;
  dealing: boolean;
  cards: number;
  decks: number;
  handHidden: number;
  handShown: number;
  boardTiles: number;
}

async function startRookieMatch(page: Page) {
  await page.goto('/');
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  const start = page.getByText('Start Match', { exact: false }).first();
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
}

async function installSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __deal: Frame[]; __dealOn: boolean };
    w.__deal = [];
    w.__dealOn = true;
    const tick = () => {
      if (!w.__dealOn) return;
      const tiles = [...document.querySelectorAll('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile:not(.board-tile)')];
      w.__deal.push({
        t: performance.now(),
        dealing: Boolean(document.querySelector('.bot-match-screen[data-hand-deal]')),
        cards: document.querySelectorAll('.hand-deal-card').length,
        decks: document.querySelectorAll('.hand-deal-pile').length,
        handHidden: tiles.filter((el) => getComputedStyle(el).visibility === 'hidden').length,
        handShown: tiles.filter((el) => getComputedStyle(el).visibility !== 'hidden').length,
        boardTiles: document.querySelectorAll('.board-tile-wrapper').length,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

test('a new hand is dealt: held, flown in, revealed, and left clean and playable', async ({ page }) => {
  test.setTimeout(180_000);
  await startRookieMatch(page);
  await installSampler(page);

  // Finish the pre-game draw: the deal begins the moment it ends.
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  for (let i = 0; i < 120; i += 1) {
    if (await page.locator('.bot-match-screen[data-hand-deal]').count()) break;
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(150);
  }
  // Let the deal play out and settle, with generous slack for a slow CI machine.
  await expect(page.locator('.bot-match-screen[data-hand-deal]')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    (window as unknown as { __dealOn: boolean }).__dealOn = false;
  });
  const frames = await page.evaluate(() => (window as unknown as { __deal: Frame[] }).__deal);
  const dealing = frames.filter((f) => f.dealing);

  // It happened, and the cards ARE the pick-a-tile pile: a card for each of its face-down tiles, not a stand-in heap.
  expect(dealing.length, 'the deal should have been on screen').toBeGreaterThan(8);
  expect(Math.max(...dealing.map((f) => f.cards)), 'a card for every tile of the pile').toBeGreaterThanOrEqual(20);
  expect(Math.max(...dealing.map((f) => f.decks)), 'no stand-in heap when the real pile exists').toBe(0);

  // The hand is held while cards are in the air, and the real tiles come in as their cards land.
  expect(Math.max(...dealing.map((f) => f.handHidden)), 'the hand should be held hidden at first').toBeGreaterThanOrEqual(5);
  const first = dealing[0];
  expect(first.handShown, 'no tile may flash in before its card').toBe(0);

  // Fritz waits for the cards: no tile reaches the board while the deal is running.
  expect(Math.max(...dealing.map((f) => f.boardTiles)), 'no tile may be played through the deal').toBe(0);

  // A couple of seconds: a moment to enjoy once per match, not in the way (with slack for a slow CI machine).
  const durationMs = dealing[dealing.length - 1].t - dealing[0].t;
  expect(durationMs).toBeGreaterThan(1200);
  expect(durationMs).toBeLessThan(5000);

  // Clean afterwards: no cards, no marker, every tile visible.
  const last = frames[frames.length - 1];
  expect(last.dealing).toBe(false);
  expect(last.cards).toBe(0);
  expect(last.handHidden).toBe(0);
  expect(last.handShown).toBeGreaterThanOrEqual(5);
  expect(await page.locator('.hand-deal-card, .hand-deal-pile').count()).toBe(0);
  expect(await page.locator('[data-dealt]').count()).toBe(0);

  // And playable the moment it is over: tap a tile and it is selected.
  const tile = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  await expect(tile).toBeVisible({ timeout: 90_000 });
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
});
