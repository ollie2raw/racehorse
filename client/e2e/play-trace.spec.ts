/**
 * Play trace: plays a real Play vs Fritz (Rookie) match and records a timestamped log of every UI
 * state that matters to how the game FEELS (tap-to-response latency, how long Fritz makes the
 * player wait, draw duration, how many legal drop zones a placement has), then prints the
 * analysed report. The "before" / "after" for the draw and tile-play programme
 * (docs/draw-and-play-diagnosis.md).
 *
 * Measurement tool, not a gate: it needs a real bot match and is timing-sensitive, so it is
 * skipped unless PLAY_TRACE is set.
 *
 *   PLAY_TRACE=1 npx playwright test e2e/play-trace.spec.ts --project=chromium
 *   PLAY_TRACE=1 PLAY_TRACE_OUT=/tmp/trace.json ...   # also keep the raw log
 *   PLAY_TRACE_PLAYS=40 PLAY_TRACE_SECONDS=170         # tune the sample size
 *
 * Grep the output for `TRACE|`. The analysis itself lives in src/devtools/playTraceAnalysis.ts
 * (pure, unit-tested).
 */
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { analyzePlayTrace, formatPlayTraceReport, type TraceEvent } from '../src/devtools/playTraceAnalysis';

test.skip(!process.env.PLAY_TRACE, 'measurement tool; set PLAY_TRACE=1');

const TARGET_PLAYS = Number(process.env.PLAY_TRACE_PLAYS ?? 30);
const SECONDS = Number(process.env.PLAY_TRACE_SECONDS ?? 150);

type Marker = (name: string) => Promise<void>;

async function startRookieMatch(page: Page) {
  await page.goto('/');
  await page.getByText('Single Player', { exact: false }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  const start = page.getByText('Start Match', { exact: false }).first();
  await expect(start).toBeEnabled({ timeout: 15_000 });
  await start.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
}

async function completePreGameDraw(page: Page, mark: Marker) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock)').first();
  for (let i = 0; i < 20; i += 1) {
    if (await hand.isVisible().catch(() => false)) return;
    if (await pickable.isVisible().catch(() => false)) {
      await mark('tap-pregame-pick');
      await pickable.click({ timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
}

test('play trace', async ({ page }) => {
  test.setTimeout((SECONDS + 120) * 1000);

  // Log every change of the UI state that matters, once per animation frame, in the page itself so the
  // timestamps are not skewed by Playwright round-trips.
  await page.addInitScript(() => {
    const w = window as unknown as { __log: Array<[number, string, unknown]>; __mark: (s: string) => void };
    w.__log = [];
    w.__mark = (s: string) => w.__log.push([performance.now(), `MARK:${s}`, null]);
    const last: Record<string, unknown> = {};
    const count = (sel: string) => document.querySelectorAll(sel).length;
    const tick = () => {
      const snap: Record<string, unknown> = {
        board: count('.board-tile-wrapper'),
        hand: count('.hand-area .domino-tile:not(.board-tile)'),
        playable: count('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)'),
        zones: count('.placement-zone.active'),
        flying: count('.flying-tile-overlay'),
        boneyardOpen: count('.boneyard-pill:not(.locked)'),
        pregame: count('.pre-game-draw-board__tile-slot'),
        turn: (document.querySelector('.wl-turn-label') as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').trim() ?? '',
        handOver: count('[data-testid="hand-over-modal"]'),
      };
      for (const [key, value] of Object.entries(snap)) {
        if (last[key] !== value) {
          w.__log.push([performance.now(), key, value]);
          last[key] = value;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const mark: Marker = (name) =>
    page.evaluate((n) => (window as unknown as { __mark: (s: string) => void }).__mark(n), name);

  await startRookieMatch(page);
  await completePreGameDraw(page, mark);
  await expect(page.locator('.board-container')).toBeVisible({ timeout: 15_000 });

  const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('.boneyard-pill:not(.locked)').first();
  const handOver = page.getByTestId('hand-over-modal');
  const turnLabel = page.locator('.wl-turn-label').first();

  const deadline = Date.now() + SECONDS * 1000;
  let plays = 0;
  while (Date.now() < deadline && plays < TARGET_PLAYS) {
    if (await handOver.isVisible().catch(() => false)) break;
    if (await playable.isVisible().catch(() => false)) {
      await mark('tap-tile');
      await playable.click({ force: true, timeout: 4000 }).catch(() => {});
      if (await zone.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mark('tap-zone');
        await zone.click({ force: true, timeout: 4000 }).catch(() => {});
        plays += 1;
      }
    } else if (
      (await boneyard.isVisible().catch(() => false)) &&
      !/fritz|opponent/i.test(await turnLabel.innerText().catch(() => ''))
    ) {
      await mark('tap-draw');
      await boneyard.click({ force: true, timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(700); // one tap per draw; do not spam while a draw is in flight
    }
    await page.waitForTimeout(100);
  }

  const log = (await page.evaluate(() => (window as unknown as { __log: unknown[] }).__log)) as TraceEvent[];
  if (process.env.PLAY_TRACE_OUT) writeFileSync(process.env.PLAY_TRACE_OUT, JSON.stringify({ plays, log }));
  for (const line of formatPlayTraceReport(analyzePlayTrace(log))) console.log(`TRACE|${line}`);
  expect(plays, 'the driver should have played some tiles').toBeGreaterThan(2);
});
