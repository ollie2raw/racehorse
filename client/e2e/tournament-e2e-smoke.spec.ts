import { expect, test } from '@playwright/test';
import { admin, signIn } from './tournament-backend/journey';

test('the app reaches the fake tournament backend', async ({ page }) => {
  await admin('/__e2e/reset', { live: [{ id: 'live-a', startsInMin: 120, registeredCount: 3 }] });
  await signIn(page);
  await page.goto('/tournament');
  await expect(page.getByRole('article', { name: 'Fritz Cup' })).toBeVisible();
  await expect(page.getByRole('article', { name: /^Live Event/ })).toBeVisible();
});
