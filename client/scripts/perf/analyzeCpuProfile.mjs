#!/usr/bin/env node
/** node scripts/perf/analyzeCpuProfile.mjs run.cpuprofile [regex-of-function-names-to-report-inclusive] */
import fs from 'node:fs';

const file = process.argv[2];
const watch = new RegExp(process.argv[3] ?? 'captureReviewSnapshot|toCoreGameState|ReviewSnapshotRecorder|recordPlayerDecision|recordBotDecision|recordActorDecision|createReviewPositionSnapshot|persistDailyFritzSnapshot|serializeDailyFritzCheckpointForServer|saveDailyFritzCheckpoint|stringify|setItem|chooseBotMove|analy[sz]e', 'i');
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
const self = new Map(); const incl = new Map(); let total = 0; let idle = 0;
const cache = new Map();
const chain = (id) => { let c = cache.get(id); if (c) return c; const names = []; let cur = id; while (cur != null) { const n = nodes.get(cur); names.push(name(n)); cur = parent.get(cur); } c = [...new Set(names)]; cache.set(id, c); return c; };
for (let i = 0; i < p.samples.length; i++) {
  const us = p.timeDeltas[i] ?? 0; const id = p.samples[i]; const n = nodes.get(id);
  const fn = n.callFrame.functionName;
  if (fn === '(idle)') { idle += us; continue; }
  total += us;
  const k = name(n); self.set(k, (self.get(k) ?? 0) + us);
  for (const nm of chain(id)) incl.set(nm, (incl.get(nm) ?? 0) + us);
}
const ms = (v) => (v / 1000).toFixed(0).padStart(7);
console.log(`file ${file}\nwall ${(((p.endTime - p.startTime)) / 1e6).toFixed(1)} s, non-idle JS ${(total / 1e6).toFixed(1)} s, idle ${(idle / 1e6).toFixed(1)} s`);
console.log('--- top self time');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(ms(v), 'ms', (100 * v / total).toFixed(1).padStart(5) + '%', k);
console.log('--- inclusive time for watched functions');
for (const [k, v] of [...incl].filter(([k]) => watch.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(ms(v), 'ms', (100 * v / total).toFixed(1).padStart(5) + '%', k);
console.log('--- top inclusive (app code)');
for (const [k, v] of [...incl].filter(([k]) => !/^\((root|program|garbage)/.test(k) && !/node_modules|vendor-react|react-dom/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(ms(v), 'ms', (100 * v / total).toFixed(1).padStart(5) + '%', k);
