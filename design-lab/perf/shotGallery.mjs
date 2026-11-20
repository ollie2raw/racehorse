// Contact-sheet PNGs of the gallery pages. node shotGallery.mjs <designLabDir>
import { chromium } from '@playwright/test';

const root = process.argv[2];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 2700 } })).newPage();
for (const vp of ['desktop', 'laptop', 'phone']) {
  await page.goto(`file://${root}/gallery/index.html?vp=${vp}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${root}/png/gallery-${vp}.png`, fullPage: true });
}
await page.goto(`file://${root}/gallery/details.html`);
await page.screenshot({ path: `${root}/png/details.png`, fullPage: true });
await page.goto(`file://${root}/gallery/motion.html`);
await page.waitForTimeout(500);
await page.screenshot({ path: `${root}/png/motion.png`, fullPage: true });
await browser.close();
console.log('ok');
