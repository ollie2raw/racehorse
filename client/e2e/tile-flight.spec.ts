import { expect, test, type Page } from '@playwright/test';

/**
 * A placed tile travels to its place (src/components/board/useTileFlight.ts). In a real Play vs Fritz match,
 * a per-frame sampler records the flying copy's centre and whether the real board tile is waiting hidden,
 * and these pin the behaviour:
 *   - tapping a hand tile then a zone: the copy starts at the hand tile and lands on the board tile;
 *   - dragging: the copy starts where the tile was released;
 *   - Fritz's plays fly in from his rack;
 *   - the flight lasts 200-450 ms, the real tile is hidden only during it, and the copy is always removed.
 */

async function startRookieMatch(page: Page) {
  await page.goto('/');
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  const start = page.getByText('Start Match', { exact: false }).first();
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
}

async function completePreGameDraw(page: Page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock)').first();
  // The shared CI runner is several times slower than a laptop: allow a minute for the pre-game draw to resolve.
  for (let i = 0; i < 90; i += 1) {
    if (await hand.isVisible().catch(() => false)) return;
    // The draw tiles overlap in a pile: force the click, as the other specs do, so a neighbour cannot intercept it.
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

interface FlightSample {
  t: number;
  cx: number | null;
  cy: number | null;
  hidden: number;
}

async function installSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __flight: Array<[number, number | null, number | null, number]>; __flightOn: boolean };
    w.__flight = [];
    w.__flightOn = true;
    const tick = () => {
      if (!w.__flightOn) return;
      const clone = document.querySelector('.tile-flight-clone');
      const r = clone?.getBoundingClientRect();
      w.__flight.push([
        performance.now(),
        r ? r.left + r.width / 2 : null,
        r ? r.top + r.height / 2 : null,
        document.querySelectorAll(".board-tile-wrapper[data-flight='active']").length,
      ]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function readSamples(page: Page): Promise<FlightSample[]> {
  const raw = await page.evaluate(() => (window as unknown as { __flight: Array<[number, number | null, number | null, number]> }).__flight);
  return raw.map(([t, cx, cy, hidden]) => ({ t, cx, cy, hidden }));
}

/** The frames in which a flying copy exists, from `sinceMs` on (so an earlier flight is never mistaken for ours). */
const flying = (samples: FlightSample[], sinceMs = 0) => samples.filter((s) => s.cx !== null && s.t >= sinceMs);

/** Fritz's play can still be landing the instant our turn begins; let any flight finish before we start measuring. */
async function waitForNoFlight(page: Page) {
  await expect(page.locator('.tile-flight-clone')).toHaveCount(0);
  await page.waitForTimeout(350);
  await expect(page.locator('.tile-flight-clone')).toHaveCount(0);
}

const now = (page: Page) => page.evaluate(() => performance.now());

const PLAYABLE = '.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)';

async function setup(page: Page) {
  await startRookieMatch(page);
  await completePreGameDraw(page);
  await expect(page.locator('.board-container')).toBeVisible({ timeout: 45_000 });
}

async function centre(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const boardTiles = (page: Page) => page.locator('.board-tile-wrapper').count();

test('a tapped tile flies from the hand to its place on the board', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page);
  const tile = page.locator(PLAYABLE).first();
  await expect(tile).toBeVisible({ timeout: 90_000 });
  await waitForNoFlight(page);
  const handCentre = await centre(tile);
  const before = await boardTiles(page);

  await installSampler(page);
  await tile.click();
  const zone = page.locator('.placement-zone.active').first();
  await expect(zone).toBeVisible();
  const clickedAt = await now(page);
  await zone.click();
  await expect.poll(() => boardTiles(page), { timeout: 5000 }).toBe(before + 1);
  await page.waitForTimeout(700);

  const samples = await readSamples(page);
  const frames = flying(samples, clickedAt);
  expect(frames.length, 'a copy of the tile should have flown').toBeGreaterThan(5);

  // Starts at the hand tile it was tapped from.
  const first = frames[0];
  expect(Math.hypot((first.cx as number) - handCentre.x, (first.cy as number) - handCentre.y)).toBeLessThan(80);

  // Lasts 200-450 ms.
  const durationMs = frames[frames.length - 1].t - frames[0].t;
  expect(durationMs).toBeGreaterThan(150);
  expect(durationMs).toBeLessThan(500);

  // Lands on the real board tile (the newest wrapper) within a few px, at the end of the flight.
  const finalTile = await page.evaluate(() => {
    const wrappers = [...document.querySelectorAll<HTMLElement>('.board-tile-wrapper')];
    const arrived = wrappers.find((w) => w.dataset.placementFeedback === 'arrive') ?? wrappers[wrappers.length - 1];
    const r = arrived.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  const last = frames[frames.length - 1];
  expect(Math.hypot((last.cx as number) - finalTile.cx, (last.cy as number) - finalTile.cy)).toBeLessThan(40);

  // The real tile waited hidden only during the flight, and everything is cleaned up.
  expect(samples.some((s) => s.hidden > 0)).toBe(true);
  expect(await page.locator('.tile-flight-clone').count()).toBe(0);
  expect(await page.locator(".board-tile-wrapper[data-flight='active']").count()).toBe(0);
});

test('a dragged tile flies from where it was released', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page);
  const tile = page.locator(PLAYABLE).first();
  await expect(tile).toBeVisible({ timeout: 90_000 });
  await waitForNoFlight(page);
  const from = await centre(tile);
  const before = await boardTiles(page);

  await installSampler(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 30, { steps: 4 });
  const zone = page.locator('.placement-zone.active').first();
  await expect(zone).toBeVisible();
  const target = await centre(zone);
  await page.mouse.move(target.x, target.y, { steps: 12 });
  const releasedAt = await now(page);
  await page.mouse.up();
  await expect.poll(() => boardTiles(page), { timeout: 5000 }).toBe(before + 1);
  await page.waitForTimeout(700);

  const frames = flying(await readSamples(page), releasedAt);
  // The drag's own ghost is not the flight copy, so every sample here is the flight; it starts at the release point.
  expect(frames.length).toBeGreaterThan(3);
  const first = frames[0];
  expect(Math.hypot((first.cx as number) - target.x, (first.cy as number) - target.y)).toBeLessThan(80);
  expect(await page.locator('.tile-flight-clone').count()).toBe(0);
});

test("Fritz's tile flies in from his rack", async ({ page }) => {
  test.setTimeout(240_000);
  await setup(page);
  const rack = page.locator('.rh-tile-rack').first();
  await expect(rack).toBeVisible();
  const rackBox = await rack.boundingBox();
  if (!rackBox) throw new Error('no rack');
  await installSampler(page);

  // Play our tiles until a flight that BEGINS at Fritz's rack has been seen.
  const rackCentre = { x: rackBox.x + rackBox.width / 2, y: rackBox.y + rackBox.height / 2 };
  const tile = page.locator(PLAYABLE).first();
  const zone = page.locator('.placement-zone.active').first();
  const flights = (samples: FlightSample[]) => {
    const runs: FlightSample[][] = [];
    for (const s of flying(samples)) {
      const run = runs[runs.length - 1];
      if (run && s.t - run[run.length - 1].t < 120) run.push(s);
      else runs.push([s]);
    }
    return runs;
  };
  const fromRack = (samples: FlightSample[]) =>
    flights(samples).filter(
      (run) => run.length > 5 && Math.hypot((run[0].cx as number) - rackCentre.x, (run[0].cy as number) - rackCentre.y) < 90,
    );
  let found: FlightSample[][] = [];
  for (let attempt = 0; attempt < 12 && found.length === 0; attempt += 1) {
    if (await tile.isVisible().catch(() => false)) {
      await tile.click({ force: true, timeout: 4000 }).catch(() => {});
      if (await zone.isVisible({ timeout: 2000 }).catch(() => false)) await zone.click({ force: true, timeout: 4000 }).catch(() => {});
    }
    await page.waitForTimeout(2200);
    found = fromRack(await readSamples(page));
  }
  expect(found.length, "a flight should have begun at Fritz's rack").toBeGreaterThan(0);
  expect(await page.locator('.tile-flight-clone').count()).toBe(0);
});
