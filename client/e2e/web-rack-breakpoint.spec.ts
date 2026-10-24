/**
 * Rack sizing across the 840-1024px WEB breakpoint region, against the REAL Play vs Fritz screen.
 *
 * Regression for the 920-960px defect: a normal 7-tile hand rendered 126x64 tiles (954px of rack in an 820px tray, tile 0 at
 * x=-15 at 932px) while the same hand at 900px was 90x46. The tile size must (a) always fit the tray and (b) change smoothly
 * with width. Native parity is asserted here too: the installed app's tile sizes must not move.
 */
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [840, 880, 900, 920, 932, 944, 960, 980, 1024];

async function start(page: Page, w: number, h: number, deal: 7 | 14, native: boolean) {
  if (native) {
    await page.addInitScript(() => {
      const add = () => document.documentElement?.classList.add('rh-native');
      add();
      new MutationObserver(add).observe(document, { childList: true, attributes: true, attributeFilter: ['class'] });
    });
  }
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/');
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  await page.locator('.pvf-deal-card', { hasText: deal === 14 ? '14 Tiles' : '7 Tiles' }).click();
  await page.getByText('Start Match', { exact: false }).first().click();
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  for (let i = 0; i < 24 && (await page.locator('.hand-row .domino-tile').count()) === 0; i += 1) {
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1500);
}

type RackMeasure = { n: number; rows: number; left: number; right: number; center: number; tileW: number; tileH: number; vw: number; scrollW: number };
const measure = (page: Page): Promise<RackMeasure> => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.hand-row .domino-tile')].map((e) => e.getBoundingClientRect());
  if (tiles.length === 0) return { n: 0, rows: 0, left: 0, right: 0, center: 0, tileW: 0, tileH: 0, vw: innerWidth, scrollW: document.documentElement.scrollWidth };
  const left = Math.min(...tiles.map((r) => r.left)); const right = Math.max(...tiles.map((r) => r.right));
  return {
    n: tiles.length, rows: document.querySelectorAll('.hand-container .hand-row').length, left, right, center: (left + right) / 2,
    tileW: tiles[0]!.width, tileH: tiles[0]!.height, vw: innerWidth, scrollW: document.documentElement.scrollWidth,
  };
});

function assertFits(m: RackMeasure, where: string) {
  expect(m.left, `${where}: rack starts at x=${m.left.toFixed(0)}`).toBeGreaterThanOrEqual(0);
  expect(m.right, `${where}: rack ends at x=${m.right.toFixed(0)} of ${m.vw}`).toBeLessThanOrEqual(m.vw);
  expect(m.scrollW, `${where}: horizontal page overflow`).toBeLessThanOrEqual(m.vw);
  expect(Math.abs(m.center - m.vw / 2), `${where}: rack centre ${m.center.toFixed(0)} vs viewport centre ${m.vw / 2}`).toBeLessThanOrEqual(10);
}

for (const deal of [7, 14] as const) {
  test(`web width sweep, ${deal}-tile hand: always inside the viewport, centred, and no size jump between samples`, async ({ page }) => {
    test.setTimeout(420_000);
    const rows: Array<[number, RackMeasure]> = [];
    for (const w of WIDTHS) {
      // a 7-tile deal can open with extra tiles (the pre-game draw); the sweep compares like with like, so deal again until it is exact
      let m: RackMeasure;
      for (let attempt = 0; ; attempt += 1) {
        await start(page, w, 430, deal, false);
        m = await measure(page);
        if (m.n === deal || attempt >= 5) break;
      }
      expect(m.n, `${w}px: tiles rendered`).toBe(deal);
      assertFits(m, `${deal} tiles at ${w}x430`);
      rows.push([w, m]);
    }
    console.log(`SWEEP ${deal}-tile\n${rows.map(([w, m]) => `  ${w}: ${m.tileW.toFixed(0)}x${m.tileH.toFixed(0)} rows=${m.rows} rack ${m.left.toFixed(0)}..${m.right.toFixed(0)} centre ${m.center.toFixed(0)} scrollW=${m.scrollW}`).join('\n')}`);
    // a tile's width may follow the width (ramp ~0.36px/px, tray fit ~0.1px/px) but may never jump:
    // the old rule went 90 -> 126px between 900 and 932 (36px over 32px). 844 is where CSS zoom .82 stops, so the 840 -> 880 pair
    // legitimately steps by the zoom; it is allowed the same slope plus that known step.
    for (let i = 1; i < rows.length; i += 1) {
      const [w0, a] = rows[i - 1]!; const [w1, b] = rows[i]!;
      const allowed = 0.36 * (w1 - w0) + 4 + (w0 < 844 && w1 >= 844 ? 12 : 0);
      expect(Math.abs(b.tileW - a.tileW), `${deal} tiles: tile width ${a.tileW.toFixed(0)} @${w0} -> ${b.tileW.toFixed(0)} @${w1}`).toBeLessThanOrEqual(allowed);
      expect(b.rows, `${deal} tiles: row count at ${w1}`).toBe(a.rows);
    }
  });
}

test('web 932x430 and 932x500: a fresh 7-tile hand is fully visible (was the known defect: tile 0 at x=-15)', async ({ page }) => {
  test.setTimeout(180_000);
  for (const h of [430, 500]) {
    await start(page, 932, h, 7, false);
    const m = await measure(page);
    assertFits(m, `932x${h}`);
    expect(m.tileW, `932x${h}: comfortable tile size`).toBeGreaterThanOrEqual(96);
    expect(m.tileW, `932x${h}: no longer the 126px that overflowed`).toBeLessThan(120);
  }
});

test.describe('native parity: the installed app tile sizes do not move', () => {
  // (half-width) 42 up to 900px; 60 / 46 at 932px for 7 / 14 tiles; rendered x zoom 0.82
  const CASES: Array<[number, number, 7 | 14, number]> = [
    [844, 390, 7, 73.8], [844, 390, 14, 73.8], [874, 402, 7, 73.8], [874, 402, 14, 73.8], [932, 430, 7, 102], [932, 430, 14, 80.4],
  ];
  for (const [w, h, deal, expected] of CASES) {
    test(`native ${w}x${h}, ${deal} tiles: tile width ~${expected}`, async ({ page }) => {
      test.setTimeout(120_000);
      await start(page, w, h, deal, true);
      const m = await measure(page);
      expect(m.tileW, `${deal} tiles at ${w}x${h}`).toBeGreaterThan(expected - 3);
      expect(m.tileW, `${deal} tiles at ${w}x${h}`).toBeLessThan(expected + 3);
      expect(m.rows, 'row count').toBe(deal === 14 ? 2 : 1);
      assertFits(m, `native ${deal} tiles at ${w}x${h}`);
    });
  }
});

test.describe('hand sizes 14 -> 6 played down at 932x430 (7-tile, 8-tile and 10-tile racks all fit)', () => {
  for (const native of [false, true]) {
    test(`${native ? 'native' : 'web'}: every hand size laid out inside the viewport`, async ({ page }) => {
      test.setTimeout(480_000);
      await start(page, 932, 430, 14, native);
      const seen = new Set<number>();
      const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled)').first();
      const zone = page.locator('.placement-zone.active').first();
      const deadline = Date.now() + 400_000;
      while (Date.now() < deadline && !(seen.has(8) && seen.has(7) && seen.has(10))) {
        const n = await page.locator('.hand-row .domino-tile').count();
        if (n > 0 && !seen.has(n)) {
          await page.mouse.move(1, 1);
          await page.waitForTimeout(500);
          const m = await measure(page);
          assertFits(m, `${native ? 'native' : 'web'} ${m.n}-tile hand at 932x430`);
          seen.add(m.n);
        }
        if ((await playable.count()) > 0) {
          await playable.click({ force: true, timeout: 4000 }).catch(() => {});
          if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) await zone.click({ force: true, timeout: 4000 }).catch(() => {});
        }
        await page.waitForTimeout(1000);
      }
      console.log(`${native ? 'NATIVE' : 'WEB'} hand sizes laid out: ${[...seen].sort((a, b) => b - a).join(',')}`);
      for (const n of [14, 10, 8, 7]) expect([...seen], `hand size ${n} was exercised`).toContain(n);
    });
  }
});
