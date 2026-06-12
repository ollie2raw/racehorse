import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(clientRoot, '..');
const artifactsDir = path.resolve(repoRoot, 'docs/qa-artifacts/daily-fritz-hand-lifecycle');
const storageStatePath = path.resolve(clientRoot, '.auth/daily-fritz-qa.json');
const reportPath = path.resolve(repoRoot, 'docs/daily-fritz-hand-lifecycle-qa-report.md');

const requestedAppUrl = (process.env.DAILY_FRITZ_QA_APP_URL || process.env.TOURNAMENT_QA_APP_URL || '')
  .trim()
  .replace(/\/$/, '');
const browserChannel = process.env.DAILY_FRITZ_QA_BROWSER_CHANNEL?.trim() || 'chrome';
const headless = process.env.DAILY_FRITZ_QA_HEADLESS === '0' ? false : true;

const results = [];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function record(id, label, passed, detail) {
  results.push({ id, label, passed, detail });
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${id} — ${label}${detail ? `: ${detail}` : ''}`);
}

async function openDailyFritzMatch(page, appUrl) {
  await page.goto(`${appUrl}/#/daily-fritz`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('.df-pvf-start-btn').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('.df-pvf-start-btn').click();
  await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ state: 'visible', timeout: 30000 });
}

async function isPlayerTurn(page) {
  return page.locator('.wl-player-pill.is-you.is-active-turn').isVisible().catch(() => false);
}

async function tryOnePlayerMove(page) {
  const playable = page.locator('.hand-container button.domino-tile:not(.unplayable):not(.disabled)');
  if ((await playable.count()) === 0) return false;
  await playable.first().click();
  await page.waitForTimeout(300);
  const zone = page.locator('.placement-zone.active').first();
  if (await zone.isVisible().catch(() => false)) {
    await zone.click();
  }
  await page.waitForTimeout(600);
  return true;
}

async function playUntilHandOver(page, maxMoves = 30, maxMs = 120000) {
  const started = Date.now();
  for (let i = 0; i < maxMoves; i += 1) {
    if (await page.getByTestId('hand-over-modal').isVisible().catch(() => false)) return true;
    if (Date.now() - started > maxMs) break;
    if (!(await isPlayerTurn(page))) {
      await page.waitForTimeout(700);
      continue;
    }
    const moved = await tryOnePlayerMove(page);
    if (!moved) await page.waitForTimeout(500);
  }
  return page.getByTestId('hand-over-modal').isVisible().catch(() => false);
}

async function readProgressWidth(page) {
  return page.getByTestId('hand-over-progress-track').evaluate((el) => {
    const fill = el.querySelector('.hand-over-modal__progress-fill');
    if (!fill) return null;
    const width = getComputedStyle(fill).width;
    const trackWidth = getComputedStyle(el).width;
    const fillPx = Number.parseFloat(width);
    const trackPx = Number.parseFloat(trackWidth);
    if (!Number.isFinite(fillPx) || !Number.isFinite(trackPx) || trackPx <= 0) return null;
    return fillPx / trackPx;
  });
}

async function main() {
  const appUrl = requestedAppUrl || 'http://127.0.0.1:5173';
  ensureDir(artifactsDir);

  const browser = await chromium.launch({ channel: browserChannel, headless });
  const contextOptions = { viewport: { width: 1440, height: 960 } };
  const context = fs.existsSync(storageStatePath)
    ? await browser.newContext({ ...contextOptions, storageState: storageStatePath })
    : await browser.newContext(contextOptions);
  await context.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
  });

  const page = await context.newPage();
  try {
    await openDailyFritzMatch(page, appUrl);
    const startHandNumber = await page.locator('.wl-hand-number, .pvf-hand-pill').first().innerText().catch(() => '1');
    await page.screenshot({ path: path.join(artifactsDir, 'df-hand-before-end.png'), fullPage: true });

    const handOverReached = await playUntilHandOver(page);
    record('DF-HAND-01', 'Hand-over modal appears after a completed hand', handOverReached, handOverReached ? '' : 'modal not visible');
    if (!handOverReached) {
      await page.screenshot({ path: path.join(artifactsDir, 'df-hand-modal-missing.png'), fullPage: true });
      throw new Error('Hand-over modal never appeared');
    }

    await page.screenshot({ path: path.join(artifactsDir, 'df-hand-modal-visible.png'), fullPage: true });
    const progressVisible = await page.getByTestId('hand-over-progress-track').isVisible();
    record('DF-HAND-02', 'Yellow countdown progress track is visible', progressVisible);

    const widthA = await readProgressWidth(page);
    await page.waitForTimeout(1200);
    const widthB = await readProgressWidth(page);
    const countdownMoves =
      widthA != null && widthB != null ? widthB < widthA - 0.02 || widthB < 0.95 : false;
    record(
      'DF-HAND-03',
      'Countdown bar animates downward',
      countdownMoves,
      `widthA=${widthA?.toFixed?.(2) ?? 'n/a'} widthB=${widthB?.toFixed?.(2) ?? 'n/a'}`,
    );

    const advancedCleanly = await page
      .waitForFunction(
        () => !document.querySelector('[data-testid="hand-over-modal"]'),
        undefined,
        { timeout: 12000 },
      )
      .then(() => true)
      .catch(() => false);
    record('DF-HAND-04', 'Hand advances cleanly after countdown', advancedCleanly);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(artifactsDir, 'df-hand-after-advance.png'), fullPage: true });

    let drawSmoke = false;
    for (let i = 0; i < 12; i += 1) {
      if (!(await isPlayerTurn(page))) {
        await page.waitForTimeout(600);
        continue;
      }
      const drawBtn = page.locator('button').filter({ hasText: /^Draw$/i });
      if (await drawBtn.isVisible().catch(() => false)) {
        await drawBtn.click();
        await page.waitForTimeout(500);
        drawSmoke = await page.locator('.hand-container .domino-tile.new-draw').first().isVisible().catch(() => false);
        if (drawSmoke) break;
      }
      await tryOnePlayerMove(page);
    }
    record(
      'DF-HAND-05',
      'Draw feedback visible (flying tile or new-draw pulse)',
      drawSmoke,
      drawSmoke ? 'new-draw pulse' : 'no forced draw scenario in sampled moves',
    );
    if (drawSmoke) {
      await page.screenshot({ path: path.join(artifactsDir, 'df-hand-draw-pulse.png'), fullPage: true });
    }

    const endHandNumber = await page.locator('.wl-hand-number, .pvf-hand-pill').first().innerText().catch(() => startHandNumber);
    record(
      'DF-HAND-06',
      'Hand index advances after modal',
      advancedCleanly && endHandNumber !== startHandNumber,
      `start=${startHandNumber} end=${endHandNumber}`,
    );
  } finally {
    await context.close();
    await browser.close();
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const lines = [
    '# Daily Fritz Hand Lifecycle QA',
    '',
    `App: ${requestedAppUrl || 'http://127.0.0.1:5173'}`,
    `Result: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed}/${results.length})`,
    '',
    '| ID | Scenario | Result | Detail |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.label} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.detail || ''} |`),
    '',
    `Artifacts: ${artifactsDir}`,
  ];
  fs.writeFileSync(reportPath, `${lines.join('\n')}\n`);
  console.log(`Report written to ${reportPath}`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
