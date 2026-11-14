#!/usr/bin/env node
/**
 * Why did the first tap on the pre-game draw tiles take 8 s in cold phone runs? Fresh context each time, phone profile (4x CPU, 4G-ish network).
 * After the draw tiles are marked pickable, every 150 ms: (a) Playwright trial tap (actionability only), (b) what element is on top at the tile centre.
 *   node scripts/perf/probeDrawCover.mjs --base http://127.0.0.1:5401 --runs 3
 */
import { chromium, devices } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base ?? 'http://127.0.0.1:5401';
const RUNS = Number(args.runs ?? 3);
const browser = await chromium.launch();
for (let run = 1; run <= RUNS; run++) {
  const ctx = await browser.newContext(devices['iPhone 14 landscape']);
  await ctx.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.25e6, uploadThroughput: 0.625e6 });
  await page.goto(`${BASE}/solo/fritz`);
  await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).filter({ visible: true }).first().tap();
  const start = page.getByText('Start Match', { exact: false }).filter({ visible: true }).first();
  await start.waitFor({ timeout: 15000 });
  for (let i = 0; i < 40 && !(await start.isEnabled().catch(() => false)); i++) await page.waitForTimeout(250);
  await start.tap();
  const slot = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  await slot.waitFor({ state: 'attached', timeout: 30000 });
  const t0 = Date.now();
  const rows = [];
  let firstOk = null;
  for (let k = 0; k < 80; k++) {
    const t = Date.now() - t0;
    const info = await page.evaluate(() => {
      const el = document.querySelector('.pre-game-draw-board__tile-slot.is-pickable');
      if (!el) return { gone: true };
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], top: top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : null, covered: top ? !el.contains(top) && top !== el : null, anims: el.getAnimations({ subtree: true }).length, pe: getComputedStyle(el).pointerEvents };
    }).catch(() => ({ err: true }));
    let ok = false;
    try { await slot.tap({ trial: true, timeout: 120 }); ok = true; } catch { ok = false; }
    if (ok && firstOk == null) firstOk = t;
    rows.push({ t, ok, ...info });
    if (firstOk != null && t > firstOk + 600) break;
    await page.waitForTimeout(100);
  }
  const first = rows.find((r) => r.ok);
  console.log(`run ${run}: first successful trial tap ${first ? first.t + ' ms' : 'NEVER (12 s)'} after tiles became pickable`);
  const sample = rows.filter((_, i) => i % 6 === 0).slice(0, 8);
  for (const r of sample) console.log(`   t=${r.t} ok=${r.ok} covered=${r.covered} top=${r.top} pe=${r.pe} anims=${r.anims} rect=${JSON.stringify(r.rect)}`);
  await ctx.close();
}
await browser.close();
