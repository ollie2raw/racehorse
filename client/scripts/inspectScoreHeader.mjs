/**
 * Opens bot match and prints computed styles for score header audit.
 * Usage: node scripts/inspectScoreHeader.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:5174/';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });

  // Home → Single Player hub
  const solo = page.getByRole('link', { name: /single player/i }).or(page.getByText(/single player/i).first());
  if (await solo.count()) {
    await solo.first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  // Play vs Fritz card
  const pvf = page.getByText(/play vs fritz/i).first();
  if (await pvf.count()) {
    await pvf.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }

  const start = page.getByRole('button', { name: /start match/i });
  if (await start.count()) {
    await start.click({ timeout: 8000 });
    await page.waitForTimeout(1500);
  }

  const header = page.locator('header.wl-score-header[data-ui="score-header"]');
  await header.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  const report = await page.evaluate(() => {
    const headerEl = document.querySelector('header.wl-score-header[data-ui="score-header"]');
    if (!headerEl) return { error: 'header not found' };

    const nameEl = headerEl.querySelector('.wl-score-header__player-name');
    const holeEl = headerEl.querySelector('.wl-cribbage-hole');
    const cs = (el) => (el ? getComputedStyle(el) : null);

    const headerStyle = cs(headerEl);
    const chain = [];
    let node = headerEl.parentElement;
    while (node && chain.length < 6) {
      const s = getComputedStyle(node);
      chain.push({
        tag: node.tagName.toLowerCase(),
        className: node.className,
        height: s.height,
        minHeight: s.minHeight,
        maxHeight: s.maxHeight,
        padding: s.padding,
        flex: s.flex,
        overflow: s.overflow,
      });
      node = node.parentElement;
    }

    const trayEl = document.querySelector('.wl-hand-area, .hand-area');
    const trayStyle = trayEl ? getComputedStyle(trayEl) : null;

    return {
      trayHeight: trayStyle
        ? {
            height: trayStyle.height,
            minHeight: trayStyle.minHeight,
            padding: trayStyle.padding,
          }
        : null,
      cssVarTrayHeight: getComputedStyle(document.documentElement).getPropertyValue('--tray-height').trim(),
      header: {
        height: headerStyle.height,
        minHeight: headerStyle.minHeight,
        maxHeight: headerStyle.maxHeight,
        paddingTop: headerStyle.paddingTop,
        paddingBottom: headerStyle.paddingBottom,
        flex: headerStyle.flex,
        boxSizing: headerStyle.boxSizing,
      },
      playerName: nameEl
        ? {
            fontSize: cs(nameEl).fontSize,
            fontWeight: cs(nameEl).fontWeight,
            color: cs(nameEl).color,
          }
        : null,
      hole: holeEl
        ? {
            width: cs(holeEl).width,
            height: cs(holeEl).height,
            flex: cs(holeEl).flex,
            backgroundColor: cs(holeEl).backgroundColor,
          }
        : null,
      ancestors: chain,
    };
  });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
