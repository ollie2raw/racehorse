#!/usr/bin/env node
/** Animation inventory / getBoundingClientRect / state-origin summary for expHarness runs: node scripts/perf/analyzeExp.mjs run.json */
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const s = run.sessions[0];
const P = s.perf;
const r1 = (x) => Math.round(x * 10) / 10;
const a = s.samples.find((x) => x.label === 'start');
const b = s.samples.find((x) => x.label === 'end');
const wall = (b.wall - a.wall) / 1000;
console.log(`run ${process.argv[2].split('/').pop()} outcome ${JSON.stringify(run.playOutcome)} gameSec ${r1(wall)}`);
console.log(`main thread over the game: task ${r1(b.task - a.task)} s (${r1((100 * (b.task - a.task)) / wall)}% busy), style recalc ${r1(b.style - a.style)} s, layout ${r1(b.layout - a.layout)} s, script ${r1(b.script - a.script)} s`);
const lt = P.longtasks;
console.log(`long tasks ${lt.length} (${r1(lt.reduce((x, y) => x + y.d, 0))} ms), >100ms: ${lt.filter((x) => x.d > 100).length}; frames>25ms ${P.frames.filter((f) => f.dt > 25).length} of ${P.frameCount}`);
const per = {};
for (const e of P.events) { const c = per[e.id]; if (!c || e.d > c.d) per[e.id] = e; }
const ds = Object.values(per).map((e) => e.d).sort((x, y) => x - y);
console.log(`INP-ish: n ${ds.length} p75 ${ds[Math.floor(ds.length * 0.75)]} p98 ${ds[Math.floor(ds.length * 0.98)]} max ${ds[ds.length - 1]}; >100ms: ${ds.filter((d) => d > 100).length}`);
console.log(`commits ${P.commits.length}`);
if (P.gbcr) {
  const moves = P.board.filter((x) => x.c > x.prev).length;
  console.log(`getBoundingClientRect: ${P.gbcr.n} calls, ${r1(P.gbcr.ms)} ms total (${r1(P.gbcr.ms / Math.max(1, P.gbcr.n))} ms/call), >2ms: ${P.gbcr.slow}; per board-tile placement: ${r1(P.gbcr.n / Math.max(1, moves))} calls (${moves} placements)`);
  console.log('  sampled callers (every 10th call):');
  for (const [k, v] of Object.entries(P.gbcr.byCaller).sort((x, y) => y[1].n - x[1].n).slice(0, 8)) console.log('   ', v.n * 10, 'calls', k);
}
if (P.anim?.length) {
  const last = P.anim.slice(Math.floor(P.anim.length / 4));
  const avg = (f) => r1(last.reduce((x, y) => x + f(y), 0) / last.length);
  console.log(`animations alive (sampled each second): avg ${avg((y) => y.total)}, infinite ${avg((y) => y.inf)}`);
  const agg = {};
  for (const y of last) for (const [k, v] of Object.entries(y.by)) agg[k] = (agg[k] || 0) + v;
  console.log('  by name (avg alive):', Object.entries(agg).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, v]) => `${k}=${r1(v / last.length)}`).join(', '));
}
const origins = {};
let withOrigins = 0;
for (const c of P.commits) if (c.origins) { withOrigins++; for (const [k, v] of Object.entries(c.origins)) origins[k] = (origins[k] || 0) + v; }
if (withOrigins) {
  console.log(`state origins over ${withOrigins} commits (component#hookIndex whose own state changed):`);
  for (const [k, v] of Object.entries(origins).sort((x, y) => y[1] - x[1]).slice(0, 14)) console.log('   ', String(v).padStart(6), k);
}
