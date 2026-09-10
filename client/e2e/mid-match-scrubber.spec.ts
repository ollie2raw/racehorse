import { test, expect, type Page } from '@playwright/test';

/**
 * Mid-match move-history scrubber — e2e **smoke** only.
 *
 * This proves the dock actually mounts in a real Play-vs-Fritz match once a
 * move is logged, and that its "Previous move" control meets the 44px mobile
 * tap-target minimum with real CSS applied (docs/mid-match-move-scrubber-plan.md
 * item 7).
 *
 * The step-back / step-forward / back-to-live *mechanics* are covered
 * deterministically in `client/src/modules/replay/MatchHistoryScrubber.test.tsx`
 * ("integrated" describe) and `hooks/useMatchHistoryScrubber.test.ts` — they do
 * not need a browser, and driving a second early Fritz move through the UI to
 * enable "Previous move" was chronically flaky (see docs/scoping /
 * ci-e2e-flakes).
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
 * Get one tile placement into the log so the scrubber dock appears — resilient
 * to who opens. Fritz opens automatically ~half the time; the other half it is
 * the player's turn, and a placement zone only exists once a hand tile is
 * selected. Poll both paths (CI is slower than local, so a fixed "give Fritz N
 * seconds then force the player move" race is not safe).
 */
async function ensureFirstMoveLogged(page: Page) {
  const dock = page.locator('[data-ui="match-history-scrubber"]');
  // Accessible-name match: "Domino N-N" is playable; "Domino N-N, not playable"
  // and "…, opponent's turn" are excluded by the `$` anchor.
  const playable = page
    .getByRole('group', { name: 'Your hand' })
    .getByRole('button', { name: /^Domino \d-\d$/ });
  // CSS fallback — the playable-tile highlight class, per driving-a-match-in-playwright.
  const playableCss = page
    .locator('.hand-container .domino-tile.highlight:not(.disabled):not(.unplayable)')
    .first();
  const zone = page.locator('.placement-zone.active').first();

  const deadline = Date.now() + 55_000;
  while (Date.now() < deadline) {
    if (await dock.isVisible().catch(() => false)) return;

    const tile = (await playable.first().isVisible().catch(() => false))
      ? playable.first()
      : (await playableCss.isVisible().catch(() => false))
        ? playableCss
        : null;
    if (tile) {
      await tile.click({ force: true }).catch(() => {});
      if (await zone.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await zone.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1_000);
      }
    }
    await page.waitForTimeout(1_500);
  }
  await expect(dock).toBeVisible({ timeout: 5_000 });
}

test('scrubber dock appears once a move is logged, with a 44px step control', async ({ page }) => {
  await startFritzMatch(page);
  await ensureFirstMoveLogged(page);

  const dock = page.locator('[data-ui="match-history-scrubber"]');
  await expect(dock).toBeVisible();
  await expect(dock.getByText('Live')).toBeVisible();

  // The "< / >" steppers must meet the 44px mobile tap-target floor (real CSS).
  const prev = dock.getByLabel('Previous move');
  const box = await prev.boundingBox();
  expect(box, 'previous-move control has a measurable box').not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);

  const next = dock.getByLabel('Next move');
  const nextBox = await next.boundingBox();
  expect(nextBox).not.toBeNull();
  expect(nextBox!.width).toBeGreaterThanOrEqual(44);
  expect(nextBox!.height).toBeGreaterThanOrEqual(44);
});
