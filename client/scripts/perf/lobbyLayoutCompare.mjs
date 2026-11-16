#!/usr/bin/env node
/** Private-lobby layout in WebKit vs Chromium at two phone sizes, with element boxes and screenshots: node scripts/perf/lobbyLayoutCompare.mjs --base http://127.0.0.1:5471 --out /tmp/lobby */
import { chromium, devices, webkit } from '@playwright/test';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'http://127.0.0.1:5471'); const OUT = arg('out', '/tmp/lobby');
const SIZES = { landscape: devices['iPhone 14 landscape'], portrait: devices['iPhone 14'] };
for (const [size, device] of Object.entries(SIZES)) {
  for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
    const b = await engine.launch(); const ctx = await b.newContext(device);
    await ctx.addInitScript(() => localStorage.setItem('hasSeenWelcome', '1'));
    const p = await ctx.newPage(); await p.goto(BASE + '/multiplayer');
    for (let i = 0; i < 40; i++) { const t = await p.locator('.mp-topbar__status-text').first().textContent().catch(() => ''); if (/\d+\s+online/i.test(t ?? '')) break; await p.waitForTimeout(250); }
    const priv = p.getByRole('tab', { name: /Private/i }); const privBtn = p.getByRole('button', { name: /^Private$/i });
    await ((await priv.isVisible().catch(() => false)) ? priv : privBtn).tap(); await p.waitForTimeout(400);
    { const tab = p.getByRole('tab', { name: /Create lobby/i }); if (await tab.count()) { await tab.tap({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(400); } }
    await p.getByRole('button', { name: /^Create lobby/i }).first().tap({ timeout: 8000 }).catch((e) => console.log('  create tap failed:', String(e).slice(0, 80))); await p.waitForTimeout(3000);
    const boxes = await p.evaluate(() => {
      const vh = innerHeight; const out = { viewport: [innerWidth, innerHeight] };
      const find = (label, sel, text) => { const els = [...document.querySelectorAll(sel)].filter((e) => !text || new RegExp(text, 'i').test(e.textContent || '')); const e = els[0]; if (!e) { out[label] = null; return; } const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); out[label] = { n: els.length, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none', inViewport: r.bottom > 0 && r.top < vh, opacity: cs.opacity }; };
      find('roomCode', '.pml-roomcode-bar-code'); find('waitingButton', 'button', 'waiting for opponent'); find('leaveRoom', 'button', 'leave room'); find('panelFooter', '.pml-panel-footer');
      const scroller = document.querySelector('.pml-root, .mp-lobby, [class*="pml-"]'); out.firstPml = scroller ? scroller.className.toString().slice(0, 60) : null;
      return out;
    });
    console.log(`${size} ${name}`, JSON.stringify(boxes));
    await p.screenshot({ path: `${OUT}/${size}-${name}.png` });
    await b.close();
  }
}
