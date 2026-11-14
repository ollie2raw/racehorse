#!/usr/bin/env node
/** Summarise every run in a directory into docs/: node scripts/perf/bundleResults.mjs <runsDir> <outDir> */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [runsDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const keep = ['idle-desktop-1x', 'idle-phone-4x', 'pvf-desktop-1x', 'pvf-phone-4x', 'daily-desktop-1x', 'daily-phone-4x', 'mp-desktop-1x', 'mp-phone-4x', 'prodbuild-pvf-desktop-1x', 'prodbuild-pvf-phone-4x', 'prodbuild-mp-desktop-1x', 'prodbuild-mp-phone-4x', 'prodbuild-mp-desktop-1x-lat290', 'attrib-pvf-phone-4x', 'attrib-daily-phone-4x'];
for (const name of keep) {
  const file = path.join(runsDir, `${name}.json`);
  if (!fs.existsSync(file)) continue;
  fs.writeFileSync(path.join(outDir, `${name}.summary.json`), execFileSync('node', [path.join(here, 'analyzeRun.mjs'), file], { maxBuffer: 1 << 28 }));
}
for (const name of ['exp-anim-inventory', 'exp-anim-paused', 'exp-origins-pvf']) {
  const file = path.join(runsDir, `${name}.json`);
  if (fs.existsSync(file)) fs.writeFileSync(path.join(outDir, `${name}.txt`), execFileSync('node', [path.join(here, 'analyzeExp.mjs'), file]));
}
for (const extra of ['server-mp-phone-profile.txt', 'stub-stats-lat290.json', 'stub-stats-lat0.json']) {
  const file = path.join(runsDir, extra);
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(outDir, extra));
}
console.log(fs.readdirSync(outDir).length, 'files written to', outDir);
