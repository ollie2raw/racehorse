#!/usr/bin/env node
/** Summarise one lagHarness run: node scripts/perf/analyzeRun.mjs run.json [--json] */
import fs from 'node:fs';

const file = process.argv[2];
const run = JSON.parse(fs.readFileSync(file, 'utf8'));
const q = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const out = { file, mode: run.mode, cpu: run.cpu, profile: run.profile, outcome: run.playOutcome, fatal: run.fatal?.slice(0, 200), sessions: [] };

for (const s of run.sessions) {
  const P = s.perf;
  const o = {};
  o.role = s.role;
  o.durationSec = r1(P.now / 1000);
  // Long tasks
  const lt = P.longtasks;
  o.longTasks = { count: lt.length, totalMs: r1(lt.reduce((a, x) => a + x.d, 0)), maxMs: r1(Math.max(0, ...lt.map((x) => x.d))), over100: lt.filter((x) => x.d > 100).length, over200: lt.filter((x) => x.d > 200).length };
  // Long animation frames with script attribution; join to long tasks by overlap
  const loaf = P.loaf.filter((f) => f.d >= 50);
  const byScript = {};
  for (const f of loaf) for (const sc of f.scripts) { const k = `${sc.type}|${sc.inv}|${sc.src}|${sc.fn}`; byScript[k] = byScript[k] || { n: 0, ms: 0 }; byScript[k].n++; byScript[k].ms += sc.d; }
  o.loaf = { count: loaf.length, maxMs: r1(Math.max(0, ...loaf.map((f) => f.d))), blockingMs: r1(loaf.reduce((a, f) => a + f.block, 0)),
    scriptTime: r1(loaf.reduce((a, f) => a + f.scripts.reduce((b, x) => b + x.d, 0), 0)), renderTime: r1(loaf.reduce((a, f) => a + (f.renderStart != null ? f.d - f.renderStart : 0), 0)),
    topScripts: Object.entries(byScript).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8).map(([k, v]) => ({ k, n: v.n, ms: r1(v.ms) })) };
  // INP-style: worst duration per interaction id
  const per = {};
  for (const e of P.events) { const c = per[e.id]; if (!c || e.d > c.d) per[e.id] = e; }
  const ds = Object.values(per).map((e) => e.d);
  o.interactions = { n: ds.length, p50: r1(q(ds, 50)), p75: r1(q(ds, 75)), p98: r1(q(ds, 98)), max: r1(Math.max(0, ...ds)), over100: ds.filter((d) => d > 100).length, over200: ds.filter((d) => d > 200).length,
    inputDelayP75: r1(q(Object.values(per).map((e) => e.inDelay), 75)), processingP75: r1(q(Object.values(per).map((e) => e.proc), 75)),
    note: 'event-timing entries <16 ms are not reported, so quantiles are of interactions >=16 ms (upper bound on typical)' };
  // Frames
  const total = P.frameCount; const slow = P.frames.filter((f) => f.dt > 25); const jank = P.frames.filter((f) => f.dt > 50);
  o.frames = { total, over25ms: slow.length, over50ms: jank.length, over100ms: P.frames.filter((f) => f.dt > 100).length, worstMs: r1(Math.max(0, ...P.frames.map((f) => f.dt))), pctSlow: r1((100 * slow.length) / Math.max(1, total)) };
  // Tap -> own board paint; bot placements
  const taps = P.taps.filter((t) => t.kind === 'pointerdown');
  const own = []; const bot = []; let lastOwnPaint = null;
  const isOwnPlacement = (b) => (P.hand || []).some((h) => h.h < h.prev && Math.abs(h.t - b.t) <= 200);
  s.ownPlacements = [];
  for (const b of P.board) {
    if (b.c <= b.prev) continue;
    const tap = [...taps].reverse().find((t) => t.t <= b.t && b.t - t.t < 1500);
    if (isOwnPlacement(b) && tap) { own.push(b.t - tap.t); lastOwnPaint = b.t; s.ownPlacements.push({ abs: P.origin + tap.t, paintAbs: P.origin + b.t }); }
    else if (lastOwnPaint != null) bot.push({ afterOwnMs: b.t - lastOwnPaint, t: b.t });
  }
  o.tapToBoardPaintMs = { n: own.length, p50: r1(q(own, 50)), p75: r1(q(own, 75)), p95: r1(q(own, 95)), max: r1(Math.max(0, ...own)), note: 'pointerdown -> rAF frame where the board tile count rose (frame start; real paint ~1 frame later)' };
  const bd = bot.map((b) => b.afterOwnMs);
  o.ownPaintToBotTilePaintMs = { n: bd.length, p50: r1(q(bd, 50)), p75: r1(q(bd, 75)), p95: r1(q(bd, 95)), max: r1(Math.max(0, ...bd)) };
  // Long tasks and slow frames inside "bot windows" (own paint -> bot paint)
  const wins = []; { let lastOwn = null; for (const b of P.board) { if (b.c <= b.prev) continue; const tap = [...taps].reverse().find((t) => t.t <= b.t && b.t - t.t < 1500); if (isOwnPlacement(b) && tap) lastOwn = b.t; else if (lastOwn != null) { wins.push([lastOwn, b.t]); lastOwn = null; } } }
  const botMs = (s.logs || []).map((l) => /([\d.]+)ms/.exec(l.t)).filter(Boolean).map((m) => Number(m[1]));
  o.chooseBotMoveMs = { n: botMs.length, p50: r1(q(botMs, 50)), p90: r1(q(botMs, 90)), max: r1(Math.max(0, ...botMs)), over50: botMs.filter((x) => x > 50).length, over100: botMs.filter((x) => x > 100).length };
  const inWin = (t) => wins.some(([a, b]) => t >= a && t <= b);
  o.botWindows = { n: wins.length, totalMs: r1(wins.reduce((a, [x, y]) => a + (y - x), 0)), longTasksInWindows: lt.filter((x) => inWin(x.s)).length, longTaskMsInWindows: r1(lt.filter((x) => inWin(x.s)).reduce((a, x) => a + x.d, 0)), slowFramesInWindows: slow.filter((f) => inWin(f.t)).length };
  // Commits
  const commits = P.commits; const ownTapCount = Math.max(1, own.length + bd.length);
  o.reactCommits = { total: commits.length, perPlacedTile: r1(commits.length / ownTapCount), idleCommitsPerSec: null };
  if (commits[0]?.names) { const agg = {}; for (const c of commits) for (const [n, v] of Object.entries(c.names)) agg[n] = (agg[n] || 0) + v; o.reactCommits.topRerenders = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 15); o.reactCommits.avgRenderedFibersPerCommit = r1(commits.reduce((a, c) => a + c.n, 0) / Math.max(1, commits.length)); }
  // Heap & CDP metrics
  const gcs = s.samples.filter((x) => x.label === 'start' || x.label.startsWith('end-gc'));
  const gcMid = s.samples.filter((x) => x.label.includes('gc@'));
  o.heapMB = { startAfterGc: r1(s.samples.find((x) => x.label === 'start')?.heapUsed / 1e6), midGcs: gcMid.map((x) => [x.label.split('gc@')[1], r1(x.heapUsed / 1e6)]), endAfterGc: r1(s.samples.find((x) => x.label === 'end-gc')?.heapUsed / 1e6), nodesStart: s.samples[0]?.nodes, nodesEnd: s.samples.find((x) => x.label === 'end-gc')?.nodes, listenersStart: s.samples[0]?.listeners, listenersEnd: s.samples.find((x) => x.label === 'end-gc')?.listeners };
  const a = s.samples.find((x) => x.label === 'start'); const b = s.samples.find((x) => x.label === 'end');
  if (a && b) { const wall = (b.wall - a.wall) / 1000; o.mainThread = { wallSec: r1(wall), taskSec: r1(b.task - a.task), scriptSec: r1(b.script - a.script), layoutSec: r1(b.layout - a.layout), styleSec: r1(b.style - a.style), busyPct: r1((100 * (b.task - a.task)) / wall) }; }
  // Network
  const net = s.net.filter((n) => !/\.(js|css|woff2?|webp|png|jpg|svg|ico|map)(\?|$)/.test(n.url) || false);
  const asset = s.net.filter((n) => /\.(js|css|woff2?|webp|png|jpg|svg|ico)(\?|$)/.test(n.url));
  const groups = {}; for (const n of net) { const k = `${n.method} ${n.url.split('?')[0].replace(/[0-9a-f-]{8,}/g, ':id')}`; const g = (groups[k] = groups[k] || { n: 0, bytes: 0, maxDur: 0, status: new Set() }); g.n++; g.bytes += n.resBytes || 0; g.maxDur = Math.max(g.maxDur, n.dur || 0); g.status.add(n.status); }
  o.network = { apiRequests: net.length, assetRequests: asset.length, assetBytesKB: r1(asset.reduce((a, n) => a + (n.resBytes || 0), 0) / 1024), groups: Object.entries(groups).sort((x, y) => y[1].n - x[1].n).slice(0, 14).map(([k, v]) => ({ k, n: v.n, KB: r1(v.bytes / 1024), maxMs: r1(v.maxDur), status: [...v.status].join(',') })) };
  if (run.postGameWindow) { const pg = s.net.filter((n) => n.wall >= run.postGameWindow.fromWall - 20000); o.network.lastSecondsBeforeAndAfterGameOver = Object.entries(pg.reduce((acc, n) => { const k = `${n.method} ${n.url.split('?')[0]}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 12); }
  o.websocket = { frames: s.ws.length, out: s.ws.filter((w) => w.dir === 'out').length, in: s.ws.filter((w) => w.dir === 'in').length, bytes: s.ws.reduce((a, w) => a + w.len, 0), topMessages: Object.entries(s.ws.reduce((acc, w) => { const k = w.head.replace(/[0-9a-f-]{8,}/g, ':id').slice(0, 40); acc[k] = (acc[k] || 0) + 1; return acc; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 8) };
  o.pageErrors = s.errors.length;
  out.sessions.push(o);
}
// Multiplayer: host own-placement tap -> guest board paint (client-observed action propagation incl. server hop), and vice versa.
if (run.sessions.length === 2) {
  const [A, B] = run.sessions;
  const prop = (from, to) => { const ds = []; for (const p of from.ownPlacements ?? []) { const b = to.perf.board.find((x) => x.c > x.prev && to.perf.origin + x.t > p.abs && to.perf.origin + x.t - p.abs < 3000 && !(to.ownPlacements ?? []).some((o) => Math.abs(o.paintAbs - (to.perf.origin + x.t)) < 5)); if (b) ds.push(to.perf.origin + b.t - p.abs); } return { n: ds.length, p50: r1(q(ds, 50)), p75: r1(q(ds, 75)), p95: r1(q(ds, 95)), max: r1(Math.max(0, ...ds)) }; };
  out.mpPropagationMs = { hostToGuest: prop(A, B), guestToHost: prop(B, A) };
  // True socket numbers from websocket frames (same process clock): ack RTT per game:action and out -> other side's state:update.
  const ackRtt = (S, ev) => { const ds = []; const outs = new Map(); for (const w of S.ws) { if (w.dir === 'out') { const m = new RegExp(`^42(\\d+)\\["${ev}"`).exec(w.head); if (m) outs.set(m[1], w.wall); } else { const m = /^43(\d+)\[/.exec(w.head); if (m && outs.has(m[1])) { ds.push(w.wall - outs.get(m[1])); outs.delete(m[1]); } } } return { n: ds.length, p50: r1(q(ds, 50)), p75: r1(q(ds, 75)), p95: r1(q(ds, 95)), max: r1(Math.max(0, ...ds)) }; };
  const stateLag = (from, to, ev) => { const ds = []; const ins = to.ws.filter((w) => w.dir === 'in' && /^42\["state:update"/.test(w.head)).map((w) => w.wall); for (const w of from.ws) { if (w.dir !== 'out' || !new RegExp(`^42\\d*\\["${ev}"`).test(w.head)) continue; const n = ins.find((t) => t >= w.wall - 2 && t < w.wall + 5000); if (n != null) ds.push(n - w.wall); } return { n: ds.length, p50: r1(q(ds, 50)), p75: r1(q(ds, 75)), p95: r1(q(ds, 95)), max: r1(Math.max(0, ...ds)) }; };
  out.mpSocket = { actionAckRttHost: ackRtt(A, 'game:action'), actionAckRttGuest: ackRtt(B, 'game:action'), handReadyAckHost: ackRtt(A, 'hand:ready'), actionToOtherPlayersStateUpdateMs: { hostToGuest: stateLag(A, B, 'game:action'), guestToHost: stateLag(B, A, 'game:action') } };
}
console.log(JSON.stringify(out, null, 1));
