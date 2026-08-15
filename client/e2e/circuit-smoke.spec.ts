import { test, expect, type Page } from '@playwright/test';

async function circuitAvailable(page: Page): Promise<boolean> {
  await page.goto('/#/solo');
  await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({
    timeout: 20_000,
  });
  return page.getByRole('button', { name: /The Circuit/i }).isVisible().catch(() => false);
}

async function enterCircuit(page: Page) {
  await page.goto('/#/circuit');
  await expect(page.getByRole('heading', { name: 'The Circuit' })).toBeVisible({ timeout: 20_000 });
}

async function startRun(page: Page) {
  await page.getByRole('button', { name: 'Start Run' }).click();
  await expect(page.getByLabel('Circuit run status')).toBeVisible();
}

async function selectFirstPlayableTile(page: Page) {
  const tiles = page.locator('.hand-container .domino-tile, .hand-container [role="button"], .hand-row > *');
  const count = await tiles.count();
  for (let i = 0; i < count; i += 1) {
    const tile = tiles.nth(i);
    const disabled = await tile.getAttribute('aria-disabled');
    if (disabled === 'true') continue;
    await tile.click({ force: true });
    const ends = page.locator('.rh-circuit-ends');
    if (await ends.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function commitAnyLegalEnd(page: Page) {
  const left = page.getByRole('button', { name: /Play on left/i });
  const right = page.getByRole('button', { name: /Play on right/i });
  if (await left.isVisible().catch(() => false)) {
    const disabled = await left.getAttribute('aria-disabled');
    if (disabled !== 'true') {
      await left.click();
      return 'left';
    }
  }
  if (await right.isVisible().catch(() => false)) {
    const disabled = await right.getAttribute('aria-disabled');
    if (disabled !== 'true') {
      await right.click();
      return 'right';
    }
  }
  return null;
}

async function continueIfFeedback(page: Page) {
  const feedback = page.locator('.rh-circuit-feedback');
  if (await feedback.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Continue' }).click();
    return true;
  }
  return false;
}

async function playOneDecision(page: Page) {
  if (await continueIfFeedback(page)) return 'continued';
  if (await page.getByLabel('Circuit results').isVisible().catch(() => false)) return 'results';
  await selectFirstPlayableTile(page);
  await commitAnyLegalEnd(page);
  if (await page.locator('.rh-circuit-feedback').isVisible().catch(() => false)) return 'graded';
  return 'attempted';
}

test.describe('The Circuit feel-pass smoke', () => {
  test.setTimeout(180_000);

  test.beforeEach(async ({ page }) => {
    const available = await circuitAvailable(page);
    test.skip(
      !available,
      'Circuit is hidden from flagship surfaces; set VITE_ENABLE_CIRCUIT_MODE=true in DEV to run these specs',
    );
  });

  test('lobby, placement ends, pressure gate, results, review, run again, PB reload', async ({
    page,
  }) => {
    await enterCircuit(page);
    await page.screenshot({ path: '../audit-screenshots/circuit_feel_01_lobby.png', fullPage: true });
    await expect(page.getByText(/Pressure Gates/i)).toBeVisible();

    await startRun(page);
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_02_ordinary_before_selection.png',
      fullPage: true,
    });

    await selectFirstPlayableTile(page);
    await expect(page.getByRole('group', { name: /Placement targets/i })).toBeVisible();
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_03_tile_selected_ends.png',
      fullPage: true,
    });

    // Illegal blocked-end attempt must not consume a strike.
    const strikesBefore = await page.locator('.rh-circuit-meter__value--strikes').innerText();
    const blocked = page.getByRole('button', { name: /(Left|Right) end blocked/i }).first();
    if (await blocked.isVisible().catch(() => false)) {
      await blocked.click();
      await expect(page.locator('.rh-circuit-notice')).toBeVisible();
      const strikesAfter = await page.locator('.rh-circuit-meter__value--strikes').innerText();
      expect(strikesAfter).toBe(strikesBefore);
    }

    // Rapid duplicate end clicks should not double-commit once feedback opens.
    const committed = await commitAnyLegalEnd(page);
    expect(committed).not.toBeNull();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 5_000 });
    // End targets unmount during reveal — duplicate commit must be impossible.
    await expect(page.getByRole('group', { name: /Placement targets/i })).toHaveCount(0);
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_04_reveal.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Continue' }).click();

    // Drive into Pressure Gate (gate 5).
    for (let i = 0; i < 50; i += 1) {
      if (await page.getByText(/Pressure Gate/i).first().isVisible().catch(() => false)) {
        if (await page.getByText(/Decision 1 of 3/i).isVisible().catch(() => false)) {
          await page.screenshot({
            path: '../audit-screenshots/circuit_feel_05_pressure_entrance.png',
            fullPage: true,
          });
          break;
        }
      }
      if (await page.getByLabel('Circuit results').isVisible().catch(() => false)) break;
      await playOneDecision(page);
    }

    // Advance within pressure gate toward decision 2 of 3 if present.
    for (let i = 0; i < 8; i += 1) {
      if (await page.getByText(/Decision 2 of 3/i).isVisible().catch(() => false)) {
        await page.screenshot({
          path: '../audit-screenshots/circuit_feel_06_pressure_decision_2.png',
          fullPage: true,
        });
        break;
      }
      if (await page.getByLabel('Circuit results').isVisible().catch(() => false)) break;
      await playOneDecision(page);
    }

    // Finish run.
    for (let i = 0; i < 80; i += 1) {
      if (await page.getByLabel('Circuit results').isVisible().catch(() => false)) break;
      await playOneDecision(page);
    }

    await expect(page.getByLabel('Circuit results')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Perfect|Sound|Blunders/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Again' })).toBeVisible();
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_07_results.png',
      fullPage: true,
    });

    const reviewBtn = page.getByRole('button', { name: 'Review Mistakes' });
    if (!(await reviewBtn.isDisabled())) {
      await reviewBtn.click();
      await expect(page.getByLabel('Circuit mistake review')).toBeVisible();
      await page.screenshot({
        path: '../audit-screenshots/circuit_feel_08_review.png',
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Back to results' }).click();
    }

    // Three consecutive Run Again restarts from results.
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: 'Run Again' }).click();
      await expect(page.getByLabel('Circuit run status')).toBeVisible();
      for (let j = 0; j < 80; j += 1) {
        if (await page.getByLabel('Circuit results').isVisible().catch(() => false)) break;
        await playOneDecision(page);
      }
      await expect(page.getByLabel('Circuit results')).toBeVisible({ timeout: 90_000 });
    }

    await page.getByRole('button', { name: '← Single Player' }).click();
    await expect(page.getByRole('heading', { name: 'Single Player' })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_09_solo_hub.png',
      fullPage: true,
    });

    await page.goto('/#/circuit');
    await expect(page.getByRole('heading', { name: 'The Circuit' })).toBeVisible();
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_10_lobby_reload.png',
      fullPage: true,
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Today/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('The Circuit continuation')).toHaveCount(0);
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_11_home_continuation.png',
      fullPage: true,
    });
  });

  test('keyboard placement commit', async ({ page }) => {
    await enterCircuit(page);
    await startRun(page);
    await selectFirstPlayableTile(page);
    const legal = page.getByRole('button', { name: /Play on (left|right)/i }).first();
    await legal.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.rh-circuit-feedback')).toBeVisible({ timeout: 5_000 });
  });

  test('narrow mobile viewport comfort', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await enterCircuit(page);
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_12_mobile_lobby.png',
      fullPage: true,
    });
    await startRun(page);
    await selectFirstPlayableTile(page);
    const ends = page.locator('.rh-circuit-ends');
    await expect(ends).toBeVisible();
    const box = await ends.boundingBox();
    expect(box).toBeTruthy();
    expect((box?.height ?? 0) >= 60).toBeTruthy();
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_13_mobile_selected.png',
      fullPage: true,
    });
  });

  test('reduced-motion run still commits and reveals', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterCircuit(page);
    await startRun(page);
    await selectFirstPlayableTile(page);
    await commitAnyLegalEnd(page);
    await expect(page.locator('.rh-circuit-feedback')).toBeVisible({ timeout: 5_000 });
    await page.screenshot({
      path: '../audit-screenshots/circuit_feel_14_reduced_motion_reveal.png',
      fullPage: true,
    });
  });
});
