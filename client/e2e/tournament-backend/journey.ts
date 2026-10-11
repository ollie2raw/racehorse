/**
 * Helpers for the tournament journeys (TOURNAMENT_E2E mode): sign in as the
 * e2e player, drive the fake backend's admin routes, read analytics captured
 * by the app's dev-only capture seam.
 */
import { expect, type Page } from '@playwright/test';

export const BACKEND = 'http://127.0.0.1:3277';
export const USER_ID = 'e2e-player-0001';

export async function admin(path: string, body: unknown = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`admin ${path} → ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function backendState(): Promise<{
  counters: { attach: number; myFetches: number };
  matches: Array<{ id: string; round: number; status: string; joined: boolean; tournament_id: string }>;
}> {
  return (await (await fetch(`${BACKEND}/__e2e/state`)).json()) as never;
}

/** Signed in as the e2e player (the app's dev-only sign-in), welcome seen, nothing leaves localhost. */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript((userId) => {
    window.localStorage.setItem('racehorse_e2e_user_id', userId);
    window.localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
    window.localStorage.setItem('hasSeenWelcome', '1');
  }, USER_ID);
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
}

export async function analyticsEvents(page: Page): Promise<Array<{ event: string; props?: Record<string, unknown> }>> {
  return page.evaluate(() => (window as unknown as { __rhAnalyticsEvents?: Array<{ event: string; props?: Record<string, unknown> }> }).__rhAnalyticsEvents ?? []);
}

export async function countEvent(page: Page, event: string): Promise<number> {
  return (await analyticsEvents(page)).filter((e) => e.event === event).length;
}

/**
 * Play one legal tile from the hand — a real game:action round trip
 * (selectors per the repo's match-driving notes: board tiles also carry
 * `.highlight`, so the hand scope is load-bearing).
 */
export async function playOneTile(page: Page): Promise<void> {
  const tile = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  // Count tiles on the board, not in the hand: after a move the rules can
  // force the player to draw (the hand may grow), but the board only grows.
  const boardCount = () => page.locator('.domino-tile.board-tile').count();
  const before = await boardCount();
  await tile.click();
  // Either the tile plays at once, or a placement choice appears (possibly a
  // moment later) — wait for whichever happens, never check just once.
  const zone = page.locator('.placement-zone.active').first();
  await expect.poll(async () => (await boardCount()) > before || (await zone.isVisible().catch(() => false)), { timeout: 10_000 }).toBe(true);
  if ((await boardCount()) <= before) await zone.click();
  await expect.poll(boardCount, { timeout: 10_000 }).toBeGreaterThan(before);
}
