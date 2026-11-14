#!/usr/bin/env node
/** HTTP /ping latency probe: node scripts/perf/pingProbe.mjs http://localhost:3001 out.json [intervalMs] [durationSec] */
import fs from 'node:fs';
const [base = 'http://localhost:3001', out = 'ping.json', interval = '250', dur = '3600'] = process.argv.slice(2);
const samples = [];
const end = Date.now() + Number(dur) * 1000;
let stop = false;
process.on('SIGTERM', () => { stop = true; });
process.on('SIGINT', () => { stop = true; });
while (Date.now() < end && !stop) {
  const t0 = performance.now();
  let ok = true;
  try { const r = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(5000) }); await r.text(); ok = r.ok; } catch { ok = false; }
  samples.push({ wall: Date.now(), ms: performance.now() - t0, ok });
  await new Promise((r) => setTimeout(r, Number(interval)));
}
fs.writeFileSync(out, JSON.stringify(samples));
