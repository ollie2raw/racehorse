import { test, expect } from '@playwright/test';

test.use({ storageState: '.auth/host.json' });

test('authenticated storage state restores a real non-guest profile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.goto('/');
  await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/e2e_[a-z0-9]+/, { exact: false })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Sign In', { exact: true })).not.toBeVisible();
  expect(errors).toEqual([]);
});
