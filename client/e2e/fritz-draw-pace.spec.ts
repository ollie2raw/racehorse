import { expect, test, type Page } from '@playwright/test';
import { BOT_FLY_TILE_MS, flyTileCssMs, resolveBotFlyTileMs } from '../src/modules/bot-turn/botTurnGuards';

/**
 * Fritz's draw animation follows the game-speed preference (Fast Fritz, Settings), and ONLY at fast pace.
 * Real browser, real CSS: it reads the computed animation length of the flying tile Fritz's draw produces.
 *   - normal pace: no data-fly-ms, and the original 1138 ms CSS animation (the overlay is removed at 861 ms,
 *     so it has always been cut at ~76% of it: that is the look);
 *   - fast pace: data-fly-ms = the shorter flight, and a CSS length that cuts at the SAME fraction, just sooner.
 * The overlay is portaled to <body>, so a selector that depended on .bot-match-screen silently never applied
 * (this test caught exactly that).
 */

async function observeFritzDraw(page: Page, speed: 'normal' | 'fast') {
  await page.addInitScript((s) => window.localStorage.setItem('racehorse_game_speed', s), speed);
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { __seen: Set<string> }).__seen = seen;
    const tick = () => {
      for (const el of document.querySelectorAll<HTMLElement>('.flying-tile-overlay')) {
        seen.add(`${getComputedStyle(el).animationDuration}|${el.dataset.flyMs ?? '-'}`);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/');
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  await page.getByText('Start Match', { exact: false }).first().click();
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  for (let i = 0; i < 90 && (await page.locator('.hand-row .domino-tile').count()) === 0; i += 1) {
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
  const tile = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('.boneyard-pill:not(.locked)').first();
  const turn = page.locator('.wl-turn-label').first();
  const readSeen = () => page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen]);
  // Play until one of FRITZ's draws has flown. (The player's own draws also make flying tiles; they are unchanged.)
  const deadline = Date.now() + 170_000;
  while (Date.now() < deadline) {
    if (await tile.isVisible().catch(() => false)) {
      await tile.click({ force: true, timeout: 4000 }).catch(() => {});
      if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) await zone.click({ force: true, timeout: 4000 }).catch(() => {});
    } else if ((await boneyard.isVisible().catch(() => false)) && !/fritz|opponent/i.test(await turn.innerText().catch(() => ''))) {
      await boneyard.click({ force: true, timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
    await page.waitForTimeout(150);
    if (/FRITZ.*DRAW/i.test(await turn.innerText().catch(() => '')) && (await readSeen()).length > 0) break;
  }
  await page.waitForTimeout(2500);
  return readSeen();
}

test.describe("Fritz's draw animation follows the game speed", () => {
  test('normal pace: the original CSS length and no override', async ({ page }) => {
    test.setTimeout(260_000);
    const seen = await observeFritzDraw(page, 'normal');
    expect(seen.length, "Fritz's draw should have produced a flying tile").toBeGreaterThan(0);
    for (const entry of seen) expect(entry).toBe('1.138s|-');
  });

  test('fast pace: a shorter flight, cut at the same point of the animation', async ({ page }) => {
    test.setTimeout(260_000);
    const seen = await observeFritzDraw(page, 'fast');
    const fast = resolveBotFlyTileMs('fast');
    const css = `${flyTileCssMs(fast) / 1000}s`;
    expect(fast).toBeLessThan(BOT_FLY_TILE_MS);
    // At least one of Fritz's draws carries the override with the scaled CSS length. (The player's own draws may
    // appear too and are unchanged: 1.138s with no override.)
    expect(seen).toContain(`${css}|${fast}`);
    for (const entry of seen) expect([`${css}|${fast}`, '1.138s|-']).toContain(entry);
  });
});
