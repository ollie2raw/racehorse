import { test, expect } from '@playwright/test';

test.describe('Single Player hub without Circuit', () => {
  test('flagship solo hierarchy is Fritz + Ghost — Lab lives on Learn', async ({ page }) => {
    await page.goto('/#/solo');
    await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('Play vs Fritz', { exact: false })).toBeVisible();
    await expect(page.getByText('Ghost Mode', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Lab' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /The Circuit/i })).toHaveCount(0);
    await expect(page.getByText(/Primary replayable mode/i)).toHaveCount(0);

    await page.goto('/#/learn');
    await expect(page.getByRole('heading', { name: 'Learn' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'The Lab' })).toBeVisible();
    await expect(page.getByText('Position Drills', { exact: false })).toHaveCount(0);
    await expect(page.getByText('Lesson Library', { exact: false })).toBeVisible();
    await expect(page.getByText('COMING SOON').first()).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Today/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('The Circuit continuation')).toHaveCount(0);

    await page.goto('/#/circuit');
    // Deep link must not surface Circuit when the flag is off.
    await expect(page.getByRole('heading', { name: 'The Circuit' })).toHaveCount(0);
    await expect(page.getByLabel('The Circuit lobby')).toHaveCount(0);
    // Gating may land on hub or home depending on path parsing; either is fine if Circuit is gone.
    await expect(
      page.getByRole('heading', { name: /Single Player|Today/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });
});
