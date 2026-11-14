#!/usr/bin/env node
/**
 * Phase 1b: transition timelines (app load, enter game, pre-game draw, hand end, game end, placement). Measurement only.
 *
 *   node scripts/perf/transitionHarness.mjs --mode load|pvf|daily|mp --base http://127.0.0.1:5401 [--profile phone|desktop]
 *        [--cpu 4] [--net phone|slow|none] [--cache cold|warm] [--maxHands N] [--budgetMs 600000] --out run.json
 *
 * load : home page only; --cache warm loads once, then reloads in a fresh page of the same context (HTTP cache warm, JS cold).
 * pvf|daily|mp : from the home menu, tap through to the match (every tap is timed to the next screen), pre-game draw, then play to the
 *   result (or --maxHands hands), recording a state-signature timeline, animations, resource timing, CDP main-thread deltas every 100 ms,
 *   network requests and websocket frames. A second page in the same context then repeats menu -> first playable (warm HTTP cache).
 */
import fs from 'node:fs';
import { chromium, devices } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : [])));
const MODE = args.mode ?? 'pvf';
const BASE = args.base ?? 'http://127.0.0.1:5401';
const PROFILE = args.profile ?? 'desktop';
const CPU = Number(args.cpu ?? (PROFILE === 'phone' ? 4 : 1));
const NET = args.net ?? (PROFILE === 'phone' ? 'phone' : 'none');
const CACHE = args.cache ?? 'cold';
const MAX_HANDS = Number(args.maxHands ?? 99);
const BUDGET = Number(args.budgetMs ?? 600000);
const OUT = args.out ?? `trans-${MODE}-${PROFILE}.json`;
const isPhone = PROFILE === 'phone';
const NETS = {
  // RTT 150 ms stands in for the measured 180-440 ms /ping floor to production (about 25 ms of that is the TCP/TLS leg).
  phone: { offline: false, latency: 150, downloadThroughput: (10 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 },
  slow: { offline: false, latency: 150, downloadThroughput: (1.6 * 1e6) / 8, uploadThroughput: (0.75 * 1e6) / 8 },
};

const COLLECTOR = `(() => {
  const P = (window.__t = { taps: [], sig: [], anims: [], longtasks: [], loaf: [], events: [], paint: {}, lcp: null, commits: [], gbcr: 0, gbcrMs: 0, shifts: 0 });
  const obs = (type, opts, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch {} };
  obs('longtask', {}, (e) => P.longtasks.push({ s: e.startTime, d: e.duration }));
  obs('long-animation-frame', {}, (e) => P.loaf.push({ s: e.startTime, d: e.duration, block: e.blockingDuration, rs: e.renderStart ? e.renderStart - e.startTime : null,
    scripts: (e.scripts || []).map((x) => ({ type: x.invokerType, inv: x.invoker, src: (x.sourceURL || '').split('/').pop(), fn: x.sourceFunctionName, d: x.duration, forced: x.forcedStyleAndLayoutDuration })) }));
  obs('event', { durationThreshold: 16 }, (e) => { if (e.interactionId) P.events.push({ n: e.name, s: e.startTime, d: e.duration, id: e.interactionId, inDelay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); });
  obs('paint', {}, (e) => { P.paint[e.name] = e.startTime; });
  obs('largest-contentful-paint', {}, (e) => { P.lcp = { t: e.startTime, size: e.size, el: (e.element && (e.element.tagName + '.' + String(e.element.className).slice(0, 40))) || '', url: e.url || '' }; });
  obs('layout-shift', {}, (e) => { if (!e.hadRecentInput) P.shifts += e.value; });
  const desc = (el) => { const t = el && el.closest ? el.closest('button, [role=button], a, .domino-tile, .placement-zone, [class*=boneyard], .pre-game-draw-board__tile-slot, .pvf-tier-name, [role=tab]') : null; const n = t || el; return n ? ((n.tagName || '') + '.' + String(n.className || '').slice(0, 50) + '|' + String(n.textContent || '').trim().slice(0, 24)) : ''; };
  addEventListener('pointerdown', (ev) => P.taps.push({ t: performance.now(), d: desc(ev.target) }), true);
  addEventListener('animationstart', (ev) => P.anims.push({ t: performance.now(), n: ev.animationName, c: String(ev.target && ev.target.className).slice(0, 40) }), true);
  { const orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { const t0 = performance.now(); const r = orig.call(this); P.gbcr++; P.gbcrMs += performance.now() - t0; return r; }; }
  // React-managed (interactive) when the nav control carries React props; recorded once.
  const readyLoop = () => { if (P.reactReady == null) { const el = Array.from(document.querySelectorAll('button, a, [role=button]')).find((e) => (e.textContent || '').trim() === 'Single Player'); if (el && Object.keys(el).some((k) => k.startsWith('__reactProps'))) { P.reactReady = performance.now(); return; } } requestAnimationFrame(readyLoop); };
  requestAnimationFrame(readyLoop);
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; }, onCommitFiberRoot() { P.commits.push(performance.now()); }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
  const Q = (s) => document.querySelectorAll(s).length;
  let frame = 0; let last = '';
  const loop = () => {
    frame++;
    const ft = (frame % 4 === 0) ? (() => { const x = document.body ? document.body.textContent.toLowerCase() : ''; return (x.includes('you go first') ? 1 : 0) + (x.includes('fritz goes first') ? 2 : 0) + (x.includes('tap a tile to draw') ? 4 : 0) + (x.includes('remaining tiles') ? 8 : 0) + ((x.includes('victory') || x.includes('defeat')) ? 16 : 0) + ((x.includes('match complete') || x.includes('final score')) ? 32 : 0); })() : null;
    const s = [Q('.bot-match-screen, .game-screen'), Q('.pre-game-draw-board__tile-slot'), Q('.pre-game-draw-board__tile-slot.is-pickable'),
      Q('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile'),
      Q('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile), .wl-hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)'),
      Q('.board-tile-wrapper, .domino-tile.board-tile'), Q('[data-testid="hand-over-modal"]'), Q('.placement-zone.active')];
    if (ft !== null) loop.ft = ft;
    s.push(loop.ft || 0);
    const key = s.join(',');
    if (key !== last) { last = key; P.sig.push({ t: performance.now(), s }); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  P.animSamples = [];
  setInterval(() => { try { const all = document.getAnimations(); const names = {}; for (const a of all) { const n = a.animationName || ('transition:' + a.transitionProperty); names[n] = (names[n] || 0) + 1; } P.animSamples.push({ t: performance.now(), n: all.length, names }); } catch {} }, 250);
  // Resolves when the selector exists and has painted one frame after it appeared (time = frame start of the frame after presence).
  window.__waitVisible = (sel, timeout) => new Promise((resolve) => {
    const t0 = performance.now(); let present = null;
    const tick = () => {
      const el = document.querySelector(sel);
      if (el && present === null) present = performance.now();
      if (el && present !== null) { requestAnimationFrame((ts) => resolve({ present, shown: ts, ok: true })); return; }
      if (performance.now() - t0 > timeout) { resolve({ present: null, shown: null, ok: false }); return; }
      requestAnimationFrame(tick);
    };
    tick();
  });
})();`;

async function newSession(context, label) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  if (NET !== 'none') await cdp.send('Network.emulateNetworkConditions', NETS[NET]);
  const s = { label, page, cdp, net: [], ws: [], metrics: [], marks: [], errors: [], failed: [] };
  (globalThis.__live ??= []).push(s);
  page.on('requestfinished', async (req) => { try { const sizes = await req.sizes(); const t = req.timing(); const res = await req.response(); s.net.push({ url: req.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 140), method: req.method(), status: res?.status(), type: req.resourceType(), startWall: t.startTime, endWall: t.responseEnd >= 0 ? t.startTime + t.responseEnd : null, resBytes: sizes.responseBodySize, reqBytes: sizes.requestBodySize, fromCache: undefined }); } catch {} });
  page.on('requestfailed', (req) => s.failed.push({ url: req.url().slice(0, 120), err: req.failure()?.errorText }));
  page.on('websocket', (w) => { w.on('framesent', (f) => s.ws.push({ dir: 'out', wall: Date.now(), len: (f.payload || '').length, head: String(f.payload).slice(0, 70) })); w.on('framereceived', (f) => s.ws.push({ dir: 'in', wall: Date.now(), len: (f.payload || '').length, head: String(f.payload).slice(0, 70) })); });
  page.on('pageerror', (e) => s.errors.push(e.message));
  s.poller = setInterval(async () => {
    try { const m = await cdp.send('Performance.getMetrics'); const o = Object.fromEntries(m.metrics.map((x) => [x.name, x.value])); s.metrics.push({ wall: Date.now(), task: o.TaskDuration, script: o.ScriptDuration, layout: o.LayoutDuration, style: o.RecalcStyleDuration, heap: o.JSHeapUsedSize }); } catch {}
  }, 100);
  return s;
}

async function newContext(browser, seed) {
  const ctx = await browser.newContext(isPhone ? devices['iPhone 14 landscape'] : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((sd) => { localStorage.setItem('hasSeenWelcome', '1'); for (const [k, v] of Object.entries(sd || {})) localStorage.setItem(k, v); }, seed);
  await ctx.addInitScript(COLLECTOR);
  return ctx;
}

const act = (loc) => (isPhone ? loc.tap({ timeout: 8000 }) : loc.click({ timeout: 8000 }));
const actForce = (loc) => (isPhone ? loc.tap({ force: true, timeout: 4000 }) : loc.click({ force: true, timeout: 4000 }));

/** Tap an element, then wait for the next screen. Records the tap time, first frame of the next screen, and the page-clock origin. */
async function tapAndWait(s, label, locator, waitSel, timeout = 20000) {
  const origin = await s.page.evaluate(() => performance.timeOrigin);
  let how = 'tap';
  try { await act(locator); } catch { how = 'force'; try { await actForce(locator); } catch (e) { s.marks.push({ label, ok: false, err: String(e).slice(0, 100), origin }); return null; } }
  const tapT = await s.page.evaluate(() => window.__t.taps.at(-1)?.t ?? null);
  const r = await s.page.evaluate(([sel, to]) => window.__waitVisible(sel, to), [waitSel, timeout]);
  const m = { label, how, origin, tapT, presentT: r.present, shownT: r.shown, ok: r.ok };
  s.marks.push(m);
  return m;
}

const nowMark = async (s, label) => { const o = await s.page.evaluate(() => [performance.timeOrigin, performance.now()]); s.marks.push({ label, origin: o[0], tapT: o[1], shownT: o[1], ok: true, point: true }); };

async function loadPage(s, url) {
  const t0 = Date.now();
  await s.page.goto(url, { waitUntil: 'load' });
  await s.page.waitForTimeout(1500);
  return Date.now() - t0;
}

async function enterPvf(s) {
  const p = s.page;
  await tapAndWait(s, 'home: Single Player', p.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first(), '.sp-page, .pvf-root, [class*="sp-"]');
  await tapAndWait(s, 'hub: Play vs Fritz', p.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first(), '.pvf-tier-name');
  await tapAndWait(s, 'tier: Rookie', p.locator('.pvf-tier-name', { hasText: 'Rookie' }).filter({ visible: true }).first(), '.pvf-start, button, .pvf-root');
  const start = p.getByText('Start Match', { exact: false }).filter({ visible: true }).first();
  await start.waitFor({ state: 'visible', timeout: 15000 });
  for (let i = 0; i < 40 && !(await start.isEnabled().catch(() => false)); i++) await p.waitForTimeout(250);
  await tapAndWait(s, 'start: Start Match -> match screen', start, '.bot-match-screen, .game-screen', 30000);
}

async function enterDaily(s) {
  // Deep link (the dev-only auth shim does not cover the home card, which opens the sign-in modal): measured from the Daily Fritz screen.
  const p = s.page;
  const start = p.locator('.df-pvf-start-btn');
  await start.waitFor({ state: 'visible', timeout: 30000 });
  for (let i = 0; i < 80 && !(await start.isEnabled().catch(() => false)); i++) await p.waitForTimeout(100);
  await nowMark(s, 'daily: Start button enabled (ms since navigation start)');
  await p.waitForTimeout(500);
  await tapAndWait(s, 'start: Daily Fritz -> match screen', start, '.bot-match-screen.bot-match-mode-daily-fritz', 40000);
}

async function enterMp(host, guest) {
  for (const s of [host, guest]) {
    const m = await tapAndWait(s, 'home: Multiplayer', s.page.getByText('Multiplayer', { exact: false }).filter({ visible: true }).first(), '.mp-topbar__status-text', 15000);
    if (!m || !m.ok) { await s.page.goto(BASE + '/multiplayer'); await s.page.locator('.mp-topbar__status-text').first().waitFor({ timeout: 30000 }); s.marks.push({ label: 'deep link fallback /multiplayer (home Multiplayer tap not available on this layout)', ok: true, point: true, origin: null, tapT: 0, shownT: 0 }); }
  }
  for (const s of [host, guest]) {
    for (let i = 0; i < 120; i++) { const txt = await s.page.locator('.mp-topbar__status-text').first().textContent().catch(() => ''); if (/\d+\s+online/i.test(txt ?? '')) break; await s.page.waitForTimeout(250); }
    await nowMark(s, 'mp: socket connected (ms since navigation start)');
  }
  for (const s of [host, guest]) { const t = s.page.getByRole('tab', { name: /Private/i }); const b = s.page.getByRole('button', { name: /^Private$/i }); await tapAndWait(s, 'mp: Private', (await t.isVisible().catch(() => false)) ? t : b, '[role=tab], .pml-root, .claude-mode-join-box, .pml-panel-footer', 15000); }
  await tapAndWait(host, 'mp: Create lobby tab', host.page.getByRole('tab', { name: /Create lobby/i }), '.pml-panel-footer', 15000);
  await tapAndWait(host, 'mp: Create lobby -> room code', host.page.locator('.pml-panel-footer').getByRole('button', { name: /^Create lobby/i }), '.pml-roomcode-bar-code', 20000);
  const code = (await host.page.locator('.pml-roomcode-bar-code').innerText()).trim().toUpperCase();
  await tapAndWait(guest, 'mp: Join lobby tab', guest.page.getByRole('tab', { name: /Join lobby/i }), 'input[placeholder="ROOM CODE"]', 15000);
  await guest.page.getByPlaceholder('ROOM CODE').fill(code);
  await tapAndWait(guest, 'mp: Join -> in room', guest.page.locator('.claude-mode-join-box').getByRole('button', { name: /^Join$/i }), '.pml-roomcode-bar-code', 30000);
  const start = host.page.getByRole('button', { name: /Start Match/i });
  await start.waitFor({ state: 'visible', timeout: 60000 });
  for (let i = 0; i < 80 && !(await start.isEnabled().catch(() => false)); i++) await host.page.waitForTimeout(250);
  await host.page.waitForTimeout(3000);
  await Promise.all([
    tapAndWait(host, 'mp: Start Match -> match screen (host)', start, '.game-screen', 45000),
    guest.page.evaluate(() => window.__waitVisible('.game-screen', 45000)).then((r) => guest.marks.push({ label: 'mp: match screen (guest, host tapped Start)', origin: null, ok: r.ok, shownT: r.shown, presentT: r.present, tapT: null, guestWait: true })),
  ]);
}

async function preDraw(s) {
  const p = s.page;
  const pickable = p.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = p.locator('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile').first();
  for (let i = 0; i < 60; i++) {
    if (await hand.isVisible().catch(() => false)) return;
    if (await pickable.isVisible().catch(() => false)) await act(pickable).catch(() => actForce(pickable).catch(() => {}));
    await p.waitForTimeout(150);
  }
}

async function step(s) {
  const p = s.page;
  const playable = p.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile), .wl-hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  const zone = p.locator('.placement-zone.active').first();
  const boneyard = p.locator('[class*="boneyard"]').first();
  if ((await playable.count().catch(() => 0)) > 0) {
    await actForce(playable).catch(() => {});
    if (await zone.isVisible({ timeout: 1200 }).catch(() => false)) await actForce(zone).catch(() => {});
    return 'play';
  }
  if (await boneyard.isVisible().catch(() => false)) { await actForce(boneyard).catch(() => {}); return 'draw'; }
  return 'idle';
}

const isOver = (p) => p.getByText(/Victory|Defeat|Match Complete|Final Score/).first().isVisible().catch(() => false);

async function playLoop(sessions) {
  const t0 = Date.now(); let steps = 0; let hands = 0; let lastHandOver = false; let lastProg = ''; let lastAt = Date.now();
  while (Date.now() - t0 < BUDGET) {
    for (const s of sessions) {
      if (await isOver(s.page)) { await s.page.waitForTimeout(1500); return { reason: 'result', steps, hands }; }
      const ho = await s.page.getByTestId('hand-over-modal').isVisible().catch(() => false);
      if (ho) { if (!lastHandOver && s === sessions[0]) { hands++; } lastHandOver = true; await s.page.waitForTimeout(300); continue; }
      if (s === sessions[0]) lastHandOver = false;
      if (hands >= MAX_HANDS) { await s.page.waitForTimeout(6000); return { reason: 'maxHands', steps, hands }; }
      if ((await step(s)) !== 'idle') steps++;
    }
    await sessions[0].page.waitForTimeout(250);
    const prog = await sessions[0].page.evaluate(() => `${document.querySelectorAll('.board-tile-wrapper, .domino-tile.board-tile').length}|${(document.querySelector('[role=status],[aria-live]')?.textContent ?? '').trim().slice(0, 60)}`).catch(() => lastProg);
    if (prog !== lastProg) { lastProg = prog; lastAt = Date.now(); } else if (Date.now() - lastAt > 120000) return { reason: 'wedged:' + prog, steps, hands };
  }
  return { reason: 'budget', steps, hands };
}

async function dump(s) {
  clearInterval(s.poller);
  const t = await s.page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map((r) => ({ n: r.name.replace(/^https?:\/\/[^/]+/, '').slice(0, 120), it: r.initiatorType, s: r.startTime, e: r.responseEnd, ds: r.domainLookupStart, cs: r.connectStart, rq: r.requestStart, rs: r.responseStart, enc: r.encodedBodySize, dec: r.decodedBodySize, tr: r.transferSize }));
    return { ...window.__t, now: performance.now(), origin: performance.timeOrigin, nav: nav ? { rs: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, tr: nav.transferSize, enc: nav.encodedBodySize, dec: nav.decodedBodySize } : null, res };
  });
  return { label: s.label, perf: t, net: s.net, ws: s.ws, metrics: s.metrics, marks: s.marks, errors: s.errors, failed: s.failed };
}

// Hard watchdog: if anything hangs (a frozen page makes page.evaluate wait forever), dump what we have and exit.
setTimeout(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const res = { mode: MODE, base: BASE, profile: PROFILE, cpu: CPU, net: NET, watchdog: true, outcome: result.outcome, endText: result.endText, runs: [...(result.runs ?? [])] };
  for (const s of (globalThis.__live ?? []).filter((x) => !res.runs.some((r) => r.label === x.label))) {
    clearInterval(s.poller);
    const partial = { label: s.label, hung: true, net: s.net, ws: s.ws, metrics: s.metrics, marks: s.marks, errors: s.errors, failed: s.failed };
    const full = await Promise.race([dump(s).catch(() => null), sleep(8000).then(() => null)]);
    res.runs.push(full ?? partial);
    try { await Promise.race([s.page.screenshot({ path: OUT.replace(/\.json$/, `-${s.label}-hung.png`), timeout: 5000 }), sleep(6000)]); } catch {}
  }
  fs.writeFileSync(OUT, JSON.stringify(res));
  console.log('WATCHDOG fired, wrote partial', OUT);
  process.exit(3);
}, BUDGET + 360000).unref();

const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const result = { mode: MODE, base: BASE, profile: PROFILE, cpu: CPU, net: NET, cache: CACHE, startedAt: new Date().toISOString(), runs: [] };
try {
  if (MODE === 'load') {
    const ctx = await newContext(browser, {});
    if (CACHE === 'warm') { const w = await newSession(ctx, 'prime'); await loadPage(w, BASE + '/'); clearInterval(w.poller); await w.page.close(); }
    const s = await newSession(ctx, `load-${CACHE}`);
    if (args.cpuprofile) { await s.cdp.send('Profiler.enable'); await s.cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await s.cdp.send('Profiler.start'); }
    if (args.early) { await s.page.goto(BASE + '/', { waitUntil: 'commit' }); await s.page.waitForSelector('text=Single Player', { state: 'attached', timeout: 20000 }); await s.page.waitForFunction(() => window.__t && window.__t.reactReady != null, null, { timeout: 20000, polling: 'raf' }); }
    else await loadPage(s, BASE + '/');
    // First tap: tap Single Player as soon as it exists (what a user does first) and time the next screen.
    if (args.revisit) {
      await tapAndWait(s, 'first tap: Single Player', s.page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first(), '.sp-page, .pvf-root, [class*="sp-"]', 20000);
      await tapAndWait(s, 'first tap: Play vs Fritz', s.page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first(), '.pvf-tier-name', 20000);
      for (let k = 2; k <= 3; k++) {
        await s.page.goBack(); await s.page.goBack(); await s.page.waitForTimeout(1500);
        await tapAndWait(s, `visit ${k}: Single Player`, s.page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first(), '.sp-page, .pvf-root, [class*="sp-"]', 20000);
        await tapAndWait(s, `visit ${k}: Play vs Fritz`, s.page.getByText('Play vs Fritz', { exact: false }).filter({ visible: true }).first(), '.pvf-tier-name', 20000);
      }
      result.runs.push(await dump(s)); throw new Error('__revisit_done__');
    }
    const m = await tapAndWait(s, 'first tap: Single Player', s.page.getByText(/^(Single Player|Solo)$/).filter({ visible: true }).first(), '.sp-page, .pvf-root, [class*="sp-"]', 20000);
    if (args.cpuprofile) { const pr = (await s.cdp.send('Profiler.stop')).profile; fs.writeFileSync(OUT.replace(/\.json$/, '.cpuprofile'), JSON.stringify(pr)); }
    result.runs.push(await dump(s));
  } else {
    const seed = MODE === 'daily' ? { racehorse_e2e_user_id: crypto.randomUUID(), racehorse_e2e_bearer: 'e2e-daily-fritz' } : {};
    const mkSeed = (r) => ({ racehorse_guest_identity_v1: `guest_trans_${r}_${Date.now()}`, racehorse_guest_display_name_v1: `Guest ${r === 'a' ? '3333' : '4444'}` });
    if (MODE === 'mp') {
      const cA = await newContext(browser, mkSeed('a')); const cB = await newContext(browser, mkSeed('b'));
      const host = await newSession(cA, 'host-cold'); const guest = await newSession(cB, 'guest-cold');
      await Promise.all([loadPage(host, BASE + '/'), loadPage(guest, BASE + '/')]);
      await enterMp(host, guest);
      await Promise.all([preDraw(host), preDraw(guest)]);
      result.outcome = await playLoop([host, guest]);
      await nowMark(host, 'end of play');
      result.runs.push(await dump(host), await dump(guest));
      // warm-cache second entry: new pages, same contexts (HTTP cache warm).
      await Promise.all([host.page.close(), guest.page.close()]);
      for (const c of [cA, cB]) await c.addInitScript(() => { try { localStorage.removeItem('racehorse_last_room_code'); } catch {} });
      const h2 = await newSession(cA, 'host-warm'); const g2 = await newSession(cB, 'guest-warm');
      await Promise.all([loadPage(h2, BASE + '/'), loadPage(g2, BASE + '/')]);
      await enterMp(h2, g2);
      await Promise.all([preDraw(h2), preDraw(g2)]);
      await h2.page.waitForTimeout(3000);
      result.runs.push(await dump(h2), await dump(g2));
    } else {
      const ctx = await newContext(browser, seed);
      const s = await newSession(ctx, `${MODE}-cold`);
      await loadPage(s, BASE + (MODE === 'daily' ? '/daily-fritz' : '/'));
      if (MODE === 'daily') await enterDaily(s); else await enterPvf(s);
      await preDraw(s);
      if (args.cpuprofile) { await s.cdp.send('Profiler.enable'); await s.cdp.send('Profiler.setSamplingInterval', { interval: 300 }); await s.cdp.send('Profiler.start'); }
      result.outcome = await playLoop([s]);
      if (args.cpuprofile) { const pr = (await s.cdp.send('Profiler.stop')).profile; fs.writeFileSync(OUT.replace(/\.json$/, '.cpuprofile'), JSON.stringify(pr)); }
      await nowMark(s, 'end of play');
      result.endText = await s.page.evaluate(() => document.body.innerText.slice(0, 500)).catch(() => null);
      await s.page.screenshot({ path: OUT.replace(/\.json$/, '-end.png'), timeout: 8000 }).catch(() => {});
      result.runs.push(await dump(s));
      await s.page.close();
      const w = await newSession(ctx, `${MODE}-warm`);
      await loadPage(w, BASE + (MODE === 'daily' ? '/daily-fritz' : '/'));
      if (MODE === 'daily') await enterDaily(w); else await enterPvf(w);
      await preDraw(w);
      await w.page.waitForTimeout(3000);
      result.runs.push(await dump(w));
    }
  }
} catch (e) {
  if (!String(e).includes('__revisit_done__')) {
    result.fatal = String(e?.stack || e).slice(0, 600);
    for (const s of globalThis.__live ?? []) { await s.page.screenshot({ path: OUT.replace(/\.json$/, `-fatal-${s.label}.png`), timeout: 5000 }).catch(() => {}); result.fatalText = (result.fatalText ?? []).concat(await s.page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => '')); }
  }
}
finally { fs.writeFileSync(OUT, JSON.stringify(result)); await browser.close(); }
console.log('wrote', OUT, result.fatal ? `FATAL ${result.fatal.slice(0, 300)}` : JSON.stringify(result.outcome ?? 'ok'));
process.exit(0);
