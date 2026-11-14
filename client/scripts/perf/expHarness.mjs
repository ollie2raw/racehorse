#!/usr/bin/env node
/**
 * Perceived-lag measurement harness (Phase 1: measurement only, no app changes).
 *
 *   node scripts/perf/lagHarness.mjs --mode pvf|daily|mp --base http://localhost:5312 \
 *        [--cpu 4] [--profile phone|desktop] [--maxMoves 400] [--attrib] [--cpuprofile] --out run.json
 *
 * Drives a real Chromium through a game with CDP CPU throttling and records, in-page:
 * long tasks, long-animation-frames (with script attribution), event timing (INP), frame deltas,
 * tap->board-paint latency, React commits (via a DevTools-hook stub), plus CDP Performance metrics,
 * JS heap, network requests and websocket frames. Needs a client built with the e2e dev-auth gate
 * for --mode daily, and a server started the way playwright.config.ts starts it.
 */
import fs from 'node:fs';
import { chromium, devices } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : [])));
const MODE = args.mode ?? 'pvf';
const BASE = args.base ?? 'http://localhost:5312';
const CPU = Number(args.cpu ?? 1);
const PROFILE = args.profile ?? 'desktop';
const MAX_MOVES = Number(args.maxMoves ?? 5000);
const ATTRIB = Boolean(args.attrib);
const CPUPROFILE = Boolean(args.cpuprofile);
const OUT = args.out ?? `run-${MODE}-${PROFILE}-${CPU}x.json`;
const TIER = args.tier ?? 'Rookie';
const isPhone = PROFILE === 'phone';
const PAUSE = Boolean(args.pauseInfinite);
const ANIM = Boolean(args.animSample);

const COLLECTOR = `(() => {
  const P = (window.__perf = { longtasks: [], loaf: [], events: [], frames: [], taps: [], board: [], commits: [], names: {}, frameCount: 0 });
  const obs = (type, opts, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch {} };
  obs('longtask', {}, (e) => P.longtasks.push({ s: e.startTime, d: e.duration }));
  obs('long-animation-frame', {}, (e) => P.loaf.push({ s: e.startTime, d: e.duration, block: e.blockingDuration,
    renderStart: e.renderStart ? e.renderStart - e.startTime : null, styleLayout: e.styleAndLayoutStart ? e.styleAndLayoutStart - e.startTime : null,
    scripts: (e.scripts || []).map((s) => ({ type: s.invokerType, inv: s.invoker, src: (s.sourceURL || '').split('/').pop(), fn: s.sourceFunctionName, d: s.duration, forced: s.forcedStyleAndLayoutDuration })) }));
  obs('event', { durationThreshold: 16 }, (e) => { if (e.interactionId) P.events.push({ n: e.name, s: e.startTime, d: e.duration, id: e.interactionId, inDelay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); });
  const tapSel = '.domino-tile, .placement-zone, [class*="boneyard"]';
  const tap = (kind) => (ev) => { const t = ev.target && ev.target.closest && ev.target.closest(tapSel); if (t) P.taps.push({ t: performance.now(), kind, cls: String(t.className).slice(0, 60) }); };
  addEventListener('pointerdown', tap('pointerdown'), true);
  P.hand = []; let lastHand = 0;
  let last = performance.now(); let lastCount = 0;
  const count = () => document.querySelectorAll('.board-tile-wrapper, .domino-tile.board-tile').length;
  const loop = (ts) => {
    P.frameCount++; const dt = ts - last; last = ts; if (dt > 20) P.frames.push({ t: ts, dt });
    const c = count(); if (c !== lastCount) { P.board.push({ t: ts, c, prev: lastCount }); lastCount = c; }
    const h = document.querySelectorAll('.hand-area .domino-tile:not(.board-tile), .wl-hand-area .domino-tile:not(.board-tile)').length; if (h !== lastHand) { P.hand.push({ t: ts, h, prev: lastHand }); lastHand = h; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  const PAUSE = ${PAUSE}; const ANIM = ${ANIM}; P.anim = [];
  if (PAUSE || ANIM) setInterval(() => {
    const all = document.getAnimations();
    const inf = all.filter((a) => { try { return a.effect.getComputedTiming().iterations === Infinity; } catch { return false; } });
    if (ANIM) { const by = {}; for (const a of all) { const n = a.animationName || ('transition:' + a.transitionProperty); const k = n + (inf.includes(a) ? ' [inf]' : ''); by[k] = (by[k] || 0) + 1; } P.anim.push({ t: performance.now(), total: all.length, inf: inf.length, by }); }
    if (PAUSE) inf.forEach((a) => { try { a.pause(); } catch {} });
  }, 1000);
  P.gbcr = { n: 0, ms: 0, slow: 0, byCaller: {} };
  { const orig = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function () { const t0 = performance.now(); const r = orig.call(this); const d = performance.now() - t0; P.gbcr.n++; P.gbcr.ms += d; if (d > 2) P.gbcr.slow++;
      if (P.gbcr.n % 10 === 0) { const st = (new Error().stack || '').split(String.fromCharCode(10))[2] || ''; const k = st.trim().slice(-80); const c = (P.gbcr.byCaller[k] = P.gbcr.byCaller[k] || { n: 0, ms: 0 }); c.n++; c.ms += d; }
      return r; }; }
  const attrib = ${ATTRIB};
  const nameOf = (f) => { const t = f.type; return (t && (t.displayName || t.name)) || (t && t.render && (t.render.displayName || t.render.name)) || (t && t.type && (t.type.displayName || t.type.name)) || null; };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(), inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onCommitFiberRoot(id, root) { const rec = { t: performance.now(), n: 0 };
      if (attrib) { const names = {}; const walk = (f) => { while (f) { if ((f.tag === 0 || f.tag === 11 || f.tag === 15 || f.tag === 14 || f.tag === 1) && f.alternate && (f.flags & 1)) { const n = nameOf(f); if (n) names[n] = (names[n] || 0) + 1; rec.n++; } if (f.child) walk(f.child); f = f.sibling; } }; walk(root.current); rec.names = names;
        const origins = {}; const walk2 = (f) => { while (f) { if ((f.tag === 0 || f.tag === 11 || f.tag === 15 || f.tag === 14) && f.alternate && (f.flags & 1)) { let h = f.memoizedState; let a = f.alternate.memoizedState; let i = 0; while (h && a) { if (h.queue && h.memoizedState !== a.memoizedState) { const n = nameOf(f) || 'anon'; const k = n + '#' + i; origins[k] = (origins[k] || 0) + 1; } h = h.next; a = a.next; i++; } } if (f.child) walk2(f.child); f = f.sibling; } }; walk2(root.current); rec.origins = origins; }
      P.commits.push(rec); },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
})();`;

async function newSession(browser, seed) {
  const ctxOpts = isPhone ? devices['iPhone 14 landscape'] : { viewport: { width: 1440, height: 900 } };
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript((s) => { localStorage.setItem('hasSeenWelcome', '1'); for (const [k, v] of Object.entries(s || {})) localStorage.setItem(k, v); }, seed);
  await context.addInitScript(COLLECTOR);
  const page = await context.newPage();
  (globalThis.__pages ??= []).push(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const net = []; const ws = [];
  page.on('requestfinished', async (req) => { try { const sizes = await req.sizes(); const t = req.timing(); const res = await req.response(); net.push({ url: req.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 120), method: req.method(), status: res?.status(), type: req.resourceType(), startedAt: t.startTime, dur: t.responseEnd >= 0 ? t.responseEnd : null, resBytes: sizes.responseBodySize, reqBytes: sizes.requestBodySize, wall: Date.now() }); } catch {} });
  page.on('websocket', (w) => { w.on('framesent', (f) => ws.push({ dir: 'out', wall: Date.now(), len: (f.payload || '').length, head: String(f.payload).slice(0, 60) })); w.on('framereceived', (f) => ws.push({ dir: 'in', wall: Date.now(), len: (f.payload || '').length, head: String(f.payload).slice(0, 60) })); });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const logs = []; page.on('console', (m) => { const t = m.text(); if (/chooseBotMove|Fritz/.test(t)) logs.push({ wall: Date.now(), t: t.slice(0, 160) }); });
  return { context, page, cdp, net, ws, errors, logs, samples: [] };
}

async function sample(s, label) {
  const m = await s.cdp.send('Performance.getMetrics');
  const o = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
  const heap = await s.cdp.send('Runtime.getHeapUsage');
  s.samples.push({ label, wall: Date.now(), task: o.TaskDuration, script: o.ScriptDuration, layout: o.LayoutDuration, style: o.RecalcStyleDuration, heapUsed: heap.usedSize, nodes: o.Nodes, listeners: o.JSEventListeners });
}

async function gc(s) { await s.cdp.send('HeapProfiler.collectGarbage'); }

async function startPvf(page) {
  await page.goto(BASE + '/solo/fritz');
  await page.locator('.pvf-tier-name', { hasText: TIER }).filter({ visible: true }).first().click();
  const start = page.getByText('Start Match', { exact: false }).first();
  await start.waitFor({ state: 'visible', timeout: 15000 });
  await start.click();
  await page.locator('.bot-match-screen, .game-screen').first().waitFor({ timeout: 30000 });
}

async function startDaily(page) {
  await page.goto(BASE + '/daily-fritz');
  await page.getByRole('heading', { name: 'Daily Fritz' }).waitFor({ timeout: 30000 });
  const start = page.locator('.df-pvf-start-btn');
  await start.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);
  await start.click();
  await page.locator('.bot-match-screen.bot-match-mode-daily-fritz').waitFor({ timeout: 30000 });
}

async function preDraw(page) {
  const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
  const hand = page.locator('.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile').first();
  for (let i = 0; i < 40; i++) {
    if (await hand.isVisible().catch(() => false)) return;
    if (await pickable.isVisible().catch(() => false)) await pickable.click({ timeout: 4000, force: true }).catch(() => {});
    await page.waitForTimeout(700);
  }
}

/** One driver step. Returns 'play' | 'draw' | 'idle'. */
async function step(page) {
  const playable = page.locator('.hand-area .domino-tile.highlight:not(.disabled):not(.board-tile), .wl-hand-area .domino-tile.highlight:not(.disabled):not(.board-tile)').first();
  const zone = page.locator('.placement-zone.active').first();
  const boneyard = page.locator('[class*="boneyard"]').first();
  const act = (loc) => (isPhone ? loc.tap({ force: true, timeout: 4000 }) : loc.click({ force: true, timeout: 4000 })).catch(() => {});
  if ((await playable.count().catch(() => 0)) > 0) {
    await act(playable);
    if (await zone.isVisible({ timeout: 1500 }).catch(() => false)) await act(zone);
    return 'play';
  }
  if (await boneyard.isVisible().catch(() => false)) { await act(boneyard); return 'draw'; }
  return 'idle';
}

const done = async (page) =>
  (await page.getByRole('dialog', { name: /Play vs Fritz result|result|Daily Fritz/i }).first().isVisible().catch(() => false)) ||
  (await page.getByText(/Victory|Defeat|Match Complete/).first().isVisible().catch(() => false));

async function play(sessions, label) {
  const t0 = Date.now(); let own = 0; let lastProgress = ''; let lastAt = Date.now(); let ticks = 0;
  const [a] = sessions;
  while (Date.now() - t0 < Number(args.budgetMs ?? 900000) && own < MAX_MOVES) {
    ticks++;
    for (const s of sessions) {
      if (await done(s.page)) return { reason: 'result', own };
      const handOver = s.page.getByTestId('hand-over-modal');
      if (await handOver.isVisible().catch(() => false)) { await s.page.waitForTimeout(1200); continue; }
      const r = await step(s.page);
      if (r !== 'idle') { own++; if (own % 3 === 0) { for (const x of sessions) await sample(x, `${label}:move${own}`); } }
      if (own > 0 && own % 12 === 0 && r !== 'idle') for (const x of sessions) await gc(x), await sample(x, `${label}:gc@${own}`);
    }
    await a.page.waitForTimeout(isPhone ? 500 : 400);
    const prog = await a.page.evaluate(() => `${document.querySelectorAll('.board-tile-wrapper, .domino-tile.board-tile').length}|${(document.querySelector('[role=status],[aria-live]')?.textContent ?? '').trim()}`).catch(() => lastProgress);
    if (prog !== lastProgress) { lastProgress = prog; lastAt = Date.now(); } else if (Date.now() - lastAt > 120000) return { reason: 'wedged:' + lastProgress.slice(0, 100), own };
  }
  return { reason: own >= MAX_MOVES ? 'maxMoves' : 'budget', own };
}

async function collect(s) {
  const perf = await s.page.evaluate(() => ({ ...window.__perf, now: performance.now(), origin: performance.timeOrigin }));
  return { perf, net: s.net, ws: s.ws, samples: s.samples, errors: s.errors, logs: s.logs };
}

const browser = await chromium.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const result = { mode: MODE, base: BASE, cpu: CPU, profile: PROFILE, attrib: ATTRIB, startedAt: new Date().toISOString(), sessions: [] };
try {
  if (MODE === 'mp') {
    const mk = (role) => ({ racehorse_guest_identity_v1: `guest_perf_${role}_${Date.now()}`, racehorse_guest_display_name_v1: `Guest ${role === 'a' ? '1111' : '2222'}` });
    const host = await newSession(browser, mk('a')); const guest = await newSession(browser, mk('b'));
    for (const s of [host, guest]) { await s.page.goto(BASE + '/multiplayer'); await s.page.locator('.mp-topbar__status-text').first().waitFor({ timeout: 30000 }); }
    const pickPrivate = async (p) => { const t = p.getByRole('tab', { name: /Private/i }); if (await t.isVisible().catch(() => false)) await t.click(); else await p.getByRole('button', { name: /^Private$/i }).click(); };
    await pickPrivate(host.page);
    await host.page.getByRole('tab', { name: /Create lobby/i }).click();
    await host.page.locator('.pml-panel-footer').getByRole('button', { name: /^Create lobby/i }).click();
    const codeEl = host.page.locator('.pml-roomcode-bar-code'); await codeEl.waitFor({ timeout: 20000 });
    const code = (await codeEl.innerText()).trim().toUpperCase();
    await pickPrivate(guest.page);
    await guest.page.getByRole('tab', { name: /Join lobby/i }).click();
    await guest.page.getByPlaceholder('ROOM CODE').fill(code);
    await guest.page.locator('.claude-mode-join-box').getByRole('button', { name: /^Join$/i }).click();
    await host.page.getByRole('button', { name: /Start Match/i }).waitFor({ timeout: 60000 });
    const startBtn = host.page.getByRole('button', { name: /Start Match/i });
    for (let i = 0; i < 60 && !(await startBtn.isEnabled().catch(() => false)); i++) await host.page.waitForTimeout(500);
    await startBtn.click();
    await Promise.all([host, guest].map((s) => s.page.locator('.game-screen').waitFor({ timeout: 45000 })));
    await Promise.all([host, guest].map((s) => preDraw(s.page)));
    for (const s of [host, guest]) { await gc(s); await sample(s, 'start'); }
    result.playOutcome = await play([host, guest], 'mp');
    for (const s of [host, guest]) { await sample(s, 'end'); await gc(s); await sample(s, 'end-gc'); }
    result.sessions = [{ role: 'host', ...(await collect(host)) }, { role: 'guest', ...(await collect(guest)) }];
  } else {
    const seed = MODE === 'daily' ? { racehorse_e2e_user_id: crypto.randomUUID(), racehorse_e2e_bearer: 'e2e-daily-fritz' } : {};
    const s = await newSession(browser, seed);
    if (CPUPROFILE) { await s.cdp.send('Profiler.enable'); await s.cdp.send('Profiler.setSamplingInterval', { interval: 250 }); }
    if (MODE === 'idle') { await s.page.goto(BASE + '/'); await s.page.waitForTimeout(3000); }
    else if (MODE === 'daily') await startDaily(s.page); else await startPvf(s.page);
    if (MODE !== 'idle') await preDraw(s.page);
    await gc(s); await sample(s, 'start');
    if (CPUPROFILE) await s.cdp.send('Profiler.start');
    result.playOutcome = MODE === 'idle' ? (await s.page.waitForTimeout(25000), { reason: 'idle', own: 0 }) : await play([s], MODE);
    let profile = null;
    if (CPUPROFILE) profile = (await s.cdp.send('Profiler.stop')).profile;
    await sample(s, 'end'); await gc(s); await sample(s, 'end-gc');
    // Post-game window: 25 s of idle observation to catch review enqueue/polling/saves.
    const pgStart = Date.now(); await s.page.waitForTimeout(Number(args.postGameMs ?? 25000));
    result.postGameWindow = { fromWall: pgStart, toWall: Date.now() };
    await sample(s, 'post-game');
    result.sessions = [{ role: 'solo', ...(await collect(s)) }];
    if (profile) fs.writeFileSync(OUT.replace(/\.json$/, '.cpuprofile'), JSON.stringify(profile));
  }
} catch (e) {
  result.fatal = String(e?.stack || e);
  for (const [i, pg] of (globalThis.__pages ?? []).entries()) { try { await pg.screenshot({ path: OUT.replace(/\.json$/, `-fatal${i}.png`) }); result.fatalBody = (result.fatalBody ?? []).concat((await pg.evaluate(() => document.body.innerText)).slice(0, 400)); } catch {} }
}
finally { fs.writeFileSync(OUT, JSON.stringify(result)); await browser.close(); }
console.log(`wrote ${OUT}`, result.fatal ? `FATAL ${result.fatal.slice(0, 300)}` : JSON.stringify(result.playOutcome));
