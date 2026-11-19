#!/usr/bin/env node
// Interleaved run matrix (round-robin over variants per run index so slow drift hits all variants alike).
// node runMatrix.mjs --mode scene|app --runs 5 [--variants none,SEL,tA,...] [--moves 14]
// Before every single run it checks for another agent's browser/harness and waits (up to 40 min total) when one is present.
import { execSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const MODE = args.mode ?? 'scene', RUNS = Number(args.runs ?? 3), MOVES = args.moves ?? '14';
const variants = (args.variants ?? 'none,SEL,tA,tB,tC,bA,bB,bC').split(',');
const busy = () => {
  try {
    const out = execSync('ps aux | grep -E "playwright|chromium|headless|vite|eventsHarness|expHarness|tsx src/index" | grep -v grep | grep -v variantHarness | grep -v staticServer || true', { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch { return false; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let waited = 0;
for (let run = 1; run <= RUNS; run++) {
  for (const v of variants) {
    while (busy() && waited < 40 * 60_000) { console.log('other agent busy, waiting 30s'); await sleep(30_000); waited += 30_000; }
    const out = path.join(here, '..', 'results', `${MODE}-${v}-r${run}.json`);
    const r = spawnSync('node', [path.join(here, 'variantHarness.mjs'), '--mode', MODE, '--variant', v, '--run', String(run), '--out', out, '--moves', MOVES], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '/Users/olivermorid/racehorse-dominoes/node_modules' }, timeout: 600_000 });
    console.log(`[${MODE} run ${run}] ${v}:`, (r.stdout || r.stderr || '').trim().split('\n').pop());
  }
}
