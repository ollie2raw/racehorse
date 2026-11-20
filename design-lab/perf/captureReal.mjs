// Capture the REAL app mid-match (Play vs Fritz, Rookie) for fidelity reference: screenshot + sizes + DOM of key parts.
// node captureReal.mjs <base> <out-prefix> [desktop|laptop|phone] [moves]
import fs from 'node:fs';
import { chromium, devices } from '@playwright/test';

const [base = 'http://localhost:5611', out = 'real', profile = 'desktop', moves = '6', variant = 'none'] = process.argv.slice(2);
// Optional variant injection (same mechanism as variantHarness.mjs): proves the lab CSS applies to the REAL markup.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const themeCss = fs.readFileSync(path.join(here, '..', 'themes', 'tiles.css'), 'utf8') + '\n' + fs.readFileSync(path.join(here, '..', 'themes', 'boards.css'), 'utf8');
const attrs = { none: {}, tA: { rhTiles: 'A' }, tB: { rhTiles: 'B' }, tC: { rhTiles: 'C' }, bA: { rhBoard: 'A' }, bB: { rhBoard: 'B' }, bC: { rhBoard: 'C' } }[variant];
const vp = { desktop: { width: 1440, height: 900 }, laptop: { width: 1512, height: 982 } }[profile];
const browser = await chromium.launch();
const ctx = await browser.newContext(profile === 'phone' ? devices['iPhone 14 landscape'] : { viewport: vp });
await ctx.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
if (variant !== 'none') await ctx.addInitScript(({ attrs, css }) => { const apply = () => { for (const [k, v] of Object.entries(attrs)) document.documentElement.dataset[k] = v; const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }; if (document.head) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true }); }, { attrs, css: themeCss });
const page = await ctx.newPage();
await page.goto(base + '/solo/fritz');
await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).filter({ visible: true }).first().click();
const start = page.getByText('Start Match', { exact: false }).first();
await start.waitFor({ state: 'visible', timeout: 15000 });
await start.click();
await page.locator('.bot-match-screen, .game-screen').first().waitFor({ timeout: 30000 });
const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile').first();
for (let i = 0; i < 40; i++) {
  if (await hand.isVisible().catch(() => false)) break;
  if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 4000, force: true }).catch(() => {});
  await page.waitForTimeout(700);
}
let played = 0;
for (let i = 0; i < 120 && played < Number(moves); i++) {
  const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile), .wl-hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  const zone = page.locator('.placement-zone.active').first();
  if ((await playable.count()) > 0) {
    await playable.click({ force: true, timeout: 4000 }).catch(() => {});
    if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) { await zone.click({ force: true, timeout: 4000 }).catch(() => {}); played++; }
  } else {
    const by = page.locator('[class*="boneyard"]').first();
    if (await by.isVisible().catch(() => false)) await by.click({ force: true, timeout: 3000 }).catch(() => {});
  }
  await page.waitForTimeout(900);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}-${profile}-${variant}.png` });
const info = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const tileHand = q('.hand-area .domino-tile:not(.board-tile), .wl-hand-area .domino-tile:not(.board-tile)');
  const tileBoard = q('.domino-tile.board-tile');
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  return {
    classes: q('.game-screen')?.className,
    handTile: r(tileHand), handBody: r(tileHand?.querySelector('.domino-body')), boardTile: r(tileBoard), boardBody: r(tileBoard?.querySelector('.domino-body')),
    pip: r(q('.hand-area .pip, .wl-hand-area .pip')), board: r(q('.nbl-board-canvas, .board-area')), rack: r(q('.rh-tile-rack')), boneyard: r(q('.boneyard-pill')),
    boardBg: cs(q('.nbl-board-canvas'), 'backgroundColor'), boardBgImg: cs(q('.nbl-board-canvas'), 'backgroundImage')?.slice(0, 300),
    tileShadow: cs(tileHand?.querySelector('.domino-body'), 'boxShadow'), tileFilter: cs(tileBoard, 'filter'),
    boardTileCount: document.querySelectorAll('.domino-tile.board-tile').length,
    handHtml: tileHand?.outerHTML.slice(0, 900), rackHtml: q('.rh-tile-rack')?.outerHTML.slice(0, 500), boneHtml: q('.boneyard-pill')?.outerHTML.slice(0, 700),
  };
});
fs.writeFileSync(`${out}-${profile}-${variant}.json`, JSON.stringify(info, null, 1));
console.log(JSON.stringify({ ...info, handHtml: undefined, rackHtml: undefined, boneHtml: undefined, boardBgImg: undefined }));
await browser.close();
