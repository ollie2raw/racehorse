#!/usr/bin/env node
// node summarize.mjs scene|app  -> prints a markdown table (median [min-max] over runs) and writes results/summary-<mode>.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? 'scene';
const dir = path.join(here, '..', 'results');
const files = fs.readdirSync(dir).filter((f) => f.startsWith(mode + '-') && f.endsWith('.json') && !f.includes('fatal'));
const rows = {};
for (const f of files) { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r.fatal) continue; (rows[r.variant] ??= []).push(r); }
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return NaN; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cell = (a, d = 1) => { const v = a.filter((x) => x != null && Number.isFinite(x)); return v.length ? `${med(v).toFixed(d)} [${Math.min(...v).toFixed(d)}-${Math.max(...v).toFixed(d)}]` : 'n/a'; };
const order = ['none', 'SEL', 'tA', 'tB', 'tC', 'bA', 'bB', 'bC'];
const metrics = [
  ['n', (r) => 1, 0],
  ['task ms', (r) => r.cdp.TaskDuration, 0],
  ['style recalc ms', (r) => r.cdp.RecalcStyleDuration, 1],
  ['style share of task %', (r) => r.styleShare * 100, 1],
  ['layout ms', (r) => r.cdp.LayoutDuration, 1],
  ['trace paint ms', (r) => r.trace.paintMs, 1],
  ['trace raster ms (all workers)', (r) => r.trace.rasterMs, 0],
  ['trace style ms', (r) => r.trace.styleMs, 1],
  ['long tasks (n)', (r) => r.longtasks.n, 1],
  ['long task total ms', (r) => r.longtasks.totalMs, 0],
  ['INP proxy worst ms', (r) => r.inp.worst, 0],
  ['INP proxy p75 ms', (r) => r.inp.p75, 0],
  ['frames', (r) => r.frames.n, 0],
  ['frames over 25 ms', (r) => r.frames.over25, 1],
  ['frames over 50 ms', (r) => r.frames.over50, 1],
  ['frame p95 ms', (r) => r.frames.p95, 1],
  ['own moves', (r) => r.own, 0],
];
const use = order.filter((v) => rows[v]);
let md = `### ${mode} (median [min-max] over runs)\n\n| metric | ${use.join(' | ')} |\n|---|${use.map(() => '---').join('|')}|\n`;
for (const [name, fn, d] of metrics) {
  if (name === 'n') { md += `| runs | ${use.map((v) => rows[v].length).join(' | ')} |\n`; continue; }
  if (name === 'own moves' && mode === 'scene') continue;
  md += `| ${name} | ${use.map((v) => cell(rows[v].map(fn), d)).join(' | ')} |\n`;
}
// Normalised task time per frame (scene) or per own move (app): comparable across unequal game lengths.
const norm = mode === 'scene' ? ['task ms per frame', (r) => r.cdp.TaskDuration / r.frames.n] : ['task ms per own move', (r) => r.cdp.TaskDuration / Math.max(1, r.own)];
md += `| ${norm[0]} | ${use.map((v) => cell(rows[v].map(norm[1]), 2)).join(' | ')} |\n`;
const base = med(rows.none?.map(norm[1]) ?? []);
md += `| ${norm[0]} vs none | ${use.map((v) => (Number.isFinite(base) ? ((med(rows[v].map(norm[1])) / base - 1) * 100).toFixed(1) + '%' : 'n/a')).join(' | ')} |\n`;
if (mode === 'app') {
  // Window length differs per game (Fritz thinking time at 4x), so also normalise per frame (about per 17 ms of wall time).
  for (const [label, fn] of [['task ms per frame', (r) => r.cdp.TaskDuration / r.frames.n], ['style recalc ms per frame', (r) => r.cdp.RecalcStyleDuration / r.frames.n]]) {
    md += `| ${label} | ${use.map((v) => cell(rows[v].map(fn), 3)).join(' | ')} |\n`;
    const b = med(rows.none?.map(fn) ?? []);
    md += `| ${label} vs none | ${use.map((v) => ((med(rows[v].map(fn)) / b - 1) * 100).toFixed(1) + '%').join(' | ')} |\n`;
    const s = med(rows.SEL?.map(fn) ?? []);
    md += `| ${label} vs SEL | ${use.map((v) => ((med(rows[v].map(fn)) / s - 1) * 100).toFixed(1) + '%').join(' | ')} |\n`;
  }
}
fs.writeFileSync(path.join(dir, `summary-${mode}.md`), md);
console.log(md);
