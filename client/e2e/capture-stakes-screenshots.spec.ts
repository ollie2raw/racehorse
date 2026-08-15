import { test, expect } from '@playwright/test';

test.describe('Stakes Prototype Screenshots Capture', () => {
  test.setTimeout(120_000);

  test('capture all prototype screens', async ({ page }) => {
    // 1. Single Player with flag enabled
    await page.goto('/');
    await page.getByText('Single Player', { exact: false }).first().click();
    await expect(page.getByText('The Stakes (dev)', { exact: false })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: '../audit-screenshots/stakes_14_single_player_flag_enabled.png', fullPage: true });

    // 2. Lobby & Developer Controls (Lobby)
    await page.getByText('The Stakes (dev)', { exact: false }).first().click();
    await expect(page.getByText('Starting Purse', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_01_lobby.png', fullPage: true });
    await page.screenshot({ path: '../audit-screenshots/stakes_13_dev_controls.png', fullPage: true });

    // 3. Stage 1 Offers
    await page.getByRole('button', { name: 'Start Run' }).click();
    await expect(page.getByText('Stage 1 offers', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_02_stage_1_offers.png', fullPage: true });

    // 4. Active authentic hand with Stakes HUD / First Blood progress
    await page.getByRole('button', { name: 'Sit at Table' }).first().click();
    await expect(page.locator('.stakes-in-game-header')).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_03_active_hand_with_hud.png', fullPage: true });
    await page.screenshot({ path: '../audit-screenshots/stakes_04_live_first_blood_progress.png', fullPage: true });

    // 5. Force Win & proceed to show Win Settlement with Contract
    await page.getByRole('button', { name: 'Force Win' }).click();
    await expect(page.getByRole('button', { name: 'Proceed to Settlement' })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_06_win_settlement_with_contract.png', fullPage: true });
    await page.getByRole('button', { name: 'Proceed to Settlement' }).click();

    // 6. Table Settle Stage 1
    await expect(page.getByText('Table Settle', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Stage Offers' }).click();

    // 7. Stage 2 Offers
    await expect(page.getByText('Stage 2 offers', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_08_stage_2_offers.png', fullPage: true });

    // 8. Sit at Stage 2 Table & Force Loss to show Loss Settlement
    await page.getByRole('button', { name: 'Sit at Table' }).first().click();
    await expect(page.locator('.stakes-in-game-header')).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_05_live_force_the_pass_progress.png', fullPage: true });
    await page.getByRole('button', { name: 'Force Loss' }).click();
    await expect(page.getByRole('button', { name: 'Proceed to Settlement' })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_07_loss_settlement.png', fullPage: true });
    await page.getByRole('button', { name: 'Proceed to Settlement' }).click();

    // 9. Bank-or-risk Decision screen
    await expect(page.getByText('Table Settle', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Cash-out Decision' }).click();
    await expect(page.getByText('Stage 2 Cash-out Decision', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_09_bank_or_risk_decision.png', fullPage: true });

    // 10. Bank and show Banked Results
    await page.getByRole('button', { name: 'Bank & Exit' }).click();
    await expect(page.getByText('Run Banked', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_11_banked_results.png', fullPage: true });

    // 11. Start again and jump to Cash-out for Path B
    await page.getByRole('button', { name: 'Play Again' }).click();
    await expect(page.getByText('Starting Purse', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Jump to Stage 2 Cash-out' }).click();
    await expect(page.getByText('Stage 2 Cash-out Decision', { exact: false })).toBeVisible();

    // 12. Risk the Finale to show Finale Offer
    await page.getByRole('button', { name: 'Enter Finale' }).click();
    await expect(page.getByText('Stage 3 offers', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_10_finale_offer.png', fullPage: true });

    // 13. Enter Finale & Settle Finale to show Finale Results
    await page.getByRole('button', { name: 'Sit at Table' }).first().click();
    await expect(page.locator('.stakes-in-game-header')).toBeVisible();
    await page.getByRole('button', { name: 'Force Win' }).click();
    await expect(page.getByRole('button', { name: 'Proceed to Settlement' })).toBeVisible();
    await page.getByRole('button', { name: 'Proceed to Settlement' }).click();
    await expect(page.getByText('Run Completed', { exact: false })).toBeVisible();
    await page.screenshot({ path: '../audit-screenshots/stakes_12_finale_results.png', fullPage: true });
    
    // 14. Return to Single Player Hub
    await page.getByRole('button', { name: 'Return to SP Hub' }).click();
    await expect(page.getByText('The Stakes (dev)', { exact: false })).toBeVisible();
  });

  test('capture Single Player with flag disabled', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__STAKES_ENABLED_OVERRIDE__ = false;
    });
    await page.goto('/');
    await page.getByText('Single Player', { exact: false }).first().click();
    await expect(page.getByText('Play vs Fritz', { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('The Stakes (dev)', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: '../audit-screenshots/stakes_15_single_player_flag_disabled.png', fullPage: true });
  });
});
