import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Ghost Mode — the last of FEATURE_COMPLETENESS_AUDIT.md §5.1's named
 * zero-coverage modes (alongside Fritz #175, Puzzle Rush #180, The Lab #181).
 * No spec exercised Ghost Mode at all before this.
 *
 * Ghost Mode requires a signed-in account (server-side: /api/ghost/start
 * writes verified_single_player_matches.user_id, a hard FK to auth.users —
 * the same e2e-dev-auth bypass that works for Daily Fritz 409s here, same as
 * Puzzle Rush's rush_runs FK). So this follows the same authenticated-fixture
 * pattern as daily-fritz-v2.spec.ts / puzzle-rush-play-to-completion.spec.ts:
 * skips without a current .auth/daily-fritz-qa.json.
 *
 * Deliberately targets the *featured* ghost ("oliver", FEATURED_GHOST_USERNAME
 * in GhostSetupScreen.tsx), not the QA account's own ghost — your own ghost is
 * locked behind UNLOCK_THRESHOLD=5 Fritz games, and the featured ghost has no
 * such lock regardless of the signed-in account's own history. This is what
 * makes the mode reachable without also seeding 5 games of match history.
 *
 * GhostMatchRoute renders the same BotMatchScreen Play-vs-Fritz uses (mode
 * prop differs, UI is identical), so the pre-game-draw + play loop + result
 * overlay are all the same selectors already proven in
 * fritz-play-to-completion.spec.ts.
 *
 *   home entry       text "Single Player" -> text "Ghost Mode"
 *   opponent select   .ghost-pvf-opponent-row--gold (the featured row; async —
 *                      retried until selected, since featuredUserId loads after mount)
 *   start             .ghost-pvf-start-btn
 *   playable tile     .hand-container button.domino-tile:not(.unplayable):not(.disabled)
 *   placement         .placement-zone.active
 *   result            role=dialog name="Play vs Fritz result" (shared overlay, both modes)
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

async function selectFeaturedGhost(page: Page) {
  const featuredRow = page.locator('.ghost-pvf-opponent-row--gold').first();
  const start = page.locator('.ghost-pvf-start-btn');

  // featuredUserId resolves from an async fetch after mount; retry the click
  // until the row shows selected (checkmark) or the start button enables.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await featuredRow.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
    const selected = await featuredRow
      .evaluate((el) => el.className.includes('fritz-selectable-row--active'))
      .catch(() => false);
    if (selected) return;
    if (await start.isEnabled().catch(() => false)) return;
    await page.waitForTimeout(500);
  }
  throw new Error('Featured ghost row never became selected — featuredUserId likely never resolved');
}

async function startGhostMatch(page: Page) {
  await page.goto('/');
  await page.getByText('Single Player', { exact: false }).first().click();
  await page.getByText('Ghost Mode', { exact: false }).first().click();
  await expect(page.locator('.ghost-pvf-opponent-row--gold').first()).toBeVisible({ timeout: 15_000 });

  await selectFeaturedGhost(page);

  const start = page.locator('.ghost-pvf-start-btn');
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
}

async function completePreGameDraw(page: Page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock)').first();
  for (let i = 0; i < 20; i += 1) {
    if (await hand.isVisible().catch(() => false)) return;
    if (await pickable.isVisible().catch(() => false)) {
      await pickable.click({ timeout: ACTION_TIMEOUT }).catch(() => {});
    }
    await page.waitForTimeout(750);
  }
}

async function playToResult(page: Page) {
  const result = page.getByRole('dialog', { name: 'Play vs Fritz result' });
  const handOver = page.getByTestId('hand-over-modal');
  const reloadHand = page.getByRole('button', { name: /^Reload Hand$/i });
  const playable = page
    .locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)')
    .first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('[class*="boneyard"]').first();

  const deadline = Date.now() + 520_000;
  let lastProgress = '';
  let lastProgressAt = Date.now();

  while (Date.now() < deadline) {
    if (await result.isVisible().catch(() => false)) return;

    if (await handOver.isVisible().catch(() => false)) {
      await page.waitForTimeout(1_500);
      continue;
    }

    if (await reloadHand.isVisible().catch(() => false)) {
      await reloadHand.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      await page.waitForTimeout(1_500);
      continue;
    }

    const handTiles = await playable.count().catch(() => 0);
    if (handTiles > 0) {
      await playable.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      if (await zone.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await zone.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
      }
    } else if (await boneyard.isVisible().catch(() => false)) {
      await boneyard.click({ force: true, timeout: ACTION_TIMEOUT }).catch(() => {});
    }

    await page.waitForTimeout(1_200);

    const progress = await page
      .evaluate(() => {
        const tiles = document.querySelectorAll('.board-tile-wrapper, .domino-tile.board-tile').length;
        const live = document.querySelector('[role="status"], [aria-live]')?.textContent ?? '';
        return `${tiles}|${live.trim()}`;
      })
      .catch(() => lastProgress);
    if (progress !== lastProgress) {
      lastProgress = progress;
      lastProgressAt = Date.now();
    } else if (Date.now() - lastProgressAt > 90_000) {
      throw new Error(`Ghost match wedged — no board/score progress in 90s. Last state: "${lastProgress}"`);
    }
  }
  throw new Error('Ghost match did not reach a result within the time budget');
}

test.describe('Ghost Mode play-to-completion', () => {
  test.skip(!hasValidAuthState(authState), 'A current authenticated Daily Fritz QA fixture is required');

  test('runs a full match against the featured ghost to a result screen', async ({ browser }) => {
    test.setTimeout(600_000);
    const context = await browser.newContext({ storageState: authState });
    await context.addInitScript(() => window.localStorage.setItem('hasSeenWelcome', '1'));
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    try {
      await startGhostMatch(page);
      await completePreGameDraw(page);
      await playToResult(page);

      const result = page.getByRole('dialog', { name: 'Play vs Fritz result' });
      await expect(result).toBeVisible();
      await expect(result.locator('.df-result-title')).toHaveText(/^(Victory|Defeat)$/);
      await expect(result.getByText('Final Score')).toBeVisible();
      await expect(result.getByText('Final Standings')).toBeVisible();
      await expect(result.getByRole('button', { name: /Rematch/i })).toBeVisible();

      expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
