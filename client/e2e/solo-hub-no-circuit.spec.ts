import { test, expect } from '@playwright/test';

test.describe('Single Player hub Lab move', () => {
  test('flagship solo is Fritz + Ghost — Lab lives on Learn', async ({ page }) => {
    await page.goto('/#/solo');
    await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Play vs Fritz', { exact: false })).toBeVisible();
    await expect(page.getByText('Ghost Mode', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Lab' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Learn', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'The Lab' })).toBeVisible();
    await expect(page.getByText('Position Drills', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Lesson Library', { exact: false })).toBeVisible();
    await expect(page.getByText('COMING SOON').first()).toBeVisible();
  });
});
