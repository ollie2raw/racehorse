#!/usr/bin/env node
// Motion cost bench on the phone profile (iPhone 14 landscape, CDP 4x): 40 tile settles (one per 260 ms) + a score pulse every 3rd,
// proposed vs current-app motion, current tiles vs tile variant B, and the reduced-motion paths. Interleaved runs.
// node motionBench.mjs [runs]   (run only when no other agent's browser is running)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[2] ?? 3);
const url = (q) => 'file://' + path.resolve(here, '..', 'gallery', 'motion.html') + '?' + q;
const cases = { 'app-motion': 'motion=app', 'proposed-motion': 'motion=proposed', 'proposed-motion+tileB': 'motion=proposed&tiles=B', 'app-motion+reduced': 'motion=app&reduce=1', 'proposed+reduced': 'motion=proposed&reduce=1' };
const results = [];
const browser = await chromium.launch();
for (let run = 1; run <= RUNS; run++) {
  for (const [name, q] of Object.entries(cases)) {
    const ctx = await browser.newContext({ ...devices['iPhone 14 landscape'], reducedMotion: q.includes('reduce=1') ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(() => {
      window.__f = []; let l = performance.now(); const loop = (t) => { window.__f.push(t - l); l = t; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
      window.__lt = []; try { new PerformanceObserver((li) => li.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true }); } catch {}
    });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
    await page.goto(url(q)); await page.waitForTimeout(600);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await page.waitForTimeout(300);
    const g = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await page.evaluate(() => { window.__f.length = 0; });
    const m0 = await g();
    await page.evaluate(() => window.runBench(40));
    const m1 = await g();
    const f = (await page.evaluate(() => window.__f)).slice(1); const lt = await page.evaluate(() => window.__lt);
    results.push({ name, run, taskMs: (m1.TaskDuration - m0.TaskDuration) * 1000, styleMs: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000, layoutMs: (m1.LayoutDuration - m0.LayoutDuration) * 1000, frames: f.length, over25: f.filter((d) => d > 25).length, longtasks: lt.length });
    await ctx.close();
  }
}
await browser.close();
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
let md = '| case | task ms | style recalc ms | layout ms | frames | frames over 25 ms | long tasks |\n|---|---|---|---|---|---|---|\n';
for (const name of Object.keys(cases)) {
  const r = results.filter((x) => x.name === name);
  md += `| ${name} | ${med(r.map((x) => x.taskMs)).toFixed(0)} | ${med(r.map((x) => x.styleMs)).toFixed(1)} | ${med(r.map((x) => x.layoutMs)).toFixed(1)} | ${med(r.map((x) => x.frames))} | ${med(r.map((x) => x.over25))} | ${med(r.map((x) => x.longtasks))} |\n`;
}
fs.writeFileSync(path.join(here, '..', 'results', 'motion-bench.md'), md);
fs.writeFileSync(path.join(here, '..', 'results', 'motion-bench.json'), JSON.stringify(results));
console.log(md);
