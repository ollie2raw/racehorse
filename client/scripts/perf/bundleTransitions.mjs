#!/usr/bin/env node
/** Summarise Phase 1b runs into docs/: node scripts/perf/bundleTransitions.mjs <runsDir> <perfTmpDir> <outDir> */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [runsDir, tmpDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const node = (script, ...a) => execFileSync('node', [path.join(here, script), ...a], { maxBuffer: 1 << 28 }).toString();
const runs = ['load-desktop-cold', 'load-desktop-warm', 'load-phone-cold', 'load-phone-warm', 'load-phone-slow-cold', 'pvf-desktop', 'pvf-phone', 'daily-desktop', 'daily-phone-quiet', 'mp-desktop-lat290', 'mp-phone-lat290'];
for (const name of runs) {
  const f = path.join(runsDir, `${name}.json`);
  if (!fs.existsSync(f)) continue;
  const sum = node('analyzeTransitions.mjs', f);
  fs.writeFileSync(path.join(outDir, `${name}.summary.json`), sum);
  fs.writeFileSync(path.join(outDir, `${name}.txt`), execFileSync('node', [path.join(here, 'viewTransitions.mjs'), path.join(outDir, `${name}.summary.json`)], { maxBuffer: 1 << 28 }));
  if (/^(pvf|daily|mp)/.test(name)) fs.writeFileSync(path.join(outDir, `${name}.placement-tail.txt`), node('placementTail.mjs', f, '0', '100'));
}
fs.writeFileSync(path.join(outDir, 'early-tap-summary.txt'), node('earlySummary.mjs', runsDir, 'early-phone') + node('earlySummary.mjs', runsDir, 'early-desktop'));
const rv = ['desktop', 'phone'].map((p) => {
  const f = path.join(tmpDir, `t-revisit-${p}.json`);
  if (!fs.existsSync(f)) return '';
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  return `${p}:\n` + r.runs[0].marks.map((m) => `  ${m.label.padEnd(28)} ${Math.round(m.shownT - m.tapT)} ms`).join('\n') + '\n';
}).join('');
fs.writeFileSync(path.join(outDir, 'suspense-revisit-experiment.txt'), rv);
console.log(fs.readdirSync(outDir).length, 'files in', outDir);
