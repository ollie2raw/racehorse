import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { waitForGameServerReady } from './helpers/multiplayerMatch';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await waitForGameServerReady();
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`fresh Daily Fritz start remains mounted with review access at ${viewport.width}×${viewport.height}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const userId = randomUUID();
    await context.addInitScript((id) => {
      localStorage.setItem('racehorse_e2e_user_id', id);
      localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
      localStorage.setItem('hasSeenWelcome', '1');
    }, userId);
    const page = await context.newPage();
    const renderErrors: string[] = [];
    page.on('pageerror', (error) => {
      if (/Too many re-renders|Minified React error #301/.test(error.message)) renderErrors.push(error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error' && /Too many re-renders|Minified React error #301/.test(message.text())) {
        renderErrors.push(message.text());
      }
    });

    try {
      await page.route('**/api/game-reviews/access', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: true }) }));
      await page.goto('/daily-fritz');
      await expect(page.getByRole('heading', { name: 'Daily Fritz' })).toBeVisible({ timeout: 20_000 });
      const start = page.locator('.df-pvf-start-btn');
      await expect(start).toBeEnabled({ timeout: 20_000 });
      const accessResponse = page.waitForResponse((response) =>
        response.url().includes('/api/game-reviews/access') && response.request().method() === 'GET');
      const startResponse = page.waitForResponse((response) =>
        response.url().includes('/api/daily-fritz/start') && response.request().method() === 'POST');
      await start.click();
      expect((await startResponse).status()).toBe(200);
      expect((await accessResponse).status()).toBe(200);
      const match = page.locator('.bot-match-screen.bot-match-mode-daily-fritz');
      await expect(match).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-surface-shell="gameplay"]')).toBeVisible();
      await expect(page.locator(
        '.pre-game-draw-board__tile-slot.is-pickable, .hand-container button.domino-tile',
      ).first()).toBeVisible();
      await page.waitForTimeout(1_000);
      await expect(match).toBeVisible();
      expect(renderErrors).toEqual([]);
      await expect(page.getByRole('heading', { name: 'Something went wrong' })).toHaveCount(0);
      await expect(page.getByText('Too many re-renders')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
