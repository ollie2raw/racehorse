/**
 * Fritz Cup, end to end in the real app (Phase 3E, TOURNAMENT_E2E mode): Hub →
 * Play → the Quarterfinal (the Play tap's launch intent joins it) → Fritz
 * identity and the turn clock → a real move → a win → the post-match →
 * "Join Semifinal" by hand (never automatic) → … → beat Master Fritz →
 * Champion → History. Plus losing in the Quarterfinal. Analytics checkpoints
 * are counted through the app's dev-only capture.
 */
import { expect, test, type Page } from '@playwright/test';
import { admin, analyticsEvents, backendState, countEvent, playOneTile, signIn } from './tournament-backend/journey';

async function currentMatchId(round: number): Promise<string> {
  const state = await backendState();
  const m = state.matches.find((x) => x.round === round && (x.status === 'in_progress' || x.status === 'ready') && x.id.includes('-r'));
  if (!m) throw new Error(`no round ${round} match`);
  return m.id;
}

async function expectInMatch(page: Page, fritzName: string) {
  await expect(page.locator('.tmh')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tmh-fritz-chip')).toHaveText('Fritz');
  await expect(page.locator('.wl-player-label').first()).toContainText(fritzName);
  // The player's turn, timed by the server.
  await expect(page.locator('.tmh-turn__text')).toHaveText(/Your turn · \d+s/);
}

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test('Fritz Cup: Play → QF → SF → F (each later round by hand) → Champion → History', async ({ page }) => {
  await admin('/__e2e/reset', { live: [] });
  await signIn(page);
  await page.goto('/tournament');

  const card = page.getByRole('article', { name: 'Fritz Cup' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Play Fritz Cup' }).click();

  // The Play tap's intent joins the first match.
  await expectInMatch(page, 'Fritz');
  await playOneTile(page);
  await expect(page.locator('.tmh-turn__text')).toBeVisible();

  // Win the Quarterfinal.
  await admin(`/__e2e/match/${await currentMatchId(1)}/decide`, { winner: 'player' });
  await expect(page.getByText('You won')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Advanced to the Semifinal/)).toBeVisible();
  const joinSf = page.getByRole('button', { name: 'Join Semifinal' });
  await expect(joinSf).toBeVisible({ timeout: 15_000 });
  // Never automatic: the Semifinal is ready but not joined while we wait.
  await page.waitForTimeout(2_500);
  expect((await backendState()).matches.find((m) => m.round === 2 && m.status === 'ready')?.joined ?? false).toBe(false);
  expect((await backendState()).counters.attach).toBe(1);
  await joinSf.click();
  await expectInMatch(page, 'Elite Fritz');

  // Win the Semifinal, join the Final by hand.
  await admin(`/__e2e/match/${await currentMatchId(2)}/decide`, { winner: 'player' });
  await expect(page.getByText(/Advanced to the Final/)).toBeVisible({ timeout: 15_000 });
  const joinF = page.getByRole('button', { name: 'Join Final' });
  await expect(joinF).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  expect((await backendState()).counters.attach).toBe(2);
  await joinF.click();
  await expectInMatch(page, 'Master Fritz');

  // Beat Master Fritz.
  await admin(`/__e2e/match/${await currentMatchId(3)}/decide`, { winner: 'player' });
  // tournament:completed takes the player to the result (existing routing).
  await expect(page.getByText('Tournament Champion')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('You beat Master Fritz in the Final')).toBeVisible();

  // History lists the Cup as won.
  await page.getByRole('button', { name: 'Return to Tournament' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  const row = page.locator('.th-history__row').first();
  await expect(row).toContainText('Fritz Cup');
  await expect(row).toContainText('Champion');
  await expect(row).toContainText('Won');

  // Analytics checkpoints, once each.
  expect(await countEvent(page, 'fritz_cup_tapped')).toBe(1);
  expect(await countEvent(page, 'fritz_cup_created')).toBe(1);
  expect(await countEvent(page, 'tournament_match_joined')).toBe(3);
  expect(await countEvent(page, 'tournament_champion')).toBe(1);
  expect(await countEvent(page, 'tournament_hub_viewed')).toBeGreaterThanOrEqual(1);
  const ready = (await analyticsEvents(page)).filter((e) => e.event === 'tournament_match_ready');
  expect(ready.map((e) => e.props?.round)).toEqual([1, 2, 3]);
  expect(JSON.stringify(await analyticsEvents(page))).not.toMatch(/bot:fritz|e2e-player|cup-1/);
});

test('Fritz Cup: losing the Quarterfinal ends it — no Semifinal, a Fritz champion, History says Quarterfinal', async ({ page }) => {
  await admin('/__e2e/reset', { live: [] });
  await signIn(page);
  await page.goto('/tournament');
  await page.getByRole('article', { name: 'Fritz Cup' }).getByRole('button', { name: 'Play Fritz Cup' }).click();
  await expectInMatch(page, 'Fritz');

  await admin(`/__e2e/match/${await currentMatchId(1)}/decide`, { winner: 'opponent' });
  await expect(page.getByText('Eliminated in the Quarterfinal')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Lost to Fritz')).toBeVisible();
  await expect(page.getByRole('button', { name: /Join/ })).toHaveCount(0);
  expect((await backendState()).counters.attach).toBe(1);

  await page.getByRole('button', { name: 'Return to Tournament' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  const row = page.locator('.th-history__row').first();
  await expect(row).toContainText('Quarterfinal');
  await expect(row).toContainText('Champion: Master Fritz');
  await expect(row.locator('.th-history__fritz')).toHaveText('Fritz');
  expect(await countEvent(page, 'tournament_eliminated')).toBe(1);
});
