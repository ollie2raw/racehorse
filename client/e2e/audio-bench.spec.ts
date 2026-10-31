import { expect, test } from '@playwright/test';

/**
 * Renders every game sound offline through the real mix bus (src/devtools/soundBench.ts) and measures it.
 * Sound can't be judged from code, so these numbers are the guard rails: nothing clips, nothing is inaudible,
 * nothing has a DC offset, every sound has a sensible length and the stereo pan lands on the right side.
 *
 * Run with AUDIO_BENCH=1 to print the full table.
 */

interface Metrics {
  name: string;
  peakDb: number;
  momentaryDb: number;
  activeMs: number;
  dc: number;
  centroidHz: number;
  balance: number;
  hitMs: number;
}

async function bench(page: import('@playwright/test').Page): Promise<Metrics[]> {
  await page.goto('/');
  // A string, not a callback: the test runner would compile a dynamic import() in a callback into require().
  return page.evaluate(
    '(async () => { const m = await import("/src/devtools/soundBench.ts"); return m.renderSoundBench(); })()',
  ) as Promise<Metrics[]>;
}

test('every sound renders cleanly through the mix bus', async ({ page }) => {
  test.setTimeout(120_000);
  const results = await bench(page);

  if (process.env.AUDIO_BENCH) {
    const rows = results.map(
      (m) =>
        `${m.name.padEnd(20)} peak ${m.peakDb.toFixed(1).padStart(6)}  loud ${m.momentaryDb.toFixed(1).padStart(6)}  ` +
        `${m.activeMs.toFixed(0).padStart(5)} ms  dc ${m.dc.toFixed(4).padStart(7)}  ${m.centroidHz.toFixed(0).padStart(5)} Hz  bal ${m.balance.toFixed(2)}  hit ${m.hitMs.toFixed(0).padStart(4)} ms`,
    );
    console.log(`\nSOUND BENCH\n${rows.join('\n')}\n`);
  }

  for (const m of results) {
    expect(m.peakDb, `${m.name} must not clip`).toBeLessThan(-0.5);
    expect(m.peakDb, `${m.name} must be audible`).toBeGreaterThan(-30);
    expect(Math.abs(m.dc), `${m.name} has a DC offset`).toBeLessThan(0.005);
    expect(m.activeMs, `${m.name} should have a sound`).toBeGreaterThan(5);
    expect(m.activeMs, `${m.name} rings too long`).toBeLessThan(2500);
  }
});

test('the mix has a hierarchy: the clack leads, pings sit behind it, endings are the biggest moments', async ({ page }) => {
  test.setTimeout(120_000);
  const results = await bench(page);
  const loud = (name: string) => results.find((m) => m.name === name)!.momentaryDb;
  const clack = loud('tile.standard');

  // The clack is the game's main sound: not buried (it was 10 dB UNDER the score chime), not blasting either.
  expect(clack).toBeGreaterThan(-22);
  expect(clack).toBeLessThan(-16.5);
  // Fritz's tile is a little lighter than yours, but clearly there.
  expect(loud('tile.deal')).toBeLessThan(clack - 1);
  expect(loud('tile.deal')).toBeGreaterThan(clack - 6);
  // A score ping sits behind the clack, and a bigger score is a bigger sound.
  expect(loud('score.10')).toBeLessThan(clack + 1.5);
  expect(loud('score.10')).toBeGreaterThan(clack - 6);
  expect(loud('score.15')).toBeGreaterThanOrEqual(loud('score.5'));
  // A draw is quiet but audible (it was 16 dB under the clack and effectively silent).
  expect(loud('draw')).toBeGreaterThan(clack - 12);
  expect(loud('draw')).toBeLessThan(clack - 3);
  // Endings are the biggest moments in the match.
  expect(loud('matchWin')).toBeGreaterThan(clack + 2);
  expect(loud('handWin')).toBeGreaterThan(loud('handLose'));
  expect(loud('matchWin')).toBeGreaterThan(loud('matchLose'));
});

test('a tile sound hits the moment it plays, with no swell before it', async ({ page }) => {
  test.setTimeout(120_000);
  const results = await bench(page);
  // The tile sample used to carry ~100 ms of slow swell, its loudest moment ~120 ms in: the hit arrived a tenth of a
  // second AFTER the tile touched and read as an echo leading into it. Now it starts at its real onset.
  for (const m of results.filter((r) => r.name.startsWith('tile.'))) {
    expect(m.hitMs, `${m.name} should hit immediately, not after a swell`).toBeLessThan(30);
  }
});

test('a tile is as loud wherever it lands (constant-power pan)', async ({ page }) => {
  test.setTimeout(120_000);
  const results = await bench(page);
  const loud = (name: string) => results.find((m) => m.name === name)!.momentaryDb;
  // The bench freezes the per-hit variation, so any gap is the pan law. Without the compensation it was 3 dB.
  expect(Math.abs(loud('tile.standard@left') - loud('tile.standard'))).toBeLessThan(1.5);
  expect(Math.abs(loud('tile.standard@right') - loud('tile.standard'))).toBeLessThan(1.5);
});

test('a tile sound is heard from the side it lands on', async ({ page }) => {
  test.setTimeout(120_000);
  const results = await bench(page);
  const at = (name: string) => results.find((m) => m.name === name)!;
  expect(at('tile.standard@left').balance).toBeLessThan(-0.2);
  expect(at('tile.standard@right').balance).toBeGreaterThan(0.2);
  expect(Math.abs(at('tile.standard').balance)).toBeLessThan(0.05);
});
