import { expect, test } from '@playwright/test';
import { WELCOME_MODAL_VISIBLE } from '../src/components/welcomeModalPolicy.ts';

/**
 * First-visit welcome modal (Option A — Daily Fritz leads as "start here").
 * Every other spec pre-dismisses it via the `hasSeenWelcome` flag seeded in
 * playwright.config.ts; this one opts back out to exercise the real
 * first-visit path.
 *
 * When `WELCOME_MODAL_VISIBLE` is parked (`false`), assert the modal stays
 * hidden. Flip the policy flag to re-enable the full CTA/dismiss coverage.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('First-visit welcome modal', () => {
  test('respects WELCOME_MODAL_VISIBLE product gate', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Welcome to Racehorse Dominoes' });

    if (!WELCOME_MODAL_VISIBLE) {
      // Parked: first visit must not show the modal.
      await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 10_000 });
      await expect(dialog).toBeHidden();
      return;
    }

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
    test.skip(!WELCOME_MODAL_VISIBLE, 'Welcome modal parked — re-enable WELCOME_MODAL_VISIBLE to run');

    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Welcome to Racehorse Dominoes' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await dialog.getByRole('button', { name: "Let's play →" }).click();

    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => window.localStorage.getItem('hasSeenWelcome'))).toBe('1');
  });
});
