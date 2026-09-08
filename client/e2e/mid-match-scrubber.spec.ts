import { test, expect, type Page } from '@playwright/test';

/**
 * Mid-match move-history scrubber (solo scope: Play vs Fritz).
 *
 * Verifies the scrubber appears once a move is logged, steps into history
 * view-only, returns to live, and that its `< / >` controls meet the 44px
 * mobile tap-target minimum (docs/mid-match-move-scrubber-plan.md item 7).
 */

test.describe.configure({ timeout: 60_000 });

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

/** Drive one move so the log is non-empty regardless of who opens. */
async function ensureFirstMoveLogged(page: Page) {
  const dock = page.locator('[data-ui="scrubber-dock"]');
  // Fritz opens automatically ~half the time; give it a moment.
  if (await dock.isVisible({ timeout: 6_000 }).catch(() => false)) return;

  // Otherwise it is the player's opening move: place the one legal tile.
  const tile = page.locator('.hand-area .domino-tile').first();
  await tile.click({ force: true });
  const zone = page.locator('.placement-zone.active').first();
  await zone.click({ force: true });
  await expect(dock).toBeVisible({ timeout: 15_000 });
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
