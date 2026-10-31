import { expect, test, type Page } from '@playwright/test';

/**
 * The deal (src/components/deal/useHandDeal.ts): when the pre-game draw ends, cards fly from a deck at the middle of the
 * board to both hands, the real tiles are held hidden until their card lands, and then everything is back to normal.
 * A per-frame sampler watches a real Play vs Fritz match, and these pin it:
 *   - the deal happens, with a deck and at least a card per tile;
 *   - the hand is held hidden while cards are in the air and ALL visible afterwards;
 *   - it lasts about a second, and leaves no cards and no hide marker behind;
 *   - your hand is playable the moment it ends.
 */

interface Frame {
  t: number;
  dealing: boolean;
  cards: number;
  decks: number;
  handHidden: number;
  handShown: number;
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
        decks: document.querySelectorAll('.hand-deal-deck').length,
        handHidden: tiles.filter((el) => getComputedStyle(el).visibility === 'hidden').length,
        handShown: tiles.filter((el) => getComputedStyle(el).visibility !== 'hidden').length,
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

  // It happened, with a deck and a card for every tile (a hand of 7 and Fritz's 7).
  expect(dealing.length, 'the deal should have been on screen').toBeGreaterThan(8);
  expect(Math.max(...dealing.map((f) => f.decks)), 'the cards come from a deck').toBe(1);
  expect(Math.max(...dealing.map((f) => f.cards)), 'a card per tile, plus the deck').toBeGreaterThanOrEqual(10);

  // The hand is held while cards are in the air, and the real tiles come in as their cards land.
  expect(Math.max(...dealing.map((f) => f.handHidden)), 'the hand should be held hidden at first').toBeGreaterThanOrEqual(5);
  const first = dealing[0];
  expect(first.handShown, 'no tile may flash in before its card').toBe(0);

  // About a second: long enough to see, short enough not to be in the way.
  const durationMs = dealing[dealing.length - 1].t - dealing[0].t;
  expect(durationMs).toBeGreaterThan(500);
  expect(durationMs).toBeLessThan(2500);

  // Clean afterwards: no cards, no marker, every tile visible.
  const last = frames[frames.length - 1];
  expect(last.dealing).toBe(false);
  expect(last.cards).toBe(0);
  expect(last.handHidden).toBe(0);
  expect(last.handShown).toBeGreaterThanOrEqual(5);
  expect(await page.locator('.hand-deal-card').count()).toBe(0);
  expect(await page.locator('[data-dealt]').count()).toBe(0);

  // And playable the moment it is over: tap a tile and it is selected.
  const tile = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  await expect(tile).toBeVisible({ timeout: 90_000 });
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
});
