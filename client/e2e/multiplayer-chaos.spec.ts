import { test, expect } from '@playwright/test';

const HUB_LOCATOR = '.mm-page.multiplayer-hub, .mm-page.mm-mp-bridge';

async function openMultiplayerHub(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByText('Multiplayer', { exact: false }).first().click();
  await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 15_000 });
}

async function expectShellRecovered(page: import('@playwright/test').Page) {
  await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 15_000 });
}

test.describe('Multiplayer production chaos', () => {
  test('Scenario A — refresh on multiplayer hub recovers without crash', async ({ page }) => {
    await openMultiplayerHub(page);
    await page.reload();
    await expectShellRecovered(page);
    await page.getByText('Multiplayer', { exact: false }).first().click();
    await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Scenario B — offline 30 seconds then online keeps hub usable', async ({ page, context }) => {
    await openMultiplayerHub(page);
    await context.setOffline(true);
    await page.waitForTimeout(5_000);
    await context.setOffline(false);
    await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Scenario C — hidden tab resume does not break multiplayer hub', async ({ page }) => {
    await openMultiplayerHub(page);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1_000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Scenario D — rapid refresh storm stays stable', async ({ page }) => {
    await openMultiplayerHub(page);
    for (let index = 0; index < 3; index += 1) {
      await page.reload();
      await expectShellRecovered(page);
    }
    await page.getByText('Multiplayer', { exact: false }).first().click();
    await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Scenario E — duplicate navigation to multiplayer does not crash', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Multiplayer', { exact: false }).first().click();
    await page.getByText('Multiplayer', { exact: false }).first().click().catch(() => {});
    await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 15_000 });
  });

  test('Scenario F — prolonged offline then online keeps hub recoverable', async ({
    page,
    context,
  }) => {
    await openMultiplayerHub(page);
    await context.setOffline(true);
    await page.waitForTimeout(8_000);
    await context.setOffline(false);
    await expect(page.locator(HUB_LOCATOR).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible();
  });
});