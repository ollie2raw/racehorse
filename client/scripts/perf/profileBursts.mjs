#!/usr/bin/env node
/** Contiguous busy bursts in a V8 cpuprofile (main-thread stalls): node scripts/perf/profileBursts.mjs run.cpuprofile [minBurstMs=40] */
import fs from 'node:fs';

const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const minMs = Number(process.argv[3] ?? 40);
const nodes = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const nm = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`;
const bursts = [];
let cur = null;
let t = p.startTime;
for (let i = 0; i < p.samples.length; i++) {
  t += p.timeDeltas[i];
  const n = nodes.get(p.samples[i]);
  const idle = n.callFrame.functionName === '(idle)';
  if (!idle) {
    if (!cur) cur = { start: t, end: t, self: new Map(), incl: new Map() };
    cur.end = t;
    const us = p.timeDeltas[i + 1] ?? 500;
    const leaf = nm(n);
    cur.self.set(leaf, (cur.self.get(leaf) ?? 0) + us);
    let id = p.samples[i];
    const seen = new Set();
    while (id != null) {
      const k = nm(nodes.get(id));
      if (!seen.has(k)) { seen.add(k); cur.incl.set(k, (cur.incl.get(k) ?? 0) + us); }
      id = parent.get(id);
    }
  } else if (cur && t - cur.end > 3000) {
    bursts.push(cur);
    cur = null;
  }
}
if (cur) bursts.push(cur);
const big = bursts.filter((b) => (b.end - b.start) / 1000 >= minMs).sort((a, b) => (b.end - b.start) - (a.end - a.start));
const durs = bursts.map((b) => (b.end - b.start) / 1000).sort((a, b) => a - b);
console.log('bursts', bursts.length, 'p50', durs[Math.floor(durs.length / 2)]?.toFixed(1), 'p95', durs[Math.floor(durs.length * 0.95)]?.toFixed(1), 'max', durs[durs.length - 1]?.toFixed(1), `>=${minMs}ms: ${big.length}`);
const agg = new Map();
for (const b of big) for (const [k, v] of b.incl) if (!/^\((root|program|garbage)/.test(k) && !/node:internal\/(process|timers|main)/.test(k)) agg.set(k, (agg.get(k) ?? 0) + v);
console.log('--- inclusive time inside the long bursts (all summed)');
for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(String((v / 1000).toFixed(0)).padStart(7), 'ms', k);
console.log('--- longest bursts: duration, top self function');
for (const b of big.slice(0, 8)) {
  const top = [...b.self].sort((x, y) => y[1] - x[1])[0];
  console.log(((b.end - b.start) / 1000).toFixed(0).padStart(5), 'ms', top[0], (top[1] / 1000).toFixed(0) + 'ms');
}
