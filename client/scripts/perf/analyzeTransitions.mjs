#!/usr/bin/env node
/** Summarise a transitionHarness run: node scripts/perf/analyzeTransitions.mjs run.json  (prints JSON) */
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const r0 = (x) => (x == null ? null : Math.round(x));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const out = { file: process.argv[2].split('/').pop(), mode: run.mode, profile: run.profile, cpu: run.cpu, net: run.net, outcome: run.outcome, fatal: run.fatal, sessions: [] };

const union = (iv) => { const s = [...iv].filter((x) => x[1] > x[0]).sort((a, b) => a[0] - b[0]); const o = []; for (const x of s) { if (o.length && x[0] <= o[o.length - 1][1]) o[o.length - 1][1] = Math.max(o[o.length - 1][1], x[1]); else o.push([...x]); } return o; };
const clip = (iv, a, b) => iv.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y > x);
const len = (iv) => iv.reduce((s, [x, y]) => s + (y - x), 0);

for (const S of run.runs) {
  const P = S.perf;
  const origin = P.origin;
  const toPage = (wall) => wall - origin;
  const o = { label: S.label };

  // Network intervals in page clock: fetch/xhr from resource timing (API calls) + websocket acks (out frame -> matching 43<id> ack).
  const api = P.res.filter((x) => (x.it === 'fetch' || x.it === 'xmlhttprequest') && (x.n.includes('/api/') || x.n.includes('socket.io'))).map((x) => ({ n: x.n.split('?')[0], s: x.s, e: x.e, kind: 'http' }));
  const acks = []; { const outs = new Map(); for (const w of S.ws) { if (w.dir === 'out') { const m = /^42(\d+)\["([^"]+)"/.exec(w.head); if (m) outs.set(m[1], { ev: m[2], t: toPage(w.wall) }); } else { const m = /^43(\d+)\[/.exec(w.head); if (m && outs.has(m[1])) { const a = outs.get(m[1]); acks.push({ n: `ws ${a.ev}`, s: a.t, e: toPage(w.wall), kind: 'ws' }); outs.delete(m[1]); } } } }
  const netIv = [...api, ...acks].filter((x) => x.n !== 'ws player:dragging' && !x.n.includes('/socket.io/') && !x.n.includes('/checkpoint') && !x.n.includes('/telemetry'));
  const mainIv = []; // busy main-thread intervals from CDP task-duration deltas (100 ms granularity)
  const busyIn = (a, b) => { let sum = 0; for (let i = 1; i < S.metrics.length; i++) { const m0 = S.metrics[i - 1]; const m1 = S.metrics[i]; const w0 = toPage(m0.wall); const w1 = toPage(m1.wall); const lo = Math.max(a, w0); const hi = Math.min(b, w1); if (hi > lo && w1 > w0) sum += ((m1.task - m0.task) * 1000 * (hi - lo)) / (w1 - w0); } return sum; };
  const metricsIn = (a, b) => { const f = (k) => { let sum = 0; for (let i = 1; i < S.metrics.length; i++) { const m0 = S.metrics[i - 1]; const m1 = S.metrics[i]; const w0 = toPage(m0.wall); const w1 = toPage(m1.wall); const lo = Math.max(a, w0); const hi = Math.min(b, w1); if (hi > lo && w1 > w0) sum += ((m1[k] - m0[k]) * 1000 * (hi - lo)) / (w1 - w0); } return r0(sum); }; return { taskMs: f('task'), scriptMs: f('script'), layoutMs: f('layout'), styleMs: f('style') }; };
  const longIn = (a, b) => P.longtasks.filter((x) => x.s + x.d > a && x.s < b).map((x) => ({ at: r0(x.s - a), ms: r0(x.d) }));
  const reqIn = (a, b) => P.res.filter((x) => x.s >= a && x.s <= b).map((x) => ({ n: x.n.slice(0, 70), it: x.it, at: r0(x.s - a), ms: r0(x.e - x.s), kb: r1((x.enc || x.tr) / 1024) }));
  const split = (a, b) => {
    const dur = b - a; const nets = union(clip(netIv.map((x) => [x.s, x.e]), a, b)); const netMs = len(nets);
    const busy = Math.min(dur, busyIn(a, b)); const residual = Math.max(0, dur - Math.max(netMs, 0) - busy);
    return { totalMs: r0(dur), networkInFlightMs: r0(netMs), mainThreadBusyMs: r0(busy), residualAnimationOrTimerMs: r0(residual), longTasks: longIn(a, b), commits: P.commits.filter((c) => c >= a && c <= b).length, ...metricsIn(a, b), calls: netIv.filter((x) => x.e > a && x.s < b).map((x) => `${x.n} ${r0(x.s - a)}→${r0(x.e - a)}ms`) };
  };

  // --- Load (cold or warm) ---
  if (S.label.startsWith('load') || S.label.endsWith('-cold') || S.label.endsWith('-warm')) {
    const fcp = P.paint['first-contentful-paint']; const res = P.res;
    const pre = res.filter((x) => x.s < (fcp ?? 1e9));
    const bucket = (arr) => { const t = {}; for (const x of arr) { const k = /\.(woff2?)$/.test(x.n) || x.n.includes('/l/font') ? 'font' : /\.(css)$/.test(x.n) || x.n.startsWith('/css2') ? 'css' : /\.js$/.test(x.n) ? 'js' : /\.(webp|png|jpg|jpeg|svg)$/.test(x.n) ? 'image' : /\.(mp3|ogg|wav)$/.test(x.n) ? 'audio' : 'other'; t[k] = t[k] || { n: 0, encKB: 0, decKB: 0, transferKB: 0 }; t[k].n++; t[k].encKB += (x.enc || 0) / 1024; t[k].decKB += (x.dec || 0) / 1024; t[k].transferKB += (x.tr || 0) / 1024; } for (const v of Object.values(t)) for (const k of Object.keys(v)) if (k !== 'n') v[k] = r0(v[k]); return t; };
    o.load = { reactReadyMs: r0(P.reactReady), firstTapAtMs: r0(P.taps[0]?.t), navTTFBms: r0(P.nav?.rs), fcp: r0(fcp), fp: r0(P.paint['first-paint']), lcp: r0(P.lcp?.t), lcpEl: P.lcp?.el, lcpUrl: (P.lcp?.url ?? '').split('/').pop(), domContentLoaded: r0(P.nav?.dcl), loadEvent: r0(P.nav?.load), htmlTransferKB: r1((P.nav?.tr ?? 0) / 1024), cls: r1(P.shifts * 1000) / 1000,
      requestsTotal: res.length, beforeFirstPaint: { n: pre.length, byType: bucket(pre) }, total: bucket(res),
      longTasks: P.longtasks.filter((x) => x.s < 6000).map((x) => ({ at: r0(x.s), ms: r0(x.d) })), totalBlockingMs: r0(P.longtasks.filter((x) => x.s > (fcp ?? 0) && x.s < 6000).reduce((s, x) => s + Math.max(0, x.d - 50), 0)),
      mainThreadFirst3s: metricsIn(0, 3000),
      biggestJs: res.filter((x) => /\.js$/.test(x.n)).sort((a, b) => b.dec - a.dec).slice(0, 6).map((x) => ({ n: x.n.split('/').pop(), encKB: r0(x.enc / 1024), decKB: r0(x.dec / 1024) })) };
    const lastLongBeforeTap = P.longtasks.filter((x) => P.taps[0] && x.s < P.taps[0].t).slice(-1)[0];
    o.load.lastLongTaskEndBeforeFirstTap = lastLongBeforeTap ? r0(lastLongBeforeTap.s + lastLongBeforeTap.d) : null;
  }

  // --- Taps through the menus: tap -> first frame of the next screen ---
  o.menuTaps = S.marks.filter((m) => m.tapT != null && !m.point).map((m) => ({ label: m.label, ok: m.ok, tapToFirstFrameMs: m.shownT != null ? r0(m.shownT - m.tapT) : null, ...(m.shownT != null && m.label !== 'tier: Rookie' ? { requests: reqIn(m.tapT, m.shownT), ...split(m.tapT, m.shownT) } : {}) }));
  o.pointMarks = S.marks.filter((m) => m.point).map((m) => ({ label: m.label, atMs: r0(m.tapT) }));
  o.guestWaits =S.marks.filter((m) => m.guestWait).map((m) => ({ label: m.label, ok: m.ok, shownT: r0(m.shownT) }));

  // --- State-signature timeline ---
  const sig = P.sig; // s: [match, slots, pickable, hand, playable, board, handOverModal, zones, flags]
  const first = (pred, from = 0) => sig.find((x) => x.t >= from && pred(x.s));
  const tMatch = first((s) => s[0] > 0)?.t;
  const matchMark = S.marks.find((m) => /match screen/.test(m.label) && !m.guestWait);
  const tStartTap = matchMark?.tapT;
  if (tMatch != null) {
    const tSlots = first((s) => s[1] > 0, tMatch)?.t;
    const tPick = first((s) => s[2] > 0, tMatch)?.t;
    const pickTap = P.taps.find((x) => x.t >= (tPick ?? 1e12) && x.d.includes('pre-game-draw'));
    const tPhrase = first((s) => (s[8] & 3) > 0, tPick ?? tMatch)?.t;
    const tSlotsGone = first((s) => s[1] === 0, tSlots ?? tMatch)?.t;
    const tHand = first((s) => s[3] > 0, tSlotsGone ?? tMatch)?.t;
    const tPlay = first((s) => s[4] > 0, tHand ?? tMatch)?.t;
    const marks = [['tap Start', tStartTap], ['match screen first frame', matchMark?.shownT ?? tMatch], ['draw tiles visible', tSlots], ['draw tiles pickable (first interactive)', tPick], ['player picks', pickTap?.t], ['"you/Fritz go first" shown', tPhrase], ['draw board gone', tSlotsGone], ['hand on screen', tHand], ['first playable tile', tPlay]];
    o.enterAndPreDraw = { timeline: marks.filter((m) => m[1] != null).map(([l, t]) => ({ step: l, atMsFromTap: tStartTap != null ? r0(t - tStartTap) : null, atMsFromMatchScreen: r0(t - tMatch) })) };
    const seg = (a, b, name) => (a != null && b != null && b > a ? { name, ...split(a, b), anims: P.anims.filter((x) => x.t >= a && x.t <= b).map((x) => x.n).filter((v, i, arr) => arr.indexOf(v) === i), requests: reqIn(a, b).filter((x) => x.it !== 'script' || x.kb > 20).slice(0, 12), imgs: P.res.filter((x) => x.s >= a && x.s <= b && /\.(webp|png|jpg|svg)/.test(x.n)).length } : null);
    o.enterAndPreDraw.segments = [seg(tStartTap ?? tMatch, tPick, 'tap Start → draw pickable'), seg(tPick, pickTap?.t, 'pickable → player picks'), seg(pickTap?.t, tHand, 'pick → hand on screen'), seg(tHand, tPlay, 'hand on screen → first playable')].filter(Boolean);
    o.enterAndPreDraw.tapToFirstPlayableMs = tStartTap != null && tPlay != null ? r0(tPlay - tStartTap) : null;
    o.enterAndPreDraw.nonInteractiveWaitMs = tStartTap != null && tPick != null ? r0(tPick - tStartTap) : null;
    // Board mount: commits and layout/style cost in the first 1.5 s after the match screen appears.
    o.boardMount = { first1500ms: { commits: P.commits.filter((c) => c >= tMatch && c <= tMatch + 1500).length, ...metricsIn(tMatch, tMatch + 1500), longTasks: longIn(tMatch, tMatch + 1500) }, gbcrTotal: P.gbcr };
  }

  // --- Hand ends and game end ---
  const hands = []; let lastBoard = null;
  for (let i = 1; i < sig.length; i++) {
    const a = sig[i - 1].s; const b = sig[i].s; const t = sig[i].t;
    if (b[5] !== a[5]) lastBoard = { t, c: b[5], prev: a[5] };
    if (a[6] === 0 && b[6] > 0) {
      const lastTile = [...sig.slice(0, i + 1)].reverse().find((x, k, arr) => { const nxt = arr[k + 1]; return nxt && x.s[5] > nxt.s[5]; })?.t ?? lastBoard?.t;
      const j = sig.findIndex((x, k) => k > i && x.s[6] === 0);
      const tGone = j > 0 ? sig[j].t : null;
      const tDealt = tGone != null ? sig.find((x) => x.t >= tGone && x.s[3] >= 5)?.t : null;
      const tPlay = tGone != null ? sig.find((x) => x.t >= tGone && x.s[3] >= 5 && x.s[4] > 0)?.t : null;
      const botOpened = tDealt != null && tPlay != null ? sig.some((x) => x.t > tDealt && x.t < tPlay && x.s[5] > 0 && x.s[5] !== sig.find((y) => y.t >= tDealt)?.s[5]) : null;
      const reveal = sig.find((x) => x.t >= t && (x.s[8] & 8) > 0)?.t;
      hands.push({ lastTile, tModal: t, tReveal: reveal, tGone, tDealt, tPlay, botOpened });
    }
  }
  const tResult = (sig.find((x) => (x.s[8] & 16) > 0) ?? sig.find((x) => (x.s[8] & 32) > 0))?.t;
  o.handEnds = hands.map((h, n) => {
    const phases = [['last tile → hand-over modal', h.lastTile, h.tModal], ['modal shown → reveal', h.tModal, h.tReveal], ['modal/reveal → closed', h.tReveal ?? h.tModal, h.tGone], ['closed → next hand dealt', h.tGone, h.tDealt], ['dealt → first playable', h.tDealt, h.tPlay]].map(([name, a, b]) => (a != null && b != null && b > a ? { name, ...split(a, b) } : null)).filter(Boolean);
    const total = h.lastTile != null && h.tPlay != null ? split(h.lastTile, h.tPlay) : null;
    return { n: n + 1, lastTileToFirstPlayableMs: total ? total.totalMs : null, total, botOpened: h.botOpened, phases: phases.map((p) => ({ name: p.name, ms: p.totalMs, net: p.networkInFlightMs, main: p.mainThreadBusyMs, residual: p.residualAnimationOrTimerMs, longTasks: p.longTasks.length, calls: p.calls })) };
  });
  const lastHand = hands[hands.length - 1];
  if (tResult != null) {
    const lastTile = [...sig].reverse().find((x, k, arr) => { const nxt = arr[k + 1]; return nxt && x.s[5] > nxt.s[5] && x.t < tResult; })?.t;
    o.gameEnd = lastTile != null ? { lastTileToResultMs: r0(tResult - lastTile), ...split(lastTile, tResult) } : { note: 'last tile not found' };
    o.gameEnd.afterResultCalls = netIv.filter((x) => x.s >= tResult).slice(0, 12).map((x) => `${x.n} +${r0(x.s - tResult)}ms for ${r0(x.e - x.s)}ms`);
  }

  // --- Placement ---
  // Anchor on the tile leaving the hand: the last tile/zone tap before it is the placement tap; the board increase within [-60, +150] ms of it is its paint.
  const own = []; const boardInc = []; for (let i = 1; i < sig.length; i++) if (sig[i].s[5] > sig[i - 1].s[5]) boardInc.push(sig[i].t);
  const tileTaps = P.taps.filter((x) => x.d.includes('domino-tile') || x.d.includes('placement-zone'));
  for (let i = 1; i < sig.length; i++) {
    if (!(sig[i].s[3] < sig[i - 1].s[3])) continue;
    const hd = sig[i].t;
    const tap = [...tileTaps].reverse().find((x) => x.t <= hd && hd - x.t < 400);
    if (!tap) continue;
    const bt = boardInc.find((x) => x >= hd - 60 && x <= hd + 150);
    if (bt == null) continue;
    own.push({ ms: Math.max(0, bt - tap.t), at: bt, tap: tap.t });
  }
  const lat = own.map((x) => x.ms);
  o.placement = { n: lat.length, p50: r1(q(lat, 50)), p75: r1(q(lat, 75)), p95: r1(q(lat, 95)), p99: r1(q(lat, 99)), max: r1(Math.max(0, ...lat)), over50: lat.filter((x) => x > 50).length, over100: lat.filter((x) => x > 100).length, over300: lat.filter((x) => x > 300).length, note: 'placement tap (tile or zone pointerdown) -> frame where the board tile count rose (frame start; real paint about one frame later)' };
  o.placement.slowest = [...own].sort((a, b) => b.ms - a.ms).slice(0, 6).map((x) => {
    const lt = longIn(x.tap, x.at); const lo = P.loaf.filter((l) => l.s + l.d > x.tap && l.s < x.at).map((l) => ({ d: r0(l.d), block: r0(l.block), scripts: l.scripts.slice(0, 2).map((s) => `${s.type}:${s.src}:${r0(s.d)}`) }));
    const nearBoundary = hands.some((h) => h.tModal != null && Math.abs(h.tModal - x.at) < 2500) ? 'near hand end' : '';
    return { ms: r0(x.ms), atSec: r0(x.at / 1000), longTasks: lt.map((l) => l.ms), loaf: lo.slice(0, 2), commits: P.commits.filter((c) => c >= x.tap && c <= x.at).length, ...(nearBoundary ? { note: nearBoundary } : {}) };
  });
  // The tile-tap -> placement-zone-visible step (two-tap placement): first tap on a tile then zone appears.
  const zoneLat = []; for (let i = 1; i < sig.length; i++) if (sig[i].s[7] > 0 && sig[i - 1].s[7] === 0) { const tap = [...P.taps].reverse().find((x) => x.t <= sig[i].t && sig[i].t - x.t < 1500 && x.d.includes('domino-tile')); if (tap) zoneLat.push(sig[i].t - tap.t); }
  o.zoneAppear = { n: zoneLat.length, p50: r1(q(zoneLat, 50)), p95: r1(q(zoneLat, 95)), max: r1(Math.max(0, ...zoneLat)) };
  // Draw: boneyard tap -> hand count up.
  const drawLat = []; for (let i = 1; i < sig.length; i++) if (sig[i].s[3] > sig[i - 1].s[3] && sig[i - 1].s[3] > 0) { const tap = [...P.taps].reverse().find((x) => x.t <= sig[i].t && sig[i].t - x.t < 2500 && x.d.includes('boneyard')); if (tap) drawLat.push(sig[i].t - tap.t); }
  o.draw = { n: drawLat.length, p50: r1(q(drawLat, 50)), p95: r1(q(drawLat, 95)), max: r1(Math.max(0, ...drawLat)) };
  // Interactions.
  const per = {}; for (const e of P.events) { const c = per[e.id]; if (!c || e.d > c.d) per[e.id] = e; }
  const ds = Object.values(per).map((e) => e.d);
  o.inp = { n: ds.length, p75: r0(q(ds, 75)), p98: r0(q(ds, 98)), max: r0(Math.max(0, ...ds)) };
  o.longTasksTotal = { n: P.longtasks.length, over100: P.longtasks.filter((x) => x.d > 100).length };
  o.errors = S.errors.length; o.failedRequests = S.failed.length;
  out.sessions.push(o);
}
console.log(JSON.stringify(out, null, 1));
