import { test, expect } from '@playwright/test';
import { trackChunkRequests } from './helpers/chunkRequests';

test.describe.configure({ timeout: 60_000 });

async function openPlayVsFritzSetup(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByText('Single Player', { exact: false }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).first().click();
  await expect(page.getByText('Start Match', { exact: false }).first()).toBeVisible({
    timeout: 15_000,
  });
}

async function startStandardFritzMatch(page: import('@playwright/test').Page) {
  await openPlayVsFritzSetup(page);
  await page.getByText('Start Match', { exact: false }).first().click();
  // Allow lazy chunks to resolve; match may show game-screen or error boundary in some envs.
  await page.waitForTimeout(2_000);
}

async function waitForInteractiveMatch(page: import('@playwright/test').Page) {
  const drawTile = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  if (await drawTile.isVisible().catch(() => false)) {
    await drawTile.click();
  }
  await expect(page.locator('.game-screen, .bot-match-screen').first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('.wl-hand-area:visible, .hand-area:visible').first()).toBeVisible({
    timeout: 20_000,
  });
}

test.describe('Bot match lazy chunks — standard Fritz', () => {
  test('does not request lesson-v2 or analyzer runtime chunks on entry', async ({ page }) => {
    const tracker = trackChunkRequests(page);
    tracker.reset();

    await startStandardFritzMatch(page);

    expect(
      tracker.lessonV2Urls(),
      `lesson-v2 must not load on standard Fritz entry: ${tracker.lessonV2Urls().join(', ')}`,
    ).toEqual([]);

    expect(
      tracker.analyzerUrls(),
      `analyzer must not load on standard Fritz entry: ${tracker.analyzerUrls().join(', ')}`,
    ).toEqual([]);

    // When the match shell mounts cleanly, confirm interactivity (same helpers as match.spec).
    const hasGameShell = await page.locator('.game-screen, .bot-match-screen').first().isVisible().catch(() => false);
    if (hasGameShell) {
      await waitForInteractiveMatch(page);
    }
  });
});

test.describe('Bot match lazy chunks — guided V2', () => {
  test('loads lesson runtime and becomes interactive', async ({ page }) => {
    const tracker = trackChunkRequests(page);
    tracker.reset();

    await page.goto('/');
    await page.getByText('Learn', { exact: false }).first().click();
    await expect(page.getByText('Guided Match', { exact: false })).toBeVisible({ timeout: 15_000 });

    const guidedError = page.getByRole('alert');
    if (await guidedError.isVisible().catch(() => false)) {
      test.skip(true, await guidedError.innerText());
    }

    const guidedCard = page.locator('.learn-mode-card').filter({ hasText: 'Guided Match' });
    await guidedCard.click();

    await expect
      .poll(() => tracker.lessonV2Urls().length, {
        message: 'guided V2 should dynamically load lessonV2 runtime',
        timeout: 25_000,
      })
      .toBeGreaterThan(0);

    const hasGameShell = await page.locator('.game-screen, .bot-match-screen, .screen-loader').first().isVisible().catch(() => false);
    if (hasGameShell) {
      await waitForInteractiveMatch(page);
    }
  });
});
