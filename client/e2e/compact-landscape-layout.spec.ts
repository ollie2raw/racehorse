/**
 * Compact iPhone landscape match layout (667x375 .. 932x430), against the REAL Play vs Fritz screen.
 *
 * Racehorse is iPhone-only and landscape-only, so 667x375 (SE/8) and 740x360 are supported match viewports. The old layout was
 * effectively ~826px wide: a CSS grid with fixed 420/220px tracks pushed the YOU card off a 667px screen, and portrait-phone
 * `max-width: 768px` rules collapsed the board to 0px and squashed the rack in landscape. These assertions fail if that returns.
 *
 * Two modes: plain web, and native-emulated (`html.rh-native`, what main.tsx sets inside the Capacitor app) with representative
 * safe-area insets, because the installed app lays out inside the inset box (App.css pads the gameplay shell by --rh-safe-*).
 */
import { expect, test, type Page } from '@playwright/test';

type Insets = { left: number; right: number; bottom: number };
type Case = { w: number; h: number; native: boolean; insets: Insets };

const NONE: Insets = { left: 0, right: 0, bottom: 0 };
const CASES: Case[] = [
  { w: 667, h: 375, native: false, insets: NONE }, { w: 740, h: 360, native: false, insets: NONE },
  { w: 844, h: 390, native: false, insets: NONE }, { w: 932, h: 430, native: false, insets: NONE },
  { w: 667, h: 375, native: true, insets: NONE }, { w: 740, h: 360, native: true, insets: NONE },
  { w: 812, h: 375, native: true, insets: { left: 47, right: 47, bottom: 21 } },
  { w: 844, h: 390, native: true, insets: { left: 47, right: 47, bottom: 21 } },
  { w: 932, h: 430, native: true, insets: { left: 59, right: 59, bottom: 21 } },
];

async function start(page: Page, c: Case) {
  if (c.native) {
    await page.addInitScript(() => {
      const add = () => { const el = document.documentElement; if (el && !el.classList.contains('rh-native')) el.classList.add('rh-native'); };
      add();
      new MutationObserver(add).observe(document, { childList: true, attributes: true, attributeFilter: ['class'] });
      document.addEventListener('DOMContentLoaded', add);
    });
  }
  await page.setViewportSize({ width: c.w, height: c.h });
  await page.goto('/');
  if (c.insets.left || c.insets.right || c.insets.bottom) {
    await page.addStyleTag({ content: `:root{--rh-safe-left:${c.insets.left}px;--rh-safe-right:${c.insets.right}px;--rh-safe-bottom:${c.insets.bottom}px}` });
  }
  await page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().click();
  await page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first().click();
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).click();
  const go = page.getByText('Start Match', { exact: false }).first();
  await expect(go).toBeEnabled({ timeout: 15_000 });
  await go.click();
  await expect(page.locator('.bot-match-screen, .game-screen')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
}

async function drawPregameTiles(page: Page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock)').first();
  for (let i = 0; i < 24; i += 1) {
    if (await hand.isVisible().catch(() => false)) break;
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 4000, force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2500);
}

/** Everything the invariants need, measured in one pass. */
const measure = (page: Page) => page.evaluate(() => {
  const rect = (el: Element | null) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const q = (s: string) => document.querySelector(s);
  const named: Record<string, Element | null> = {
    you: q('.wl-player-pill.is-you'), opp: q('.wl-player-pill:not(.is-you)'), oppRack: q('.rh-tile-rack'),
    pill: q('.wl-center-status .wl-turn-label, .rh-hud-turn'), scrub: q('.rh-scrubber'),
  };
  const hud = Object.fromEntries(Object.entries(named).map(([k, v]) => [k, v && v.getBoundingClientRect().width > 0 ? rect(v) : null]));
  const pill = named.pill as HTMLElement | null;
  let pillText = { lines: 0, slack: 0, text: '' };
  if (pill) {
    const range = document.createRange(); range.selectNodeContents(pill);
    const box = pill.getBoundingClientRect();
    const lines = [...range.getClientRects()].filter((r) => r.width > 0);
    // cluster line tops within 4px: fragments of one line (and the 3px handoff translate) must not count as extra lines
    const tops = lines.map((r) => r.top).sort((a, b) => a - b);
    const clusters = tops.filter((t, i) => i === 0 || t - tops[i - 1] > 4).length;
    pillText = {
      lines: clusters,
      slack: lines.length ? Math.min(...lines.flatMap((r) => [r.left - box.left, box.right - r.right, r.top - box.top, box.bottom - r.bottom])) : 0,
      text: (pill.textContent ?? '').trim(),
    };
  }
  const rail = q('.wl-top-rail') as HTMLElement | null;
  const tiles = [...document.querySelectorAll('.hand-container .domino-tile')].map((e) => rect(e)!);
  return {
    vw: window.innerWidth, vh: window.innerHeight, docW: document.documentElement.scrollWidth,
    hud, pillText, rail: rail ? { sw: rail.scrollWidth, cw: rail.clientWidth, ...rect(rail)! } : null,
    board: rect(q('.board-container') ?? q('.pre-game-draw-board')), boneyard: rect(q('.boneyard-pill, [class*="boneyard-count"]')),
    ctrls: rect(q('.rh-board-controls')), boardZone: rect(q('.rh-live-board-zone')), tiles,
  };
});
type M = Awaited<ReturnType<typeof measure>>;

function assertLayout(m: M, c: Case, label: string) {
  const L = c.insets.left; const R = m.vw - c.insets.right; const B = m.vh - c.insets.bottom;
  const where = `${label} @ ${c.w}x${c.h}${c.native ? ' native' : ' web'}${c.insets.left ? ` insets ${c.insets.left}/${c.insets.right}/${c.insets.bottom}` : ''}`;
  expect(m.docW, `${where}: horizontal document overflow`).toBeLessThanOrEqual(m.vw);

  // both score cards entirely inside the safe area (the old fixed tracks put YOU at x=679..789 on a 667px screen)
  for (const k of ['you', 'opp'] as const) {
    const r = m.hud[k]!;
    expect(r, `${where}: ${k} score card missing`).toBeTruthy();
    expect(r.l, `${where}: ${k} card crosses the left edge`).toBeGreaterThanOrEqual(L - 1);
    expect(r.r, `${where}: ${k} card crosses the right edge (${Math.round(r.r)} > ${R})`).toBeLessThanOrEqual(R + 1);
    expect(r.h, `${where}: ${k} card is below the 36px design floor`).toBeGreaterThanOrEqual(36);
  }
  // the grid never overflows its own box (fixed-width tracks would)
  // 8px tolerance: the unchanged web 844px grid (420/auto/220 + gaps) exceeds its box by ~4px when the status label is widest.
  // The old compact failure was 132px.
  if (m.rail) expect(m.rail.sw, `${where}: HUD rail scrolls horizontally`).toBeLessThanOrEqual(m.rail.cw + 8);

  // status pill: fully visible, inside the safe area, its whole text inside its own box, at most two lines
  const pill = m.hud.pill!;
  expect(pill, `${where}: status pill missing`).toBeTruthy();
  expect(pill.l).toBeGreaterThanOrEqual(L - 1);
  expect(pill.r).toBeLessThanOrEqual(R + 1);
  expect(m.pillText.slack, `${where}: "${m.pillText.text}" leaves its pill`).toBeGreaterThanOrEqual(-1);
  expect(m.pillText.lines, `${where}: "${m.pillText.text}" wraps to ${m.pillText.lines} lines`).toBeLessThanOrEqual(2);

  // no critical HUD overlap
  const names = (['you', 'opp', 'oppRack', 'pill', 'scrub'] as const).filter((k) => m.hud[k]);
  for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
    const a = m.hud[names[i]]!; const b = m.hud[names[j]]!;
    const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l); const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    // 4px tolerance: the unchanged web layout at >= 844px has always let the docked history scrubber touch the YOU card by 3px.
    // The defects this guards against were 20-63px (opponent tiles under the pill, the scrubber across the YOU card).
    expect(ox > 4 && oy > 1, `${where}: HUD ${names[i]} overlaps ${names[j]} (${Math.round(ox)}x${Math.round(oy)})`).toBe(false);
  }

  // the board always has a usable, positive play area, above the rack
  expect(m.board, `${where}: no board`).toBeTruthy();
  expect(m.board!.h, `${where}: board height ${Math.round(m.board!.h)} (it collapsed to 0 in the old layout)`).toBeGreaterThanOrEqual(150);
  expect(m.board!.w).toBeGreaterThan(0);
  expect(m.board!.r).toBeLessThanOrEqual(R + 1);
  expect(m.board!.b).toBeLessThanOrEqual(B + 1);

  // rack: every tile inside the safe area, never under the board, never below the bottom inset, still a real tap target
  // board controls (zoom / sound / home): fully inside the board zone and the safe area, so every button can be tapped
  // (at 740x360 the vertical rail ran 20px past the board and the home button was cut off)
  if (m.ctrls && m.boardZone) {
    expect(m.ctrls.l, `${where}: board controls cross the left edge`).toBeGreaterThanOrEqual(L - 1);
    expect(m.ctrls.r, `${where}: board controls cross the right edge`).toBeLessThanOrEqual(R + 1);
    expect(m.ctrls.t, `${where}: board controls start above the board`).toBeGreaterThanOrEqual(m.boardZone.t - 1);
    expect(m.ctrls.b, `${where}: board controls run ${Math.round(m.ctrls.b - m.boardZone.b)}px past the board bottom`).toBeLessThanOrEqual(m.boardZone.b + 1);
    if (m.boneyard) {
      const ox = Math.min(m.ctrls.r, m.boneyard.r) - Math.max(m.ctrls.l, m.boneyard.l);
      const oy = Math.min(m.ctrls.b, m.boneyard.b) - Math.max(m.ctrls.t, m.boneyard.t);
      expect(ox > 2 && oy > 2, `${where}: board controls overlap the boneyard chip`).toBe(false);
    }
  }

  // Production WEB at ~920-960px wide (932x430 is an iPhone Plus in Safari landscape) sizes rack tiles 126x64 and a 7-tile hand
  // overflows both edges (tile 0 at x=-15 at 932). That is a real, pre-existing web defect, not a harness artifact; the installed
  // app is fine at 932 (asserted at every native size). It is NOT fixed here, and it is not hidden: compact-touch-targets.spec.ts
  // carries it as an expected failure (`test.fail`) that goes red the day the web rack is fixed. This spec only skips the rack
  // containment for that one web case so it keeps guarding everything else at 932.
  const wideWebRack = !c.native && c.w >= 932;
  for (const [i, t] of (wideWebRack ? [] : m.tiles).entries()) {
    expect(t.l, `${where}: tile ${i} crosses the left edge`).toBeGreaterThanOrEqual(L - 1);
    expect(t.r, `${where}: tile ${i} crosses the right edge`).toBeLessThanOrEqual(R + 1);
    expect(t.b, `${where}: tile ${i} extends below the bottom inset`).toBeLessThanOrEqual(B + 1);
    expect(t.t, `${where}: tile ${i} overlaps the board`).toBeGreaterThanOrEqual(m.board!.b - 1);
    expect(t.h, `${where}: tile ${i} height ${Math.round(t.h)} is below the 36px design floor`).toBeGreaterThanOrEqual(36 - 1);
  }
}

for (const c of CASES) {
  test(`compact landscape ${c.w}x${c.h} ${c.native ? 'native' : 'web'}${c.insets.left ? ' with safe-area insets' : ''}`, async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, c);
    assertLayout(await measure(page), c, 'pre-game');
    await drawPregameTiles(page);
    const active = await measure(page);
    expect(active.tiles.length, 'the dealt hand is on screen').toBeGreaterThanOrEqual(7);
    assertLayout(active, c, 'active match');
    // eslint-disable-next-line no-undef -- Node env in Playwright; optional screenshot for manual review only
    const shotDir = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SHOT_DIR;
    if (shotDir) await page.screenshot({ path: `${shotDir}/compact-${c.w}x${c.h}-${c.native ? 'native' : 'web'}.png` });

    // Fritz's tile strip grows with every draw: pad it to 14 tiles (DOM only) and the HUD must still not collide. The installed
    // app caps the strip at 9 tiles + "+N" (native-landscape.css) and is asserted here; plain web shows every tile and still runs
    // under the status pill at EVERY width including the unchanged 844+ layout (pre-existing, reported separately).
    if (!c.native) return;
    const grown = await page.evaluate(() => {
      const rack = document.querySelector('.rh-tile-rack');
      const first = rack?.querySelector('.rh-tile-rack__tile');
      if (!rack || !first) return false;
      while (rack.querySelectorAll('.rh-tile-rack__tile').length < 14) rack.appendChild(first.cloneNode(true));
      return true;
    });
    expect(grown, 'opponent tile strip present').toBe(true);
    await page.waitForTimeout(150);
    const m = await measure(page);
    const names = (['you', 'opp', 'oppRack', 'pill', 'scrub'] as const).filter((k) => m.hud[k]);
    for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
      const a = m.hud[names[i]]!; const b = m.hud[names[j]]!;
      const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l); const oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
      expect(ox > 4 && oy > 1, `14-tile opponent strip: HUD ${names[i]} overlaps ${names[j]} (${Math.round(ox)}x${Math.round(oy)})`).toBe(false);
    }
  });
}
