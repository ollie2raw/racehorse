#!/usr/bin/env node
/** Summarise repeated early-tap load runs: node scripts/perf/earlySummary.mjs <dir> <prefix> (e.g. early-phone) */
import fs from 'node:fs';
import path from 'node:path';

const [dir, prefix] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.json') && !f.includes('.sum'));
const rows = [];
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const s = r.runs?.[0];
  if (!s?.perf) continue;
  const P = s.perf;
  const m = s.marks.find((x) => x.label.startsWith('first tap'));
  const tap = m?.tapT;
  const longAtTap = P.longtasks.filter((x) => tap != null && x.s <= tap + 30 && x.s + x.d >= tap - 30).sort((a, b) => b.d - a.d)[0];
  rows.push({ f, reactReady: P.reactReady, fcp: P.paint['first-contentful-paint'], lcp: P.lcp?.t, tapAt: tap, tapToHub: m?.shownT != null ? m.shownT - tap : null, longAtTapMs: longAtTap?.d ?? 0, tbt: P.longtasks.filter((x) => x.s > (P.paint['first-contentful-paint'] ?? 0)).reduce((a, x) => a + Math.max(0, x.d - 50), 0) });
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const col = (k) => rows.map((r) => r[k]).filter((x) => x != null);
const fmt = (a) => (a.length ? `min ${Math.round(Math.min(...a))} p50 ${Math.round(q(a, 50))} max ${Math.round(Math.max(...a))} [${a.map((x) => Math.round(x)).join(', ')}]` : 'n/a');
console.log(prefix, 'runs', rows.length);
for (const k of ['fcp', 'lcp', 'reactReady', 'tapAt', 'tapToHub', 'longAtTapMs', 'tbt']) console.log(' ', k.padEnd(12), fmt(col(k)));
