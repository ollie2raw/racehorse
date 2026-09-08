import { test, expect, type Page } from '@playwright/test';

/**
 * Mid-match move-history scrubber (solo scope: Play vs Fritz).
 *
 * Verifies the scrubber appears once a move is logged, steps into history
 * view-only, returns to live, and that its `< / >` controls meet the 44px
 * mobile tap-target minimum (docs/mid-match-move-scrubber-plan.md item 7).
 */

test.describe.configure({ timeout: 90_000 });

async function startFritzMatch(page: Page) {
  await page.goto('/');
  await page.getByLabel('Game modes').getByRole('button', { name: 'Single Player', exact: true }).click();
  await page.getByText('Play vs Fritz', { exact: false }).first().click();
  await expect(page.getByText('Start Match', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText('Start Match', { exact: false }).first().click();

  const handArea = page.locator('.wl-hand-area:visible, .hand-area:not(.pre-game-draw-hand-dock)');
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();

  // Draw phase: pick face-down tiles until the hand is dealt.
  for (let i = 0; i < 12; i += 1) {
    if (await handArea.first().isVisible().catch(() => false)) break;
    if (await pickable.isVisible().catch(() => false)) {
      await pickable.click().catch(() => {});
    }
    await page.waitForTimeout(1_000);
  }
  await expect(handArea.first()).toBeVisible({ timeout: 20_000 });
}

/**
 * Get one move into the log so the scrubber appears — resilient to who opens.
 * Fritz opens automatically ~half the time; the other half it is the player's
 * turn, and a placement zone only exists once a hand tile is selected. Poll
 * both paths rather than assuming one (CI is slower than local, so a fixed
 * "give Fritz N seconds then force the player move" race is not safe).
 */
async function ensureFirstMoveLogged(page: Page) {
  const dock = page.locator('[data-ui="scrubber-dock"]');
  // A playable hand tile's accessible name is exactly "Domino N-N"; an
  // unplayable one is "Domino N-N, not playable" — the `$` anchor excludes it.
  const playable = page
    .getByRole('group', { name: 'Your hand' })
    .getByRole('button', { name: /^Domino \d-\d$/ });
  const zone = page.locator('.placement-zone.active').first();

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (await dock.isVisible().catch(() => false)) return;
    // Our turn? Select a playable tile, drop it on the first legal zone.
    if (await playable.first().isVisible().catch(() => false)) {
      await playable.first().click({ force: true }).catch(() => {});
      if (await zone.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await zone.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1_000);
      }
    }
    await page.waitForTimeout(1_500);
  }
  await expect(dock).toBeVisible({ timeout: 5_000 });
}

test('scrubber steps through history view-only and returns to live', async ({ page }) => {
  await startFritzMatch(page);
  await ensureFirstMoveLogged(page);

  const dock = page.locator('[data-ui="scrubber-dock"]');
  await expect(dock).toBeVisible();
  await expect(dock.getByText('Live')).toBeVisible();

  const prev = dock.getByLabel('Previous move');
  const box = await prev.boundingBox();
  expect(box, 'previous-move control has a measurable box').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  await prev.click();
  await expect(dock.getByText(/Move \d+ \/ \d+/)).toBeVisible();

  // Hand is view-only while parked in history: every hand tile is disabled.
  await expect(page.locator('.hand-area .domino-tile:not(.disabled)')).toHaveCount(0);
  await expect(page.locator('.hand-area .domino-tile.disabled').first()).toBeVisible();

  await dock.getByRole('button', { name: /Back to live/ }).click();
  await expect(dock.getByText('Live')).toBeVisible();
});
