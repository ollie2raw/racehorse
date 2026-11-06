/**
 * Tournament match flow with the real server's timing (TOURNAMENT_E2E mode): Fritz opens a match after a delay, and a hand ends and the next
 * is dealt. Owner reports, production, Nov 2 and Nov 6: "YOUR TURN" with every tile grey on the first turn, and "Fritz starts the next hand while
 * I still see the end-of-hand modal". The fake backend only behaves like the real server here when the test opts in (`/__e2e/realism`).
 */
import { expect, test, type Page } from '@playwright/test';
import { BACKEND, admin, backendState, playOneTile, signIn } from './tournament-backend/journey';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function joinFritzQuarterfinal(page: Page, realism: Record<string, unknown>) {
  await admin('/__e2e/reset', { live: [{ id: 'live-m', startsInMin: 120, registeredCount: 3, registered: true }] });
  await admin('/__e2e/realism', realism);
  await signIn(page);
  await page.goto('/tournament');
  const card = page.getByRole('article', { name: /^Live Event/ });
  await expect(card).toContainText('Registered');
  await admin('/__e2e/live/live-m/start', {});
  await expect(card).toContainText('Your Quarterfinal is ready', { timeout: 15_000 });
  await page.getByRole('button', { name: /Back to Home/ }).click();
  const banner = page.getByRole('status', { name: 'Your Quarterfinal is ready' });
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await banner.getByRole('button', { name: 'Join your Quarterfinal' }).click();
  await expect(page.locator('.tmh')).toBeVisible({ timeout: 15_000 });
}

async function handReadySignals(): Promise<number> {
  const state = (await (await fetch(`${BACKEND}/__e2e/state`)).json()) as { socketLog: string[] };
  return state.socketLog.filter((line) => /^event \S+ hand:ready$/.test(line)).length;
}

const playableTile = (page: Page) => page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();

test('Fritz opens: the hand is playable as soon as it is the player\'s turn', async ({ page }) => {
  await joinFritzQuarterfinal(page, { fritzOpens: true, fritzMoveMs: 1_200 });

  await expect(page.locator('.tmh-turn__text')).toHaveText(/Your turn · \d+s/, { timeout: 15_000 });
  await expect(playableTile(page)).toBeVisible({ timeout: 3_000 });
  await playOneTile(page);
});

test('a hand ends: the player is not ready, and the next hand is not dealt, until they have seen the hand-over reveal', async ({ page }) => {
  await joinFritzQuarterfinal(page, { handDealMinMs: 2_500, nextHandFritzOpens: true, fritzMoveMs: 1_000 });
  await expect(playableTile(page)).toBeVisible({ timeout: 10_000 });
  const match = (await backendState()).matches.find((m) => m.round === 1 && m.status === 'in_progress')!;

  await admin(`/__e2e/match/${match.id}/end-hand`);

  // The state arrives first and the reveal 1.4 s later; no ready signal may go out before the player can see anything.
  await page.waitForTimeout(1_000);
  expect(await handReadySignals()).toBe(0);
  const reveal = page.getByText('Remaining Tiles').first();
  await expect(reveal).toBeVisible({ timeout: 5_000 });
  expect(await handReadySignals()).toBe(0);

  // The reveal closes on its own after four seconds: then the player is ready, the next hand is dealt, Fritz opens it, and the reveal is gone.
  await expect(reveal).toBeHidden({ timeout: 10_000 });
  await expect.poll(handReadySignals, { timeout: 5_000 }).toBe(1);
  await expect(playableTile(page)).toBeVisible({ timeout: 8_000 });
  await expect(reveal).toBeHidden();
  expect(await handReadySignals()).toBe(1);
});
