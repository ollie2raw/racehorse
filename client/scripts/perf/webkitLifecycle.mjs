#!/usr/bin/env node
/**
 * Page-lifecycle behaviour in WebKit vs Chromium: does the speed-measurement beacon (RUM) and the Daily checkpoint flush get out when a page
 * is hidden, closed or reloaded?  node scripts/perf/webkitLifecycle.mjs --base http://127.0.0.1:5471 --server http://127.0.0.1:3001 [--browser webkit]
 * Needs a client built with VITE_RUM_SAMPLE_RATE=1 and a server started with RUM_SUMMARY_TOKEN=tok.
 */
import { chromium, devices, webkit } from '@playwright/test';
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base; const SERVER = args.server; const BROWSER = args.browser ?? 'webkit';
const reports = async () => (await (await fetch(`${SERVER}/api/rum/summary`, { headers: { authorization: 'Bearer tok' } })).json()).current.reports;
const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const out = { browser: BROWSER };

// 1. events a page sees: switch tabs, close, reload
{
  const ctx = await browser.newContext(devices['iPhone 14 landscape']);
  await ctx.addInitScript(() => { localStorage.setItem('hasSeenWelcome', '1'); window.__ev = []; for (const t of ['visibilitychange', 'pagehide', 'beforeunload', 'freeze']) addEventListener(t, () => window.__ev.push(t + ':' + document.visibilityState)); document.addEventListener('visibilitychange', () => window.__ev.push('doc-visibilitychange:' + document.visibilityState)); });
  const p1 = await ctx.newPage(); await p1.goto(BASE); await p1.waitForTimeout(1500);
  const p2 = await ctx.newPage(); await p2.goto('about:blank'); await p2.bringToFront(); await p2.waitForTimeout(800);
  out.switchTab = { p1Visibility: await p1.evaluate(() => document.visibilityState), p1Events: await p1.evaluate(() => window.__ev) };
  await p1.bringToFront(); await p1.waitForTimeout(500);
  out.switchBack = await p1.evaluate(() => ({ vis: document.visibilityState, ev: window.__ev }));
  await ctx.close();
}

// 2. does the speed beacon arrive when the page is closed (pagehide) after some navigation?
{
  const before = await reports();
  const ctx = await browser.newContext(devices['iPhone 14 landscape']);
  await ctx.addInitScript(() => { localStorage.setItem('hasSeenWelcome', '1'); });
  const p = await ctx.newPage(); await p.goto(BASE); await p.waitForTimeout(3500); // the collector loads after idle (WebKit has no requestIdleCallback: a 2 s timeout)
  await p.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().tap().catch(() => {});
  await p.waitForTimeout(800);
  await p.close(); await new Promise((r) => setTimeout(r, 1500));
  out.beaconOnClose = { before, after: await reports() };
  // and on a navigation away (reload)
  const p2 = await ctx.newPage(); await p2.goto(BASE); await p2.waitForTimeout(3500);
  await p2.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first().tap().catch(() => {});
  await p2.waitForTimeout(800);
  const b2 = await reports(); await p2.reload(); await new Promise((r) => setTimeout(r, 1500));
  out.beaconOnReload = { before: b2, after: await reports() };
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
