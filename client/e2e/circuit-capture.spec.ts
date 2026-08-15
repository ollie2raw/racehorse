/**
 * Targeted Circuit visual captures for remaining feel-pass states.
 */
import { test, expect, type Page } from '@playwright/test';

async function startRun(page: Page) {
  await page.goto('/#/circuit');
  await expect(page.getByRole('heading', { name: 'The Circuit' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Start Run' }).click();
  await expect(page.getByLabel('Circuit run status')).toBeVisible();
}

async function selectTileMatching(page: Page, low: number, high: number) {
  const label = new RegExp(`Domino ${low}-${high}|Domino ${high}-${low}`);
  await page.getByRole('button', { name: label }).click();
}

test.describe('Circuit visual captures', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/solo');
    await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({
      timeout: 20_000,
    });
    const available = await page.getByRole('button', { name: /The Circuit/i }).isVisible().catch(() => false);
    test.skip(
      !available,
      'Circuit is hidden from flagship surfaces; set VITE_ENABLE_CIRCUIT_MODE=true in DEV to run these specs',
    );
  });

  test('one-end legal, inaccurate reveal, results quality, lobby PB', async ({ page }) => {
    await startRun(page);

    const tiles = page.locator('.hand-container button');
    const count = await tiles.count();
    let capturedOneEnd = false;
    for (let i = 0; i < count; i += 1) {
      await tiles.nth(i).click({ force: true });
      const legalLeft = await page.getByRole('button', { name: /Play on left/i }).isVisible().catch(() => false);
      const legalRight = await page.getByRole('button', { name: /Play on right/i }).isVisible().catch(() => false);
      const blockedLeft = await page.getByRole('button', { name: /Left end blocked/i }).isVisible().catch(() => false);
      const blockedRight = await page.getByRole('button', { name: /Right end blocked/i }).isVisible().catch(() => false);
      if ((legalLeft && blockedRight) || (legalRight && blockedLeft)) {
        await page.screenshot({
          path: '../audit-screenshots/circuit_feel_15_one_end_legal.png',
          fullPage: true,
        });
        capturedOneEnd = true;
        break;
      }
    }
    expect(count).toBeGreaterThan(0);
    // Not every opening gate has a one-end tile; capture is best-effort.
    void capturedOneEnd;

    const title = await page.locator('.rh-circuit-hud__title').innerText();
    if (/Hold one end/i.test(title)) {
      await selectTileMatching(page, 3, 6);
      const right = page.getByRole('button', { name: /Play on right/i });
      if (await right.isVisible().catch(() => false)) {
        await right.click();
        await expect(page.getByText(/Inaccurate|Blunder/i).first()).toBeVisible();
        await page.screenshot({
          path: '../audit-screenshots/circuit_feel_16_mistake_reveal.png',
          fullPage: true,
        });
        await page.getByRole('button', { name: 'Continue' }).click();
      }
    }

    for (let i = 0; i < 80; i += 1) {
      if (await page.getByLabel('Circuit results').isVisible().catch(() => false)) break;
      if (await page.getByRole('button', { name: 'Continue' }).isVisible().catch(() => false)) {
        await page.getByRole('button', { name: 'Continue' }).click();
        continue;
      }
      const tile = page.locator('.hand-container button:not([disabled])').first();
      if (await tile.isVisible().catch(() => false)) {
        await tile.click({ force: true });
        const left = page.getByRole('button', { name: /Play on left/i });
        const rightBtn = page.getByRole('button', { name: /Play on right/i });
        if (await left.isVisible().catch(() => false)) await left.click();
        else if (await rightBtn.isVisible().catch(() => false)) await rightBtn.click();
      }
    }

    await expect(page.getByLabel('Circuit results')).toBeVisible({ timeout: 90_000 });
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_17_results_pb_state.png',
      fullPage: true,
    });

    await page.getByRole('button', { name: '← Single Player' }).click();
    await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /The Circuit/i }).click();
    await expect(page.getByRole('heading', { name: 'The Circuit' })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_18_lobby_with_pb.png',
      fullPage: true,
    });
  });
});
