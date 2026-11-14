#!/usr/bin/env node
/**
 * CPU-profile a running server's main thread: send SIGUSR1 to the server pid first (opens the inspector on :9229), then
 *   node scripts/perf/serverProfile.mjs <seconds> <out.cpuprofile> [inspectorPort]
 * Prints top self-time functions and per-file totals.
 */
import fs from 'node:fs';

const [seconds = '60', out = 'server.cpuprofile', port = '9229'] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 500 });
await send('Profiler.start');
console.log('profiling for', seconds, 's');
await new Promise((r) => setTimeout(r, Number(seconds) * 1000));
const { result } = await send('Profiler.stop');
fs.writeFileSync(out, JSON.stringify(result.profile));
const p = result.profile; const byId = new Map(p.nodes.map((n) => [n.id, n]));
const self = new Map(); const dt = p.timeDeltas;
for (let i = 0; i < p.samples.length; i++) self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (dt[i] ?? 0));
const fn = new Map(); const file = new Map(); let total = 0;
for (const [nid, us] of self) { const n = byId.get(nid); const cf = n.callFrame; const k = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber}`; fn.set(k, (fn.get(k) ?? 0) + us); const f = cf.url.replace(/^.*\/server\//, 'server/') || '(native)'; file.set(f, (file.get(f) ?? 0) + us); total += us; }
const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${(v / 1000).toFixed(0).padStart(7)} ms  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`);
console.log(`total sampled ${(total / 1e6).toFixed(1)} s`);
console.log('--- top self-time functions\n' + top(fn, 25).join('\n'));
console.log('--- top files\n' + top(file, 15).join('\n'));
ws.close();
