import { expect, test } from '@playwright/test';

/**
 * First-visit welcome modal (Option A — Daily Fritz leads as "start here").
 * Every other spec pre-dismisses it via the `hasSeenWelcome` flag seeded in
 * playwright.config.ts; this one opts back out to exercise the real
 * first-visit path.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('First-visit welcome modal', () => {
  test('opens on first visit, routes the primary CTA, and stays dismissed', async ({ page }) => {
    await page.goto('/');

    const dialog = page.getByRole('dialog', { name: 'Welcome to Racehorse Dominoes' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole('button', { name: 'Play Daily Fritz' })).toBeVisible();
    await expect(dialog.getByText('Puzzle Rush')).toBeVisible();

    await dialog.getByRole('button', { name: 'Play Daily Fritz' }).click();

    await expect(page).toHaveURL(/\/daily-fritz$/);
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.localStorage.getItem('hasSeenWelcome'))).toBe('1');

    // Reload anywhere — the modal must not come back.
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'Welcome to Racehorse Dominoes' })).toBeHidden();
  });

  test('"Let\'s play" dismisses without navigating', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Welcome to Racehorse Dominoes' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.getByRole('button', { name: "Let's play →" }).click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => window.localStorage.getItem('hasSeenWelcome'))).toBe('1');
  });
});
