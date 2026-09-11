import { expect, test, type Page } from '@playwright/test';

/**
 * Play vs Fritz — the missing "play a mode to completion" coverage
 * (FEATURE_COMPLETENESS_AUDIT.md §5.1). The existing `match.spec.ts` only ever
 * selects a tile; nothing drives a full match through hand-overs to a result.
 *
 * This plays a real Rookie match (race to 60) end to end and asserts the
 * Play-vs-Fritz result overlay renders with a final score / standings, and that
 * the run produced no uncaught page errors.
 *
 * The move loop is the 4-state machine from the `driving-a-match-in-playwright`
 * note: pre-game draw · playable hand tile · placement-zone choice · draw from
 * the boneyard. Progress is read from the `body.innerText` live region so a
 * genuine wedge fails fast with a diagnostic instead of burning the whole
 * timeout. Every interaction is individually time-boxed for the same reason.
 *
 *   pre-game draw   .pre-game-draw-board__tile-slot.is-pickable
 *   playable tile   .hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)
 *   placement       .placement-zone.active
 *   draw            [class*="boneyard"]
 *
 * A full match is ~5 min of wall clock; the budget is generous and the spec
 * retries once (twice on CI) to absorb the occasional chromium crash under load.
 */

test.describe.configure({ retries: process.env.CI ? 2 : 1 });

const ACTION_TIMEOUT = 5_000;

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

async function playToResult(page: Page) {
  const result = page.getByRole('dialog', { name: 'Play vs Fritz result' });
  const handOver = page.getByTestId('hand-over-modal');
  const reloadHand = page.getByRole('button', { name: /^Reload Hand$/i });
  const playable = page
    .locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)')
    .first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('[class*="boneyard"]').first();

  const deadline = Date.now() + 520_000;
  let lastProgress = '';
  let lastProgressAt = Date.now();
  let ticks = 0;
  const t0 = Date.now();

  while (Date.now() < deadline) {
    if (await result.isVisible().catch(() => false)) return;
    ticks += 1;

    // Hand-over modals auto-advance in solo play — just let them pass.
    if (await handOver.isVisible().catch(() => false)) {
      await page.waitForTimeout(1_500);
      continue;
    }

    // Recovery affordance if a hand genuinely gets stuck.
    if (await reloadHand.isVisible().catch(() => false)) {
      await reloadHand.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(1_500);
      continue;
    }

    const handTiles = await playable.count().catch(() => 0);
    let action = 'idle';
    if (handTiles > 0) {
      action = 'play';
      await playable.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      if (await zone.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await zone.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      }
    } else if (await boneyard.isVisible().catch(() => false)) {
      action = 'draw';
      await boneyard.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
    }

    await page.waitForTimeout(900);

    // Progress = board tile count + the live-region score text. If neither has
    // moved in 90s and there's still no result, the match is wedged.
    const progress = await page
      .evaluate(() => {
        const tiles = document.querySelectorAll('.board-tile-wrapper, .domino-tile.board-tile').length;
        const live = document.querySelector('[role="status"], [aria-live]')?.textContent ?? '';
        return `${tiles}|${live.trim()}`;
      })
      .catch(() => lastProgress);
    if (ticks % 10 === 1) {
      // eslint-disable-next-line no-console -- diagnostic; only fires on the CI/loop reporter
      console.log(`[fritz-e2e] t+${Math.round((Date.now() - t0) / 1000)}s tick=${ticks} action=${action} hand=${handTiles} state=${progress.slice(0, 120)}`);
    }
    if (progress !== lastProgress) {
      lastProgress = progress;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > 90_000) {
      throw new Error(`Fritz match wedged — no board/score progress in 90s. Last state: "${lastProgress}"`);
    }
  }
  throw new Error('Fritz match did not reach a result within the time budget');
}

test('Play vs Fritz runs a full match to a result screen', async ({ page }) => {
  test.setTimeout(600_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startRookieMatch(page);
  await completePreGameDraw(page);
  await playToResult(page);

  const result = page.getByRole('dialog', { name: 'Play vs Fritz result' });
  await expect(result).toBeVisible();
  await expect(result.locator('.df-result-title')).toHaveText(/^(Victory|Defeat)$/);
  await expect(result.getByText('Final Score')).toBeVisible();
  await expect(result.getByText('Final Standings')).toBeVisible();
  await expect(result.getByRole('button', { name: /Rematch/i })).toBeVisible();

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
