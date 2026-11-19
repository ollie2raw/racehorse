// Render PNGs of the scenes with Playwright chromium from the static page. node shotScenes.mjs <baseUrl> <outDir>
import fs from 'node:fs';
import { chromium } from '@playwright/test';
const [base = 'http://localhost:5611', out = '../png'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const VPS = { desktop: [1440, 900], laptop: [1512, 982], phone: [844, 390] };
const sets = [
  ['ref', 'tiles=ref&board=ref&hud=cur&hand=cur&state=idle'],
  ['t-A', 'tiles=A&board=ref&hand=lg'], ['t-B', 'tiles=B&board=ref&hand=lg'], ['t-C', 'tiles=C&board=ref&hand=lg'],
  ['b-A', 'tiles=ref&board=A&hand=lg'], ['b-B', 'tiles=ref&board=B&hand=lg'], ['b-C', 'tiles=ref&board=C&hand=lg'],
  ['AA-idle', 'tiles=A&board=A&hud=v2&hand=lg&state=idle'], ['BB-idle', 'tiles=B&board=B&hud=v2&hand=lg&state=idle'], ['CC-idle', 'tiles=C&board=C&hud=v2&hand=lg&state=idle'],
  ['ref-sel', 'tiles=ref&board=ref&state=sel'],
  ['AA-sel', 'tiles=A&board=A&hud=v2&hand=lg&state=sel'], ['BB-sel', 'tiles=B&board=B&hud=v2&hand=lg&state=sel'], ['CC-sel', 'tiles=C&board=C&hud=v2&hand=lg&state=sel'],
];
const browser = await chromium.launch();
for (const [vn, [w, h]] of Object.entries(VPS)) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, qs] of sets) {
    await page.goto(`${base}/gallery/scene.html?${qs}`);
    await page.screenshot({ path: `${out}/${vn}-${name}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log('done');
