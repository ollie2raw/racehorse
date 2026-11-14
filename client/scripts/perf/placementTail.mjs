#!/usr/bin/env node
/** Classify slow own placements: does the tile end a hand/game? node scripts/perf/placementTail.mjs run.json [sessionIdx=0] [slowMs=100] */
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = run.runs[Number(process.argv[3] ?? 0)];
const slowMs = Number(process.argv[4] ?? 100);
const P = S.perf;
const sig = P.sig;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : null; };
const modalTimes = []; for (let i = 1; i < sig.length; i++) if (sig[i - 1].s[6] === 0 && sig[i].s[6] > 0) modalTimes.push(sig[i].t);
const resultT = (sig.find((x) => (x.s[8] & 16) > 0) ?? sig.find((x) => (x.s[8] & 32) > 0))?.t;
const boardInc = []; for (let i = 1; i < sig.length; i++) if (sig[i].s[5] > sig[i - 1].s[5]) boardInc.push(sig[i].t);
const tileTaps = P.taps.filter((x) => x.d.includes('domino-tile') || x.d.includes('placement-zone'));
const rows = [];
for (let i = 1; i < sig.length; i++) {
  if (!(sig[i].s[3] < sig[i - 1].s[3])) continue;
  const hd = sig[i].t;
  const tap = [...tileTaps].reverse().find((x) => x.t <= hd && hd - x.t < 400);
  const bt = boardInc.find((x) => x >= hd - 60 && x <= hd + 150);
  if (!tap || bt == null) continue;
  const emptiesHand = sig[i].s[3] === 0;
  const nextModal = modalTimes.find((m) => m >= bt);
  const endsHand = nextModal != null && nextModal - bt < 2600 && nextModal - bt > 300;
  const endsGame = resultT != null && resultT - bt < 2600 && resultT >= bt - 50;
  rows.push({ ms: bt - tap.t, at: bt, endsHand, endsGame, emptiesHand });
}
const ending = rows.filter((r) => r.endsHand || r.endsGame);
const normal = rows.filter((r) => !(r.endsHand || r.endsGame));
const fmt = (a) => `n=${a.length} p50 ${Math.round(q(a.map((r) => r.ms), 50) ?? 0)} p95 ${Math.round(q(a.map((r) => r.ms), 95) ?? 0)} max ${Math.round(Math.max(0, ...a.map((r) => r.ms)))}`;
console.log(`all placements: ${fmt(rows)}`);
console.log(`  mid-hand placements: ${fmt(normal)}`);
console.log(`  hand/game-ending placements: ${fmt(ending)} (hands ${modalTimes.length})`);
const slow = rows.filter((r) => r.ms > slowMs);
console.log(`placements > ${slowMs} ms: ${slow.length}; of those, hand/game-ending: ${slow.filter((r) => r.endsHand || r.endsGame).length}; mid-hand: ${slow.filter((r) => !(r.endsHand || r.endsGame)).map((r) => Math.round(r.ms)).join(', ')}`);
