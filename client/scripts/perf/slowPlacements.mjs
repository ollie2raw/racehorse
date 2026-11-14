#!/usr/bin/env node
/** Dump the signature timeline around slow own placements: node scripts/perf/slowPlacements.mjs run.json [sessionIndex=0] [minMs=300] */
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = run.runs[Number(process.argv[3] ?? 0)];
const minMs = Number(process.argv[4] ?? 300);
const P = S.perf;
const sig = P.sig;
const handDrops = [];
for (let i = 1; i < sig.length; i++) if (sig[i].s[3] < sig[i - 1].s[3]) handDrops.push(sig[i].t);
const tileTaps = P.taps.filter((x) => x.d.includes('domino-tile') || x.d.includes('placement-zone'));
let shown = 0;
for (let i = 1; i < sig.length; i++) {
  const a = sig[i - 1].s; const b = sig[i].s; const t = sig[i].t;
  if (!(b[5] > a[5]) || !handDrops.some((h) => Math.abs(h - t) <= 250)) continue;
  const tap = [...tileTaps].reverse().find((x) => x.t <= t && t - x.t < 2000);
  if (!tap || t - tap.t < minMs) continue;
  console.log(`\n--- own placement ${Math.round(t - tap.t)} ms after tap (${tap.d}) at ${(t / 1000).toFixed(1)}s`);
  console.log('taps in window:', P.taps.filter((x) => x.t >= tap.t - 2500 && x.t <= t + 100).map((x) => `${Math.round(x.t - tap.t)}ms ${x.d.slice(0, 40)}`).join(' | '));
  for (const x of sig.filter((y) => y.t >= tap.t - 2500 && y.t <= t + 200)) console.log(`  ${String(Math.round(x.t - tap.t)).padStart(6)} ms  [match,slots,pick,hand,play,board,handOver,zones,flags] = ${x.s.join(',')}`);
  if (++shown >= 3) break;
}
