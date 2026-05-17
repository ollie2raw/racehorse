import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../../docs/screenshots');
const baseUrl = process.env.CAPTURE_BASE_URL ?? 'http://127.0.0.1:5173';

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: 'Social' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'social-implementation.png'), fullPage: false });

  await page.getByRole('button', { name: 'View Leaderboard' }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'daily-fritz-leaderboard-implementation.png'), fullPage: false });

  await browser.close();
  console.log('Saved screenshots to', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
