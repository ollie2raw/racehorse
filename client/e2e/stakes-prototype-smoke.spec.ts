import { test, expect } from '@playwright/test';

test.describe('Stakes Prototype Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Open Single Player Hub
    await page.goto('/');
    await page.getByText('Single Player', { exact: false }).first().click();
    await expect(page.getByText('The Stakes (dev)', { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  test('Path A - Complete 2 stages and Bank the Purse', async ({ page }) => {
    // 1. Enter Stakes Lobby
    await page.getByText('The Stakes (dev)', { exact: false }).first().click();
    await expect(page.getByText('Starting Purse', { exact: false })).toBeVisible();

    // 2. Start Run
    await page.getByRole('button', { name: 'Start Run' }).click();
    await expect(page.getByText('Stage 1 offers', { exact: false })).toBeVisible();

    // 3. Select Stage 1 Offer
    await page.getByRole('button', { name: 'Sit at Table' }).first().click();
    await expect(page.locator('.stakes-in-game-header')).toBeVisible();

    // 4. Force Win the Stage 1 hand
    await page.getByRole('button', { name: 'Force Win' }).click();
    await expect(page.getByRole('button', { name: 'Proceed to Settlement' })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Settlement' }).click();

    // 5. Proceed to Stage 2 offers
    await expect(page.getByText('Table Settle', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Stage Offers' }).click();
    await expect(page.getByText('Stage 2 offers', { exact: false })).toBeVisible();

    // 6. Select Stage 2 Offer
    await page.getByRole('button', { name: 'Sit at Table' }).first().click();
    await expect(page.locator('.stakes-in-game-header')).toBeVisible();

    // 7. Force Win the Stage 2 hand
    await page.getByRole('button', { name: 'Force Win' }).click();
    await expect(page.getByRole('button', { name: 'Proceed to Settlement' })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Settlement' }).click();

    // 8. Proceed to Cash-out Decision
    await expect(page.getByText('Table Settle', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Cash-out Decision' }).click();
    await expect(page.getByText('Stage 2 Cash-out Decision', { exact: false })).toBeVisible();

    // 9. Bank & Exit
    await page.getByRole('button', { name: 'Bank & Exit' }).click();
    await expect(page.getByText('Run Banked', { exact: false })).toBeVisible();

    // 10. Play Again
    await page.getByRole('button', { name: 'Play Again' }).click();
    await expect(page.getByText('Starting Purse', { exact: false })).toBeVisible();
  });

  test('Path B - Risk the Finale and Settle Result', async ({ page }) => {
    // 1. Enter Stakes Lobby
    await page.getByText('The Stakes (dev)', { exact: false }).first().click();

    // 2. Jump to Stage 2 Cash-out using dev override shortcut
    await page.getByRole('button', { name: 'Jump to Stage 2 Cash-out' }).click();
    await expect(page.getByText('Stage 2 Cash-out Decision', { exact: false })).toBeVisible();

    // 3. Risk it and Enter Finale
    await page.getByRole('button', { name: 'Enter Finale' }).click();
    await expect(page.getByText('Stage 3 offers', { exact: false })).toBeVisible();

    // 4. Enter Finale Table
    await page.getByRole('button', { name: 'Sit at Table' }).first().click();
    await expect(page.locator('.stakes-in-game-header')).toBeVisible();

    // 5. Force win hand
    await page.getByRole('button', { name: 'Force Win' }).click();
    await expect(page.getByRole('button', { name: 'Proceed to Settlement' })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Settlement' }).click();

    // 6. See Final Results
    await expect(page.getByText('Run Completed', { exact: false })).toBeVisible();

    // 7. Return to Single Player Hub
    await page.getByRole('button', { name: 'Return to SP Hub' }).click();
    await expect(page.getByText('The Stakes (dev)', { exact: false })).toBeVisible();
  });
});
