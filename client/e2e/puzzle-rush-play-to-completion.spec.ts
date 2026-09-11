import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Puzzle Rush — the other half of the "play a mode to completion" gap
 * (FEATURE_COMPLETENESS_AUDIT.md §5.1, alongside fritz-play-to-completion).
 * Puzzle Rush had zero functional e2e coverage; smoke.spec.ts only checks the
 * hub loads.
 *
 * Unlike Play vs Fritz, Puzzle Rush requires a signed-in user — the hub shows
 * a persistent "Sign in to continue." notice and starting a run needs an
 * authenticated identity.
 *
 * The dev-only e2e auth bypass daily-fritz-server-restore.spec.ts uses
 * (`racehorse_e2e_user_id` / `racehorse_e2e_bearer=e2e-daily-fritz`, read by
 * `src/auth/e2eDevAuth.ts`) gets past the client-side sign-in gate, but
 * Puzzle Rush's persistence has a hard FK — `rush_runs.user_id` must already
 * exist in the `users` table — that Daily Fritz doesn't have (it runs behind
 * `DAILY_FRITZ_MEMORY_STORE=1`, an accommodation Puzzle Rush has none of). A
 * synthetic `crypto.randomUUID()` identity 409s on the first `rush_runs`
 * insert. So this follows the same authenticated-*fixture* pattern as
 * daily-fritz-v2.spec.ts / spectator-mode.spec.ts instead: it skips without a
 * current `.auth/daily-fritz-qa.json` (gitignored, refreshed by hand) — a
 * real signed-up account already has a `users` row.
 *
 * Each Rush puzzle is a single one-turn placement (place one tile, the puzzle
 * resolves immediately — see PuzzleRushPlayView's `finish()` calls) with an
 * auto-fail path when there's no legal move at all, so a full run is a tight
 * loop of "click a playable tile, click its placement zone" repeated across
 * the puzzle pool, terminated by either exhausting the pool or the run clock
 * (120s base + per-solve bonus seconds) hitting zero. This plays a real run
 * to the results view and asserts it renders with a score and solved count.
 *
 *   home entry     region "Daily Puzzle" -> button /play|continue/i (no URL route)
 *   start          .df-pvf-start-btn ("Start Puzzle Rush" / "Play Again")
 *   playable tile  .hand-container button.domino-tile:not(.unplayable):not(.disabled)
 *   placement      .placement-zone.active
 *   results        [data-ui="rush-results"]
 */

const authState = path.resolve(process.cwd(), '.auth/daily-fritz-qa.json');

function hasValidAuthState(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name?: string; value?: string }> }>;
    };
    return (
      state.origins?.some((origin) =>
        origin.localStorage?.some((entry) => {
          if (!entry.name?.startsWith('sb-') || !entry.name.endsWith('-auth-token') || !entry.value) {
            return false;
          }
          const session = JSON.parse(entry.value) as { expires_at?: unknown };
          return typeof session.expires_at === 'number' && session.expires_at > Date.now() / 1000 + 60;
        }),
      ) ?? false
    );
  } catch {
    return false;
  }
}

const ACTION_TIMEOUT = 5_000;

test.describe.configure({ retries: process.env.CI ? 2 : 1 });

async function startPuzzleRush(page: Page) {
  await page.goto('/');
  await page
    .getByRole('region', { name: /Daily Puzzle/ })
    .getByRole('button', { name: /play|continue|view results/i })
    .click();
  await expect(page.locator('.df-page, .df-shell').first()).toBeVisible({ timeout: 15_000 });
  const start = page.locator('.df-pvf-start-btn');
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.puzzle-rush-root')).toBeVisible({ timeout: 20_000 });
}

async function playToResults(page: Page) {
  const results = page.locator('[data-ui="rush-results"]');
  const playable = page
    .locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)')
    .first();
  const zone = page.locator('.placement-zone.active').first();

  const deadline = Date.now() + 300_000;
  let lastProgress = '';
  let lastProgressAt = Date.now();

  while (Date.now() < deadline) {
    if (await results.isVisible().catch(() => false)) return;

    if (await playable.isVisible().catch(() => false)) {
      await playable.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      if (await zone.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await zone.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      }
    }

    await page.waitForTimeout(500);

    // Progress = the ordinal/score HUD text + tile count. If it hasn't moved
    // in 30s (each puzzle is a single placement — this should be fast) and
    // there's still no results view, the run is wedged.
    const progress = await page
      .evaluate(() => {
        const ordinal = document.querySelector('[data-ui="rush-hud-run"]')?.textContent ?? '';
        const tiles = document.querySelectorAll('.hand-container .domino-tile').length;
        return `${ordinal}|${tiles}`;
      })
      .catch(() => lastProgress);
    if (progress !== lastProgress) {
      lastProgress = progress;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > 30_000) {
      throw new Error(`Puzzle Rush run wedged — no progress in 30s. Last state: "${lastProgress}"`);
    }
  }
  throw new Error('Puzzle Rush run did not reach results within the time budget');
}

test.describe('Puzzle Rush play-to-completion', () => {
  test.skip(!hasValidAuthState(authState), 'A current authenticated Daily Fritz QA fixture is required');

  test('runs a full run to the results view', async ({ browser }) => {
    test.setTimeout(360_000);
    const context = await browser.newContext({ storageState: authState });
    await context.addInitScript(() => window.localStorage.setItem('hasSeenWelcome', '1'));
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    try {
      await startPuzzleRush(page);
      await playToResults(page);

      const results = page.locator('[data-ui="rush-results"]');
      await expect(results).toBeVisible();
      await expect(results.getByText('Run complete')).toBeVisible();
      await expect(page.locator('[data-ui="rush-final-score"]')).toBeVisible();
      await expect(results.getByText('Solved')).toBeVisible();
      await expect(results.getByRole('button', { name: /Play again/i })).toBeVisible();

      expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
