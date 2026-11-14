#!/usr/bin/env node
/** Print the state-signature timeline around a time window: node scripts/perf/dumpSig.mjs run.json sessionIdx fromSec toSec|end [lastNSecondsBeforeEnd] */
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = run.runs[Number(process.argv[3] ?? 0)];
const P = S.perf;
const lastSig = P.sig[P.sig.length - 1].t;
let a = Number(process.argv[4]) * 1000;
let b = process.argv[5] === 'end' ? lastSig + 1 : Number(process.argv[5]) * 1000;
if (process.argv[4] === 'tail') { a = lastSig - Number(process.argv[5]) * 1000; b = lastSig + 1; }
console.log('[match,slots,pick,hand,play,board,handOver,zones,flags] flags: 1=you go first 2=fritz first 4=tap to draw 8=remaining tiles 16=victory/defeat 32=match complete/final score');
for (const x of P.sig.filter((y) => y.t >= a && y.t <= b)) console.log(`${(x.t / 1000).toFixed(2).padStart(8)} s  ${x.s.join(',')}`);
console.log('taps:', P.taps.filter((x) => x.t >= a && x.t <= b).map((x) => `${(x.t / 1000).toFixed(2)}:${x.d.slice(0, 22)}`).join(' | '));
