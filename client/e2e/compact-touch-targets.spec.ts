/**
 * Touch targets and rack interaction on compact iPhone landscape (native layout), against the REAL Play vs Fritz screen.
 *
 * The installed app lays the match out with `html.rh-native` (native-landscape.css); that is emulated here with representative
 * safe-area insets. Hit areas are MEASURED, not read from CSS: for every interactive element a pixel sweep of
 * `document.elementFromPoint` finds the rectangle that actually belongs to it (including transparent ::before/::after slop).
 *
 * Rules: every interactive control has an effective hit rectangle of >= 44x44pt; hit rectangles never overlap another control's;
 * they stay inside the safe area; the OPEN chip (informational) is never inside the boneyard's tap area.
 */
import { expect, test, type Page } from '@playwright/test';
import { compactSingleRowLimit } from '../src/match/compactLandscape';

type Insets = { left: number; right: number; bottom: number };
type Case = { w: number; h: number; insets: Insets };
const NONE: Insets = { left: 0, right: 0, bottom: 0 };
const CASES: Case[] = [
  { w: 667, h: 375, insets: NONE }, { w: 740, h: 360, insets: NONE },
  { w: 812, h: 375, insets: { left: 47, right: 47, bottom: 21 } },
  { w: 844, h: 390, insets: { left: 47, right: 47, bottom: 21 } },
  { w: 932, h: 430, insets: { left: 59, right: 59, bottom: 21 } },
];
const MIN_TARGET = 43; // 44pt, minus 1px of sweep rounding

async function start(page: Page, c: Case, deal: 7 | 14, freezeMotion = true, native = true) {
  if (native) await page.addInitScript(() => {
    const add = () => { const el = document.documentElement; if (el && !el.classList.contains('rh-native')) el.classList.add('rh-native'); };
    add();
    new MutationObserver(add).observe(document, { childList: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('DOMContentLoaded', add);
  });
  await page.setViewportSize({ width: c.w, height: c.h });
  await page.goto('/');
  if (c.insets.left || c.insets.right || c.insets.bottom) {
    await page.addStyleTag({ content: `:root{--rh-safe-left:${c.insets.left}px;--rh-safe-right:${c.insets.right}px;--rh-safe-bottom:${c.insets.bottom}px}` });
  }
  // Targets are measured at rest: the game-feel hover/hint lift (translateY(-6px) scale(1.03)) is transient and deliberately
  // pushes a tile's hit box over its neighbour for a moment.
  if (freezeMotion) await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  await page.locator('.pvf-deal-card', { hasText: deal === 14 ? '14 Tiles' : '7 Tiles' }).click();
  const go = page.getByText('Start Match', { exact: false }).first();
  await expect(go).toBeEnabled({ timeout: 15_000 });
  await go.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
  // Touch has no hover: park the pointer so the Start Match click position does not leave a tile in its :hover lift.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(2500);
}

type Rect = { l: number; t: number; r: number; b: number; w: number; h: number };
type Target = { kind: string; label: string; visual: Rect; hit: Rect | null };

/** Effective hit rectangles of every interactive element, from a 1px elementFromPoint sweep around it. */
const sweep = (page: Page) => page.evaluate(() => {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const kinds: Array<[string, string]> = [
    ['tile', '.hand-row .domino-tile'], ['card', '.wl-player-pill-btn'], ['boneyard', '.boneyard-pill'],
    ['control', '.rh-board-control-btn'], ['zone', '.placement-zone'], ['scrubber', '.rh-scrubber button'],
  ];
  const rect = (l: number, t: number, r: number, b: number) => ({ l, t, r, b, w: r - l, h: b - t });
  const targets: Array<{ kind: string; label: string; visual: ReturnType<typeof rect>; hit: ReturnType<typeof rect> | null }> = [];
  for (const [kind, selector] of kinds) {
    for (const el of document.querySelectorAll(selector)) {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (b.width < 2 || b.height < 2 || cs.visibility === 'hidden' || cs.display === 'none' || cs.pointerEvents === 'none') continue;
      if (b.right < 0 || b.left > vw || b.bottom < 0 || b.top > vh) continue;
      const x0 = Math.max(0, Math.floor(b.left - 40)); const x1 = Math.min(vw - 1, Math.ceil(b.right + 40));
      const y0 = Math.max(0, Math.floor(b.top - 40)); const y1 = Math.min(vh - 1, Math.ceil(b.bottom + 40));
      let minX = 1e9; let maxX = -1; let minY = 1e9; let maxY = -1;
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
      targets.push({
        kind, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24),
        visual: rect(b.left, b.top, b.right, b.bottom), hit: maxX < 0 ? null : rect(minX, minY, maxX + 1, maxY + 1),
      });
    }
  }
  const open = document.querySelector('.open-ends-pill')?.getBoundingClientRect();
  return { targets, open: open ? rect(open.left, open.top, open.right, open.bottom) : null, vw, vh };
});

function assertTargets(s: Awaited<ReturnType<typeof sweep>>, c: Case, where: string) {
  const L = c.insets.left; const R = s.vw - c.insets.right; const B = s.vh - c.insets.bottom;
  expect(s.targets.length, `${where}: no interactive targets found`).toBeGreaterThan(5);
  for (const t of s.targets) {
    const name = `${where}: ${t.kind} "${t.label}"`;
    expect(t.hit, `${name} has no hit area`).toBeTruthy();
    const h = t.hit!;
    expect(h.w, `${name} effective width ${Math.round(h.w)}pt < 44`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(h.h, `${name} effective height ${Math.round(h.h)}pt < 44 (visual ${JSON.stringify(t.visual)} hit ${JSON.stringify(h)})`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(h.l, `${name} hit area crosses the left safe edge`).toBeGreaterThanOrEqual(L - 1);
    expect(h.r, `${name} hit area crosses the right safe edge`).toBeLessThanOrEqual(R + 1);
    expect(h.t, `${name} hit area is above the screen`).toBeGreaterThanOrEqual(0);
    if (t.kind === 'tile' || t.kind === 'control') expect(h.b, `${name} hit area crosses the bottom safe edge`).toBeLessThanOrEqual(B + 1);
  }
  // no two different controls share ambiguous territory
  for (let i = 0; i < s.targets.length; i += 1) for (let j = i + 1; j < s.targets.length; j += 1) {
    const a = s.targets[i]!.hit!; const b = s.targets[j]!.hit!;
    const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l); const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    expect(ox > 1 && oy > 1, `${where}: ${s.targets[i]!.kind} "${s.targets[i]!.label}" overlaps ${s.targets[j]!.kind} "${s.targets[j]!.label}" (${Math.round(ox)}x${Math.round(oy)}) visuals ${JSON.stringify([s.targets[i]!.visual, s.targets[j]!.visual].map((v) => [v.l, v.t, v.r, v.b].map(Math.round)))}`).toBe(false);
  }
  // the informational OPEN chip is never inside the boneyard's tap area
  const bone = s.targets.find((t) => t.kind === 'boneyard');
  if (bone && s.open && bone.hit) {
    const ox = Math.min(bone.hit.r, s.open.r) - Math.max(bone.hit.l, s.open.l); const oy = Math.min(bone.hit.b, s.open.b) - Math.max(bone.hit.t, s.open.t);
    expect(ox > 1 && oy > 1, `${where}: the OPEN chip is inside the boneyard tap area`).toBe(false);
  }
  // control buttons are on a >= 44pt pitch (centre to centre) so the hit areas meet instead of overlapping
  const controls = s.targets.filter((t) => t.kind === 'control');
  for (let i = 0; i < controls.length; i += 1) for (let j = i + 1; j < controls.length; j += 1) {
    const a = controls[i]!.visual; const b = controls[j]!.visual;
    const pitch = Math.hypot((a.l + a.r) / 2 - (b.l + b.r) / 2, (a.t + a.b) / 2 - (b.t + b.b) / 2);
    expect(pitch, `${where}: "${controls[i]!.label}" and "${controls[j]!.label}" are ${Math.round(pitch)}pt apart`).toBeGreaterThanOrEqual(MIN_TARGET);
  }
}

const tileCount = (page: Page) => page.locator('.hand-row .domino-tile').count();
const rowCount = (page: Page) => page.locator('.hand-container .hand-row').count();

/** What the app should do with n tiles at this width: the width-aware limit below 844px, the fixed 8 above. */
function expectedRows(n: number, w: number): number {
  const limit = compactSingleRowLimit(w, true) ?? 8;
  return n > limit ? 2 : 1;
}

async function assertRack(page: Page, c: Case, where: string) {
  const n = await tileCount(page);
  expect(await rowCount(page), `${where}: ${n} tiles in the wrong number of rows`).toBe(expectedRows(n, c.w));
  const countTappable = () => page.evaluate(() => [...document.querySelectorAll('.hand-row .domino-tile')].filter((e) => getComputedStyle(e).pointerEvents !== 'none').length);
  const tappableBefore = await countTappable();
  const s = await sweep(page);
  const tappableAfter = await countTappable();
  assertTargets(s, c, where);
  // every tile fully on screen, inside the safe area, below the board
  const tiles = s.targets.filter((t) => t.kind === 'tile');
  // unplayable tiles are `pointer-events: none` (not targets), so only tiles that accept pointers are measured
  // (the turn can flip between the two counts, so accept either)
  expect([tappableBefore, tappableAfter], `${where}: ${n} tiles, ${tiles.length} measured`).toContain(tiles.length);
  for (const t of tiles) {
    expect(t.visual.l, `${where}: tile "${t.label}" crosses the left edge`).toBeGreaterThanOrEqual(c.insets.left - 1);
    expect(t.visual.r, `${where}: tile "${t.label}" crosses the right edge`).toBeLessThanOrEqual(s.vw - c.insets.right + 1);
    expect(t.visual.b, `${where}: tile "${t.label}" is below the bottom safe edge (${Math.round(t.visual.b)} > ${s.vh - c.insets.bottom})`).toBeLessThanOrEqual(s.vh - c.insets.bottom + 1);
  }
  const boardBottom = await page.evaluate(() => document.querySelector('.board-container')?.getBoundingClientRect().bottom ?? 0);
  const boardH = await page.evaluate(() => document.querySelector('.board-container')?.getBoundingClientRect().height ?? 0);
  expect(boardH, `${where}: board is only ${Math.round(boardH)}px tall`).toBeGreaterThanOrEqual(150);
  for (const t of tiles) expect(t.visual.t, `${where}: tile "${t.label}" overlaps the board`).toBeGreaterThanOrEqual(boardBottom - 1);
}

for (const c of CASES) {
  test.describe(`${c.w}x${c.h}`, () => {
    test('every interactive control has a >= 44pt effective hit area, inside the safe area, with no ambiguous overlap', async ({ page }) => {
      test.setTimeout(180_000);
      await start(page, c, 14);
      assertTargets(await sweep(page), c, 'idle (14-tile hand)');
      // select a tile: placement zones appear and are targets too
      await page.locator('.hand-area .domino-tile.highlight:not(.disabled)').first().click({ force: true });
      await page.waitForTimeout(600);
      const selected = await sweep(page);
      expect(selected.targets.some((t) => t.kind === 'zone'), 'a placement zone is shown for the selected tile').toBe(true);
      assertTargets(selected, c, 'tile selected');
    });

    test('pointers near the edges of neighbouring targets activate the intended control, never the neighbour', async ({ page }) => {
      test.setTimeout(180_000);
      await start(page, c, 14);
      const s = await sweep(page);
      const tiles = s.targets.filter((t) => t.kind === 'tile').sort((a, b) => a.visual.t - b.visual.t || a.visual.l - b.visual.l);
      // 1. adjacent rack tiles in the first row: points just inside each tile's hit area (edges and corners) belong to that tile
      const row = tiles.filter((t) => Math.abs(t.visual.t - tiles[0]!.visual.t) < 3);
      expect(tiles.length, 'a fresh 14-tile deal has at least two playable tiles').toBeGreaterThanOrEqual(2);
      const owner = (x: number, y: number) => page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px!, py!); const tile = el?.closest('.hand-row .domino-tile');
        return tile?.getAttribute('aria-label') ?? el?.closest('button')?.getAttribute('aria-label') ?? (el ? el.tagName : null);
      }, [x, y]);
      for (const t of row) {
        const h = t.hit!;
        for (const [x, y] of [[h.l + 1, h.t + 1], [h.r - 2, h.t + 1], [h.l + 1, h.b - 2], [h.r - 2, h.b - 2], [(h.l + h.r) / 2, h.t + 1], [(h.l + h.r) / 2, h.b - 2]] as const) {
          expect(await owner(x, y), `point (${Math.round(x)},${Math.round(y)}) near the edge of ${t.label}`).toBe(t.label);
        }
      }
      // 2. rows: the last pixel row of row 1's area and the first of row 2's belong to different tiles in the right order
      const rows = [...new Set(tiles.map((t) => Math.round(t.visual.t)))];
      if (rows.length === 2) {
        const upper = tiles.filter((t) => Math.round(t.visual.t) === rows[0]); const lower = tiles.filter((t) => Math.round(t.visual.t) === rows[1]);
        const u = upper[0]!; const lw = lower.find((t) => t.visual.l < u.visual.r && t.visual.r > u.visual.l) ?? lower[0]!;
        expect(await owner((u.hit!.l + u.hit!.r) / 2, u.hit!.b - 2), 'bottom edge of the upper row').toBe(u.label);
        expect(await owner((lw.hit!.l + lw.hit!.r) / 2, lw.hit!.t + 1), 'top edge of the lower row').toBe(lw.label);
      }
      // 3. rapid selection of neighbours: only the last tapped tile is selected, no neighbour is activated
      // prefer two playable tiles in the same row; fall back to any two
      const a = row.length >= 2 ? row[0]! : tiles[0]!; const b = row.length >= 2 ? row[1]! : tiles[1]!;
      for (let i = 0; i < 6; i += 1) {
        const target = i % 2 === 0 ? a : b;
        await page.mouse.click(target.hit!.r - 3, target.hit!.t + 2); // the corner of the target nearest the neighbour, in the slop
      }
      const pressed = await page.locator('.hand-row .domino-tile[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      expect(pressed.length, `exactly one selected tile after rapid taps, got ${JSON.stringify(pressed)}`).toBeLessThanOrEqual(1);
      if (pressed.length === 1) expect([a.label, b.label]).toContain(pressed[0]);

      // 4. board controls: the point on each side of the boundary between two buttons belongs to its own button
      const controls = s.targets.filter((t) => t.kind === 'control').sort((p, q) => p.visual.l - q.visual.l || p.visual.t - q.visual.t);
      for (let i = 0; i + 1 < controls.length; i += 1) {
        const p = controls[i]!; const q = controls[i + 1]!;
        const horizontal = Math.abs(p.visual.t - q.visual.t) < 3;
        const mid = horizontal ? [(p.hit!.r + q.hit!.l) / 2, (p.visual.t + p.visual.b) / 2] : [(p.visual.l + p.visual.r) / 2, (p.hit!.b + q.hit!.t) / 2];
        const before = horizontal ? [mid[0]! - 2, mid[1]!] : [mid[0]!, mid[1]! - 2];
        const after = horizontal ? [mid[0]! + 1, mid[1]!] : [mid[0]!, mid[1]! + 1];
        expect(await owner(before[0]!, before[1]!), `just inside ${p.label}'s area`).toBe(p.label);
        expect(await owner(after[0]!, after[1]!), `just inside ${q.label}'s area`).toBe(q.label);
      }
    });
  });
}

test.describe('real rack flow at 667x375: a 14-tile hand played down, then the next deal', () => {
  test('every count from 14 downward lays out correctly (row split, hit areas, safe area, board) and the new hand resets', async ({ page }) => {
    test.setTimeout(660_000);
    const c = CASES[0]!;
    await start(page, c, 14);
    const seen = new Map<number, true>();
    let previous = await tileCount(page);
    let newHandSeen = false;
    let scrubberChecked = false;
    const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled)').first();
    const zone = page.locator('.placement-zone.active').first();
    const deadline = Date.now() + 600_000;
    const allSeen = () => [14, 13, 12, 11, 10, 9, 8, 7].every((k) => seen.has(k));
    // a hand can end (Fritz out first) before the player reaches 7 tiles: keep playing into the next hands until every count was seen
    while (Date.now() < deadline && !(newHandSeen && allSeen())) {
      const n = await tileCount(page);
      if (n > 0 && !seen.has(n)) {
        await page.mouse.move(1, 1); await page.waitForTimeout(900); // let the draw/play animation settle
        await assertRack(page, c, `${n}-tile hand`); seen.set(n, true); console.log(`RACK laid out ${n} tiles at ${Math.round((Date.now() - (deadline - 600_000)) / 1000)}s`);
        // the move-history scrubber: step back one move (shows the LIVE chip), check its targets, return to live
        const back = page.getByRole('button', { name: 'Previous move' });
        if (!scrubberChecked && (await back.isEnabled({ timeout: 500 }).catch(() => false))) {
          await back.click({ timeout: 4000 }).catch(() => {});
          await page.mouse.move(1, 1);
          await page.waitForTimeout(500);
          const viewing = await sweep(page);
          expect(viewing.targets.some((t) => t.kind === 'scrubber' && /live/i.test(t.label)), 'the LIVE chip shows while viewing a past move').toBe(true);
          assertTargets(viewing, c, `${n}-tile hand, viewing a past move`);
          scrubberChecked = true;
          await page.locator('.rh-scrubber-live').click({ timeout: 4000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
      if (n > previous + 4) {
        newHandSeen = true;
        await page.mouse.move(1, 1); await page.waitForTimeout(900);
        await assertRack(page, c, `new hand (${n} tiles)`);
      }
      previous = n;
      if (await page.getByTestId('hand-over-modal').isVisible().catch(() => false)) { await page.waitForTimeout(1500); continue; }
      if ((await playable.count()) > 0) {
        await playable.click({ force: true, timeout: 4000 }).catch(() => {});
        if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) await zone.click({ force: true, timeout: 4000 }).catch(() => {});
      }
      await page.waitForTimeout(1100);
    }
    const counts = [...seen.keys()].sort((x, y) => y - x);
    console.log(`RACK counts exercised: ${counts.join(',')} newHand=${newHandSeen}`);
    for (const n of [14, 13, 12, 11, 10, 9, 8, 7]) expect(counts, `hand size ${n} was never exercised`).toContain(n);
    expect(newHandSeen, 'the next hand was dealt and laid out again').toBe(true);
  });
});

test.describe('real rack flow at 667x375: a draw grows a 7-tile hand and splits it', () => {
  test('a real draw takes the hand past the single-row limit and the rack re-splits cleanly', async ({ page }) => {
    test.setTimeout(1_200_000);
    const c = CASES[0]!;
    const limit = compactSingleRowLimit(c.w, true)!;
    let observed: number[] = [];
    for (let attempt = 0; attempt < 40 && !observed.some((n) => n > limit); attempt += 1) {
      await start(page, c, 7);
      // the pre-game draw decides who starts; pick tiles until the hand is on screen
      const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
      for (let i = 0; i < 24 && (await tileCount(page)) === 0; i += 1) {
        if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 4000, force: true }).catch(() => {});
        await page.waitForTimeout(700);
      }
      const boneyard = page.locator('.boneyard-pill').first();
      const zone = page.locator('.placement-zone.active').first();
      /** The playable tile whose pips have the fewest matches left in the hand, so the new open end is one we cannot answer (a draw). */
      const pickPlayable = async () => {
        const info = await page.locator('.hand-row .domino-tile').evaluateAll((els) => els.map((e) => ({
          label: e.getAttribute('aria-label') ?? '', playable: e.classList.contains('highlight') && !e.classList.contains('disabled'),
        })));
        const pips = info.map((t) => (t.label.match(/(\d)-(\d)/) ?? []).slice(1, 3).map(Number));
        const friends = (i: number, p: number) => pips.reduce((n, pp, j) => n + (j !== i && pp.includes(p) ? 1 : 0), 0);
        let best = -1; let bestScore = Infinity;
        info.forEach((t, i) => {
          const pp = pips[i]!;
          if (!t.playable || pp.length !== 2) return;
          const score = Math.min(friends(i, pp[0]!), friends(i, pp[1]!));
          if (score < bestScore) { bestScore = score; best = i; }
        });
        return best;
      };
      const size = new Set<number>();
      for (let turn = 0; turn < 14; turn += 1) {
        const n = await tileCount(page);
        if (n > 0 && !size.has(n)) {
          size.add(n);
          if (n > 7) { await assertRack(page, c, `after a draw: ${n} tiles`); observed.push(n); }
        }
        const pick = await pickPlayable();
        if (pick >= 0) {
          await page.locator('.hand-row .domino-tile').nth(pick).click({ force: true, timeout: 4000 }).catch(() => {});
          if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) await zone.click({ force: true, timeout: 4000 }).catch(() => {});
        } else if (await boneyard.isVisible().catch(() => false)) {
          await boneyard.click({ force: true, timeout: 4000 }).catch(() => {});
        }
        await page.waitForTimeout(1200);
        if (observed.some((m) => m > limit)) break;
      }
      if (!observed.some((m) => m > limit)) await page.goto('about:blank');
    }
    console.log(`DRAW hand sizes laid out after draws: ${observed.join(',')} (single-row limit ${limit})`);
    expect(observed.some((n) => n > limit), `a real draw past ${limit} tiles was exercised`).toBe(true);
    observed = [];
  });
});

/** Every visible text node smaller than `minPx`. */
const tinyText = (page: Page, minPx: number) => page.evaluate((min) => {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const text = (n.textContent ?? '').trim();
    const el = n.parentElement;
    if (!text || !el) continue;
    const b = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (b.width < 1 || b.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
    const fs = parseFloat(cs.fontSize);
    if (fs < min) out.push(`${fs.toFixed(2)}px "${text.slice(0, 30)}" .${el.className.toString().slice(0, 40)}`);
  }
  return out;
}, minPx);

test.describe('text size in the native layout', () => {
  // The compact `.wl-turn-label` rule (.72rem x 10.5px root = 7.56px) is reachable only in the WEB build at <=480px-tall
  // landscape; the native shell's `.rh-hud-turn` (12px) wins. Guard that it never reaches a real native match.
  test('real Play vs Fritz at 667x375 has no visible text under 10px', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, CASES[0]!, 14);
    expect(await tinyText(page, 10)).toEqual([]);
  });

  for (const [w, h] of [[667, 375], [844, 390]] as const) {
    test(`multiplayer LiveMatchScreen (routing harness) at ${w}x${h} has no visible text under 10px`, async ({ page }) => {
      await page.addInitScript(() => {
        const add = () => document.documentElement?.classList.add('rh-native');
        add();
        new MutationObserver(add).observe(document, { childList: true, attributes: true, attributeFilter: ['class'] });
      });
      await page.setViewportSize({ width: w, height: h });
      await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
      await page.goto('/e2e/harness/board-routing.html?fixture=longBoth');
      await page.waitForSelector('.board-tile-wrapper');
      await page.waitForTimeout(1500);
      expect(await tinyText(page, 10)).toEqual([]);
    });
  }
});

test.describe('web 932px rack containment (regression: a 7-tile hand ran from x=-15 to x=939)', () => {
  // The web build sized tiles 126x64 at 920-980px wide, so a normal hand overflowed both edges at 932x430 (an iPhone Plus in
  // Safari landscape). Fixed by sizing from the real tray in rackTileSizing.ts; the full width sweep lives in
  // web-rack-breakpoint.spec.ts. This positive assertion stays with the touch-target gate.
  test('web 932x430: every tile of a fresh 7-tile hand is inside the viewport', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, { w: 932, h: 430, insets: NONE }, 7, true, false);
    const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
    for (let i = 0; i < 24 && (await tileCount(page)) === 0; i += 1) {
      if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 3000, force: true }).catch(() => {});
      await page.waitForTimeout(700);
    }
    await page.mouse.move(1, 1);
    const box = await page.evaluate(() => {
      const t = [...document.querySelectorAll('.hand-row .domino-tile')].map((e) => e.getBoundingClientRect());
      return { n: t.length, left: Math.min(...t.map((r) => r.left)), right: Math.max(...t.map((r) => r.right)), vw: innerWidth };
    });
    expect(box.n).toBe(7);
    expect(box.left, `rack starts at x=${Math.round(box.left)}`).toBeGreaterThanOrEqual(0);
    expect(box.right, `rack ends at x=${Math.round(box.right)} of ${box.vw}`).toBeLessThanOrEqual(box.vw);
  });
});
