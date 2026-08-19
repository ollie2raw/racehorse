import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const authState = path.resolve(process.cwd(), '.auth/daily-fritz-qa.json');
const spectatorModeEnabled =
  process.env.VITE_ENABLE_SPECTATOR_MODE === 'true' &&
  process.env.ENABLE_SPECTATOR_MODE === 'true';

function hasValidAuthState(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name?: string; value?: string }> }>;
    };
    return state.origins?.some((origin) =>
      origin.localStorage?.some((entry) => {
        if (!entry.name?.startsWith('sb-') || !entry.name.endsWith('-auth-token') || !entry.value) {
          return false;
        }
        const session = JSON.parse(entry.value) as { expires_at?: unknown };
        return typeof session.expires_at === 'number' && session.expires_at > Date.now() / 1000 + 60;
      }),
    ) ?? false;
  } catch {
    return false;
  }
}

function guardRuntime(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  return () => expect(errors, errors.join('\n')).toEqual([]);
}

async function openLiveNow(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Live Now/i }).click();
  await expect(page.getByRole('heading', { name: 'Live Now' })).toBeVisible();
}

async function openDailyFritzMatch(page: Page) {
    await page.goto('/daily-fritz');
  await expect(page.getByRole('heading', { name: 'Daily Fritz' })).toBeVisible({ timeout: 20_000 });
  await page.locator('.df-pvf-start-btn').click();
  await expect(page.locator('.bot-match-screen.bot-match-mode-daily-fritz')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Go Live' })).toBeEnabled({ timeout: 20_000 });
}

test.describe('Spectator Mode', () => {
  test.skip(
    !spectatorModeEnabled,
    'Spectator Mode E2E requires explicit client and server feature flags',
  );
  test.skip(!hasValidAuthState(authState), 'A current authenticated Daily Fritz QA fixture is required');

  test('real Daily Fritz opt-in is discoverable and read-only over sockets', async ({ browser }, testInfo) => {
    const playerContext = await browser.newContext({ storageState: authState, viewport: { width: 1280, height: 720 } });
    const spectatorContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const player = await playerContext.newPage();
    const spectator = await spectatorContext.newPage();
    const assertPlayerClean = guardRuntime(player);
    const assertSpectatorClean = guardRuntime(spectator);
    try {
      await openDailyFritzMatch(player);
      await player.getByRole('button', { name: 'Go Live' }).click();
      await expect(player.getByText('Live', { exact: true })).toBeVisible({ timeout: 10_000 });

      await openLiveNow(spectator);
      await spectator.getByRole('tab', { name: 'Daily Fritz' }).click();
      await expect(spectator.getByRole('button', { name: /Watch .* versus Fritz/i })).toBeVisible({ timeout: 10_000 });
      await spectator.screenshot({ path: testInfo.outputPath('live-now-daily-fritz.png'), fullPage: true });
      await spectator.getByRole('button', { name: /Watch .* versus Fritz/i }).click();
      await expect(spectator.getByText('Public move feed')).toBeVisible();
      await expect(spectator.getByLabel(/Read-only board/)).toBeVisible();
      await expect(spectator.getByRole('button', { name: /Draw|Pass|Play tile/i })).toHaveCount(0);
      await spectator.screenshot({ path: testInfo.outputPath('daily-fritz-spectator-viewer.png'), fullPage: true });

      const playable = player.locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)').first();
      if (await playable.isVisible().catch(() => false)) {
        await playable.click();
        const placement = player.locator('.placement-zone.active').first();
        if (await placement.isVisible().catch(() => false)) await placement.click();
        await expect(spectator.getByRole('list').getByText(/played a tile|drew a tile|passed/i)).toBeVisible({ timeout: 15_000 });
      }

      await player.getByRole('button', { name: 'Stop Broadcast' }).click();
      await expect(spectator.getByText(/Broadcast ended|Table complete/i)).toBeVisible({ timeout: 10_000 });
      await expect(player.locator('.bot-match-screen.bot-match-mode-daily-fritz')).toBeVisible();
      assertPlayerClean();
      assertSpectatorClean();
    } finally {
      await playerContext.close();
      await spectatorContext.close();
    }
  });

  test('mobile Live Now discovery has no horizontal overflow', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const assertClean = guardRuntime(page);
    await openLiveNow(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('live-now-mobile.png'), fullPage: true });
    assertClean();
  });
});
