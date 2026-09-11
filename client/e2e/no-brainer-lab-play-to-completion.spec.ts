import { expect, test, type Page } from '@playwright/test';

/**
 * The Lab (No Brainer Lab) — the last of FEATURE_COMPLETENESS_AUDIT.md §5.1's
 * named zero-coverage modes (alongside Fritz #175 and Puzzle Rush #180). No
 * spec exercised it at all before this.
 *
 * Every hand here is curated so all 7 starting tiles chain together and can
 * be played in one turn — but "a" legal move at each step is not the same as
 * "the" move: a greedy "click any playable tile" loop can pick a legal
 * placement that still dead-ends the rest of the hand (confirmed — it wedged
 * a real run with tiles left and nothing playable). This isn't something to
 * out-guess with driver logic; the mode itself ships the answer — "Show
 * Solution" reveals `record.example`, the exact clearing order, as its own
 * row of tiles. This drives play by reading that sequence's `aria-label`s
 * ("Domino L-H", per DominoTile.tsx) and matching each to a hand tile in
 * order, which is what a stuck real player would do.
 *
 * Anonymous-playable (progress is tracked in localStorage, not a server
 * call) — no auth complications like Ghost Mode or Puzzle Rush hit.
 *
 *   route            /practice
 *   intro dialog     role=dialog name="What's a no brainer?" -> "Start training"
 *   show solution    button "Show Solution" -> .nbl-solution__tiles (ordered)
 *   hand tile        .hand-container .domino-tile[aria-label="Domino L-H"]
 *   placement        .placement-zone.active
 *   win banner       .nbl-win-banner (role="status", "Cleared — no brainer")
 */

const ACTION_TIMEOUT = 5_000;

test.describe.configure({ retries: process.env.CI ? 2 : 1 });

async function startLab(page: Page) {
  await page.goto('/practice');
  const intro = page.getByRole('dialog', { name: "What's a no brainer?" });
  await expect(intro).toBeVisible({ timeout: 15_000 });
  await intro.getByRole('button', { name: 'Start training' }).click();
  await expect(page.locator('.hand-container').first()).toBeVisible({ timeout: 15_000 });
}

async function playToWin(page: Page) {
  const winBanner = page.locator('.nbl-win-banner');
  const zone = page.locator('.placement-zone.active').first();

  await page.getByRole('button', { name: 'Show Solution' }).click();
  const solutionTiles = page.locator('.nbl-solution__tiles .domino-tile');
  await expect(solutionTiles.first()).toBeVisible({ timeout: 5_000 });
  const rawLabels = await solutionTiles.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label')).filter((label): label is string => !!label),
  );
  // Solution tiles render with `disabled`, which appends ", opponent's turn"
  // to the aria-label (DominoTile.tsx) — strip it back to "Domino L-H" so it
  // matches the (undisabled, playable) hand tile's own aria-label exactly.
  const sequence = rawLabels.map((label) => label.match(/^Domino \d+-\d+/)?.[0]).filter((v): v is string => !!v);
  expect(sequence.length, 'expected a non-empty solution sequence').toBeGreaterThan(0);
  expect(sequence.length, 'expected every solution label to parse').toBe(rawLabels.length);

  for (const label of sequence) {
    if (await winBanner.isVisible().catch(() => false)) return;
    const handTile = page.locator(`.hand-container button.domino-tile[aria-label="${label}"]`).first();
    await handTile.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
    if (await zone.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await zone.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
    }
    await page.waitForTimeout(300);
  }

  await expect(winBanner).toBeVisible({ timeout: 5_000 });
}

test('The Lab clears a no-brainer hand and shows the win banner', async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await startLab(page);
  await playToWin(page);

  await expect(page.locator('.nbl-win-banner')).toHaveText('Cleared — no brainer');
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});
