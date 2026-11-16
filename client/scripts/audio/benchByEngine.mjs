#!/usr/bin/env node
/** The offline sound bench (src/devtools/soundBench.ts) in Chromium and WebKit, side by side: node scripts/audio/benchByEngine.mjs --base http://localhost:5199 */
import { chromium, webkit } from '@playwright/test';
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base ?? 'http://localhost:5199';
const out = {};
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const b = await engine.launch();
  const page = await (await b.newContext()).newPage();
  await page.goto(BASE, { waitUntil: 'load' });
  out[name] = await page.evaluate('(async () => { const m = await import("/src/devtools/soundBench.ts"); return m.renderSoundBench(); })()');
  await b.close();
}
const f = (v) => (Math.round(v * 10) / 10).toFixed(1).padStart(6);
console.log('sound                 peak dBFS (chromium | webkit | diff)   loud dBFS (chromium | webkit | diff)');
for (const c of out.chromium) {
  const w = out.webkit.find((x) => x.name === c.name);
  console.log(`${c.name.padEnd(20)} ${f(c.peakDb)} | ${f(w.peakDb)} | ${f(w.peakDb - c.peakDb)}      ${f(c.momentaryDb)} | ${f(w.momentaryDb)} | ${f(w.momentaryDb - c.momentaryDb)}`);
}
