#!/usr/bin/env node
/**
 * Daily Fritz checkpoint traffic: plays hands on the phone profile (iPhone 14 landscape, CPU throttle) and counts
 * /api/daily-fritz/checkpoint POSTs and their body bytes, with a timeline against next-hand and hand-over.
 *   node scripts/perf/checkpointPosts.mjs --base http://127.0.0.1:5422 --hands 3 --cpu 4 --budgetMs 300000
 */
import { chromium, devices } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base;
const HANDS = Number(args.hands ?? 3);
const CPU = Number(args.cpu ?? 4);
const BUDGET = Number(args.budgetMs ?? 300000);

const browser = await chromium.launch();
const context = await browser.newContext(devices['iPhone 14 landscape']);
await context.addInitScript(() => {
  localStorage.setItem('hasSeenWelcome', '1');
  localStorage.setItem('racehorse_e2e_user_id', crypto.randomUUID());
  localStorage.setItem('racehorse_e2e_bearer', 'e2e-daily-fritz');
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const t0 = Date.now();
const events = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/daily-fritz/checkpoint')) events.push({ t: Date.now() - t0, k: 'checkpoint', bytes: (r.postData() ?? '').length, rev: Number(/"checkpointRevision":(\d+)/.exec(r.postData() ?? '')?.[1] ?? -1) });
  else if (u.includes('/api/daily-fritz/next-hand')) events.push({ t: Date.now() - t0, k: 'next-hand' });
  else if (u.includes('/api/daily-fritz/record-game') || u.includes('/api/daily-fritz/hand-over')) events.push({ t: Date.now() - t0, k: u.split('/').pop() });
});
await page.goto(`${BASE}/daily-fritz`);
await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
await page.locator('.df-pvf-start-btn').click();
await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ timeout: 30000 });
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
const zone = page.locator('.placement-zone.active').first();
const boneyard = page.locator('[class*="boneyard"]').first();
const pick = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
const cont = page.getByRole('button', { name: /next hand|continue|start next|next game/i }).first();
let handsSeen = 0;
while (Date.now() - t0 < BUDGET && events.filter((e) => e.k === 'next-hand').length < HANDS) {
  if (await pick.isVisible().catch(() => false)) await pick.tap({ force: true, timeout: 3000 }).catch(() => {});
  else if (await cont.isVisible().catch(() => false)) { await cont.tap({ force: true, timeout: 3000 }).catch(() => {}); }
  else if ((await playable.count().catch(() => 0)) > 0) {
    await playable.tap({ force: true, timeout: 3000 }).catch(() => {});
    if (await zone.isVisible({ timeout: 1200 }).catch(() => false)) await zone.tap({ force: true, timeout: 3000 }).catch(() => {});
  } else if (await boneyard.isVisible().catch(() => false)) await boneyard.tap({ force: true, timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
}
await page.waitForTimeout(500);
const cps = events.filter((e) => e.k === 'checkpoint');
console.log(JSON.stringify({ base: BASE, cpu: CPU, elapsedMs: Date.now() - t0, nextHands: events.filter((e) => e.k === 'next-hand').length, checkpointPosts: cps.length, checkpointBytes: cps.reduce((a, e) => a + e.bytes, 0), events }, null, 0));
await browser.close();
