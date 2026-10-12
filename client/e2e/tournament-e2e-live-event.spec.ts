/**
 * Live Events, foreground recovery and the Fritz Cup switch, end to end in the
 * real app (Phase 3E, TOURNAMENT_E2E mode).
 */
import { expect, test, type Page } from '@playwright/test';
import { admin, backendState, countEvent, playOneTile, signIn } from './tournament-backend/journey';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

/** What the app hears when it comes back to the foreground. */
async function foreground(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

function localTime(minutesFromNow: number): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(Date.now() + minutesFromNow * 60_000);
}

test('Live Event: local time → register (stays on the Hub) → ready (no auto-join) → Join from the banner → eliminated → History', async ({ page }) => {
  // Start on a whole minute so the expected local time matches the card.
  const startsInMin = 300;
  await admin('/__e2e/reset', { live: [{ id: 'live-1', startsInMin, registeredCount: 3 }] });
  await signIn(page);
  await page.goto('/tournament');

  const card = page.getByRole('article', { name: /^Live Event/ });
  await expect(card).toContainText(localTime(startsInMin).replace(/^0/, ''));
  await expect(card).toContainText('3 registered · Fritz fills open seats');
  await card.getByRole('button', { name: 'Register' }).click();
  await expect(card).toContainText('Registered');
  await expect(page).toHaveURL(/\/tournament$/);
  await expect(card).toContainText('4 registered');
  expect(await countEvent(page, 'live_event_registered')).toBe(1);

  // The event starts; the Quarterfinal is ready — shown, never joined on its own.
  await admin('/__e2e/live/live-1/start', { opponent: 'human' });
  await expect(page.getByText('Your Quarterfinal is ready').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_500);
  expect((await backendState()).counters.attach).toBe(0);

  // Elsewhere in the app (Learn, Solo, Home) the banner offers Join.
  const banner = page.getByRole('status', { name: 'Your Quarterfinal is ready' });
  for (const path of ['/learn', '/solo']) {
    await page.goto(path);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner.getByRole('button', { name: 'Join your Quarterfinal' })).toBeVisible();
  }
  await page.goto('/');
  await expect(banner).toBeVisible({ timeout: 10_000 });
  expect((await backendState()).counters.attach).toBe(0);
  await banner.getByRole('button', { name: 'Join your Quarterfinal' }).click();

  // In the match: a human opponent (no Fritz chip), the server's turn clock.
  await expect(page.locator('.tmh')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.tmh-fritz-chip')).toHaveCount(0);
  await expect(page.locator('.tmh-turn__text')).toHaveText(/Your turn · \d+s/);
  await expect(banner).toHaveCount(0);
  await playOneTile(page);

  // The rival wins: eliminated, in words.
  const qf = (await backendState()).matches.find((m) => m.round === 1 && m.status === 'in_progress')!;
  await admin(`/__e2e/match/${qf.id}/decide`, { winner: 'opponent' });
  await expect(page.getByText(/Eliminated in the Quarterfinal|Tournament Complete/).first()).toBeVisible({ timeout: 15_000 });

  await page.goto('/tournament/history');
  const row = page.locator('.th-history__row').first();
  await expect(row).toContainText('Live Event');
  await expect(row).toContainText('Quarterfinal');
  expect(await countEvent(page, 'tournament_match_ready')).toBeLessThanOrEqual(1);
});

test('Live Event: cancellation removes the countdown, every action and the ready banner', async ({ page }) => {
  await admin('/__e2e/reset', { live: [{ id: 'live-c', startsInMin: 90, registeredCount: 2, registered: true }] });
  await signIn(page);
  await page.goto('/tournament');
  const card = page.getByRole('article', { name: /^Live Event/ });
  await expect(card).toContainText('Registered');
  await admin('/__e2e/live/live-c/start', {});
  await expect(card).toContainText('Your Quarterfinal is ready', { timeout: 15_000 });
  await page.getByRole('button', { name: /Back to Home/ }).click();
  await expect(page.getByRole('status', { name: 'Your Quarterfinal is ready' })).toBeVisible();

  await admin('/__e2e/tournament/live-c/cancel');
  await expect(page.getByRole('status', { name: 'Your Quarterfinal is ready' })).toHaveCount(0, { timeout: 10_000 });
  await page.goto('/tournament');
  await expect(page.getByText('This event was cancelled')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Join|Register|Resume/ })).toHaveCount(0);
  await expect(page.getByText(/Starts in/)).toHaveCount(0);
});

test('Live Event: registration closed, an overlapping entry, and a full field — in words, on the card', async ({ page }) => {
  await admin('/__e2e/reset', { live: [{ id: 'live-o', startsInMin: 200, registeredCount: 2 }, { id: 'live-f', startsInMin: 400, registeredCount: 8 }] });
  await signIn(page);
  await page.goto('/tournament');
  const [first, second] = [page.getByRole('article', { name: /^Live Event/ }).first(), page.getByRole('article', { name: /^Live Event/ }).nth(1)];
  // The full one: no Register, no Fritz-fill claim (shown compact, so its own words).
  await expect(second).toContainText('Full');
  await expect(second.getByRole('button', { name: 'Register' })).toHaveCount(0);

  await admin('/__e2e/register-error', { code: 'registration_closed' });
  await first.getByRole('button', { name: 'Register' }).click();
  await expect(first.getByRole('alert')).toHaveText('Registration has closed for this event.');
  await expect(page).toHaveURL(/\/tournament$/);

  await admin('/__e2e/register-error', { code: 'overlapping_tournament', conflict: { tournamentId: 'cup-x', kind: 'fritz_cup', scheduledStart: new Date().toISOString() } });
  await first.getByRole('button', { name: 'Register' }).click();
  await expect(first.getByRole('alert')).toHaveText('You have a Fritz Cup in progress. Finish it first.');
  expect(await countEvent(page, 'live_event_registration_failed')).toBe(2);
});

test('foreground: a missed match_ready is recovered from /my as Join (no auto-join); a joined match is restored automatically', async ({ page }) => {
  await admin('/__e2e/reset', { live: [{ id: 'live-f1', startsInMin: 60, registeredCount: 4, registered: true }] });
  await signIn(page);
  await page.goto('/');
  // Let the app settle (connected, /my loaded) — then nothing refetches until it is foregrounded.
  await expect.poll(async () => (await backendState()).counters.myFetches, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(2_000);
  // The event starts while the app is in the background: the push is missed.
  const { matchId } = await admin('/__e2e/live/live-f1/start', { emit: false }) as { matchId: string };
  await page.waitForTimeout(1_000);
  await expect(page.getByRole('status', { name: 'Your Quarterfinal is ready' })).toHaveCount(0);
  await foreground(page);
  const banner = page.getByRole('status', { name: 'Your Quarterfinal is ready' });
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner.getByRole('button', { name: 'Join your Quarterfinal' })).toBeVisible();
  await page.waitForTimeout(2_000);
  expect((await backendState()).counters.attach).toBe(0);

  // Now the player had already joined it (e.g. on another tab) and the app returns.
  await admin(`/__e2e/match/${matchId}/joined`);
  await foreground(page);
  await expect(page.locator('.tmh')).toBeVisible({ timeout: 15_000 });
  expect((await backendState()).counters.attach).toBe(1);
});

test('Fritz Cup switch: off → no Fritz card or copy, Live Events work; on → the card appears without a rebuild', async ({ page }) => {
  await admin('/__e2e/reset', { features: { tournaments: true, fritzCup: false }, live: [{ id: 'live-s', startsInMin: 120, registeredCount: 1 }] });
  await signIn(page);
  await page.goto('/tournament');
  const live = page.getByRole('article', { name: /^Live Event/ });
  await expect(live).toBeVisible();
  await expect(page.getByRole('article', { name: 'Fritz Cup' })).toHaveCount(0);
  await expect(page.getByText(/Fritz Cup/)).toHaveCount(0);
  await expect(live).toContainText('1 registered');
  await live.getByRole('button', { name: 'Register' }).click();
  await expect(live).toContainText('Registered');

  await admin('/__e2e/features', { tournaments: true, fritzCup: true });
  await foreground(page);
  await expect(page.getByRole('article', { name: 'Fritz Cup' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Play a Fritz Cup any time, or join a Live Event with other players.')).toBeVisible();
});
