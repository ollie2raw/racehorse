import { expect, test } from '@playwright/test';

test.describe('browser routing', () => {
  test('root and in-app navigation use real paths', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "Today's Race" })).toBeVisible();

    await page
      .getByRole('region', { name: 'Daily Fritz' })
      .getByRole('button', { name: /play|continue|view results/i })
      .click();

    await expect(page).toHaveURL(/\/daily-fritz$/);
    await expect(page.getByRole('heading', { name: 'Daily Fritz' })).toBeVisible();
  });

  test('direct deep load and refresh keep the route', async ({ page }) => {
    await page.goto('/daily');
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.locator('.df-page, .df-shell, .daily-puzzle-screen, .loading-screen').first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page).toHaveURL(/\/daily$/);
    await expect(page.locator('.df-page, .df-shell, .daily-puzzle-screen, .loading-screen').first()).toBeVisible({ timeout: 15_000 });
  });

  test('legacy hash bookmarks are promoted to browser paths', async ({ page }) => {
    await page.goto('/#/learn');
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible({ timeout: 15_000 });
  });
});
