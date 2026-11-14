#!/usr/bin/env node
/**
 * Daily Fritz checkpoint payload breakdown: plays N steps, then reads the persisted snapshot from localStorage, reports its size by top-level
 * key and nested key, and times JSON.stringify and localStorage.setItem of it at the given CPU throttle.
 *   node scripts/perf/checkpointSize.mjs --base http://localhost:5312 --steps 40 --cpu 4
 */
import { chromium, devices } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base ?? 'http://localhost:5312';
const STEPS = Number(args.steps ?? 40);
const CPU = Number(args.cpu ?? 4);

const browser = await chromium.launch();
const context = await browser.newContext(devices['iPhone 14 landscape']);
await context.addInitScript(() => {
  localStorage.setItem('hasSeenWelcome', '1');
  localStorage.setItem('racehorse_e2e_user_id', crypto.randomUUID());
  localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const bodies = [];
page.on('request', (r) => { if (r.url().includes('/api/daily-fritz/checkpoint')) bodies.push(r.postData() ?? ''); });
await page.goto(`${BASE}/daily-fritz`);
await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await page.locator('.df-pvf-start-btn').click();
await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ timeout: 30000 });
for (let i = 0; i < 40; i++) {
  if (await page.locator('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile').first().isVisible().catch(() => false)) break;
  const pick = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  if (await pick.isVisible().catch(() => false)) await pick.tap({ force: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(700);
}
const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
const zone = page.locator('.placement-zone.active').first();
const boneyard = page.locator('[class*="boneyard"]').first();
for (let i = 0; i < STEPS; i++) {
  if ((await playable.count().catch(() => 0)) > 0) {
    await playable.tap({ force: true, timeout: 3000 }).catch(() => {});
    if (await zone.isVisible({ timeout: 1200 }).catch(() => false)) await zone.tap({ force: true, timeout: 3000 }).catch(() => {});
  } else if (await boneyard.isVisible().catch(() => false)) await boneyard.tap({ force: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
}
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const report = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('racehorse:daily-fritz:v3:'));
  if (!key) return { error: 'no snapshot key' };
  const raw = localStorage.getItem(key);
  const obj = JSON.parse(raw);
  const size = (v) => JSON.stringify(v).length;
  const top = Object.entries(obj).map(([k, v]) => [k, size(v)]).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const nested = (o, depth = 0, prefix = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) && depth < 2 ? nested(v, depth + 1, `${prefix}${k}.`) : [[`${prefix}${k}${Array.isArray(v) ? `[${v.length}]` : ''}`, size(v)]]));
  const all = nested(obj).sort((a, b) => b[1] - a[1]).slice(0, 14);
  const t = (fn, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };
  return {
    key, totalChars: raw.length, top, nested: all,
    stringifyMs: Number(t(() => JSON.stringify(obj), 20).toFixed(2)),
    parseMs: Number(t(() => JSON.parse(raw), 20).toFixed(2)),
    setItemMs: Number(t(() => localStorage.setItem(key + ':probe', raw), 20).toFixed(2)),
  };
});
console.log(JSON.stringify({ steps: STEPS, cpu: CPU, checkpointPosts: bodies.length, postBodyBytes: bodies.map((b) => b.length).slice(-5), report }, null, 1));
await browser.close();
