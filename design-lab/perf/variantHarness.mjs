#!/usr/bin/env node
/**
 * Paint-cost harness for the tile/board variants (EXPERIMENT ONLY; app source untouched).
 *
 *   node variantHarness.mjs --mode app|scene --variant none|SEL|tA|tB|tC|bA|bB|bC --run 1 --out result.json [--base http://localhost:5611] [--moves 14]
 *
 * Model: client/scripts/perf/expHarness.mjs + lagHarness.mjs (iPhone 14 landscape 844x390, CDP CPU throttle 4x, in-page PerformanceObservers,
 * CDP Performance.getMetrics deltas).
 *  - mode app:   the REAL built app (static server, port 5611), Play vs Fritz (Rookie), the variant stylesheet injected with an init script
 *                (<html data-rh-tiles/-board> + <style> from ../themes/*.css). Plays `--moves` of our own moves with taps.
 *  - mode scene: the static scene (gallery/scene.html), same real markup, deterministic stress: 90 frames that dirty the board
 *                (background flip on the canvas -> re-raster of every tile) + hand tile selection toggles every 6th frame.
 * Records: CDP Task/RecalcStyle/Layout/Script duration deltas (style recalc share = RecalcStyle / Task), long tasks (>50 ms), event-timing
 * (INP proxy: worst and p75 interaction), rAF frames over 25 ms, and a trace-derived Paint / UpdateLayoutTree / Layout / RasterTask / Layerize total.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const MODE = args.mode ?? 'app', VARIANT = args.variant ?? 'none', BASE = args.base ?? 'http://localhost:5611', OUT = args.out ?? `variant-${MODE}-${VARIANT}.json`;
const MOVES = Number(args.moves ?? 14), CPU = Number(args.cpu ?? 4);
const SCENE_URL = 'file://' + path.resolve(here, '..', 'gallery', 'scene.html');

const themeCss = fs.readFileSync(path.join(here, '..', 'themes', 'tiles.css'), 'utf8') + '\n' + fs.readFileSync(path.join(here, '..', 'themes', 'boards.css'), 'utf8');
const attrs = { none: {}, SEL: { rhTiles: 'SEL' }, tA: { rhTiles: 'A' }, tB: { rhTiles: 'B' }, tC: { rhTiles: 'C' }, bA: { rhBoard: 'A' }, bB: { rhBoard: 'B' }, bC: { rhBoard: 'C' } }[VARIANT];
if (!attrs) throw new Error('unknown variant ' + VARIANT);

const COLLECTOR = `(() => {
  const P = (window.__perf = { longtasks: [], events: [], frames: [], n: 0 });
  const obs = (type, opts, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch {} };
  obs('longtask', {}, (e) => P.longtasks.push({ s: e.startTime, d: e.duration }));
  obs('event', { durationThreshold: 16 }, (e) => { if (e.interactionId) P.events.push({ n: e.name, d: e.duration, id: e.interactionId }); });
  let last = performance.now();
  const loop = (ts) => { P.n++; const dt = ts - last; last = ts; P.frames.push(dt); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const attrs = ${JSON.stringify(attrs)}; const css = ${JSON.stringify(Object.keys(attrs).length && MODE === 'app' ? themeCss : '')};
  const apply = () => { for (const [k, v] of Object.entries(attrs)) document.documentElement.dataset[k] = v;
    if (css) { const st = document.createElement('style'); st.id = 'rh-lab'; st.textContent = css; (document.head || document.documentElement).appendChild(st); } };
  if (document.head) apply(); else document.addEventListener('DOMContentLoaded', apply, { once: true });
})();`;

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const ctx = await browser.newContext(devices['iPhone 14 landscape']);
await ctx.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
await ctx.addInitScript(COLLECTOR);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));

const result = { mode: MODE, variant: VARIANT, run: Number(args.run ?? 1), cpu: CPU, startedAt: new Date().toISOString() };
let traceEvents = [];
cdp.on('Tracing.dataCollected', (d) => { traceEvents = traceEvents.concat(d.value); });
const startTrace = () => cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc'], recordMode: 'recordAsMuchAsPossible' } });
const stopTrace = async () => { const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await done; };

try {
  if (MODE === 'scene') {
    await page.goto(`${SCENE_URL}?tiles=ref&board=ref&hand=cur&state=idle`);
    // scene mode applies the variant through the page's own query params (same CSS files), not the injector
    const q = { none: 'tiles=ref&board=ref', SEL: 'tiles=SEL&board=ref', tA: 'tiles=A&board=ref', tB: 'tiles=B&board=ref', tC: 'tiles=C&board=ref', bA: 'tiles=ref&board=A', bB: 'tiles=ref&board=B', bC: 'tiles=ref&board=C' }[VARIANT];
    await page.goto(`${SCENE_URL}?${q}&hand=cur&state=idle`);
    await page.waitForTimeout(800);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await page.waitForTimeout(400);
    const m0 = await metrics(); await startTrace();
    await page.evaluate(() => new Promise((resolve) => {
      const canvas = document.querySelector('.nbl-board-canvas'); const hand = [...document.querySelectorAll('.hand-container .domino-tile')];
      let i = 0; const orig = getComputedStyle(canvas).backgroundColor;
      const step = () => { canvas.style.setProperty('outline', (i % 2 ? '1px' : '2px') + ' solid rgba(255,255,255,0.01)'); canvas.style.setProperty('outline-offset', '-' + (1 + (i % 2)) + 'px');
        if (i % 6 === 0) { hand.forEach((h) => h.classList.remove('selected')); hand[(i / 6) % hand.length].classList.add('selected'); }
        if (++i >= 90) resolve(); else requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }));
    await stopTrace(); const m1 = await metrics();
    result.cdp = Object.fromEntries(['TaskDuration', 'RecalcStyleDuration', 'LayoutDuration', 'ScriptDuration'].map((k) => [k, (m1[k] - m0[k]) * 1000]));
  } else {
    await page.goto(BASE + '/solo/fritz');
    await page.locator('.pvf-tier-name', { hasText: 'Rookie' }).filter({ visible: true }).first().click();
    const start = page.getByText('Start Match', { exact: false }).first();
    await start.waitFor({ state: 'visible', timeout: 20000 }); await start.click();
    await page.locator('.bot-match-screen, .game-screen').first().waitFor({ timeout: 30000 });
    const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
    const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile').first();
    for (let i = 0; i < 40; i++) { if (await hand.isVisible().catch(() => false)) break; if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 4000, force: true }).catch(() => {}); await page.waitForTimeout(700); }
    result.variantApplied = await page.evaluate(() => ({ attrs: { ...document.documentElement.dataset }, style: !!document.getElementById('rh-lab') }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await page.waitForTimeout(500);
    const m0 = await metrics(); await startTrace();
    await page.evaluate(() => { window.__perf.longtasks.length = 0; window.__perf.events.length = 0; window.__perf.frames.length = 0; });
    let own = 0, ticks = 0; const t0 = Date.now();
    while (own < MOVES && Date.now() - t0 < 420000) {
      ticks++;
      if (await page.getByText(/Victory|Defeat|Match Complete/).first().isVisible().catch(() => false)) break;
      if (await page.getByTestId('hand-over-modal').isVisible().catch(() => false)) { await page.waitForTimeout(1200); continue; }
      const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile), .wl-hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
      const zone = page.locator('.placement-zone.active').first();
      const boneyard = page.locator('[class*="boneyard"]').first();
      const tap = (l) => l.tap({ force: true, timeout: 4000 }).catch(() => {});
      if ((await playable.count().catch(() => 0)) > 0) { await tap(playable); if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) await tap(zone); own++; }
      else if (await boneyard.isVisible().catch(() => false)) { await tap(boneyard); }
      await page.waitForTimeout(500);
    }
    result.own = own; result.ticks = ticks;
    await stopTrace(); const m1 = await metrics();
    result.cdp = Object.fromEntries(['TaskDuration', 'RecalcStyleDuration', 'LayoutDuration', 'ScriptDuration'].map((k) => [k, (m1[k] - m0[k]) * 1000]));
  }
  const perf = await page.evaluate(() => window.__perf);
  const frames = perf.frames.slice(2);
  const ev = perf.events.map((e) => e.d).sort((a, b) => a - b);
  result.frames = { n: frames.length, over25: frames.filter((d) => d > 25).length, over50: frames.filter((d) => d > 50).length, p95: frames.slice().sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] ?? null };
  result.longtasks = { n: perf.longtasks.length, totalMs: perf.longtasks.reduce((s, t) => s + t.d, 0) };
  result.inp = { n: ev.length, worst: ev.at(-1) ?? null, p75: ev[Math.floor(ev.length * 0.75)] ?? null };
  const sumDur = (names) => traceEvents.filter((e) => names.includes(e.name) && e.ph === 'X').reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  result.trace = { eventCount: traceEvents.length, paintMs: sumDur(['Paint']), layerizeMs: sumDur(['Layerize', 'PrePaint']), styleMs: sumDur(['UpdateLayoutTree', 'RecalcStyle']), layoutMs: sumDur(['Layout']), rasterMs: sumDur(['RasterTask', 'ImageDecodeTask']), commitMs: sumDur(['Commit']) };
  result.styleShare = result.cdp.RecalcStyleDuration / result.cdp.TaskDuration;
} catch (e) { result.fatal = String(e?.stack || e); try { await page.screenshot({ path: OUT.replace(/\.json$/, '-fatal.png') }); } catch {} }
finally { fs.writeFileSync(OUT, JSON.stringify(result)); await browser.close(); }
console.log(OUT, result.fatal ? 'FATAL ' + result.fatal.slice(0, 200) : JSON.stringify({ own: result.own, task: Math.round(result.cdp.TaskDuration), styleShare: +result.styleShare.toFixed(3), lt: result.longtasks.n, inp: result.inp.worst, f25: result.frames.over25, paint: Math.round(result.trace.paintMs), raster: Math.round(result.trace.rasterMs) }));
