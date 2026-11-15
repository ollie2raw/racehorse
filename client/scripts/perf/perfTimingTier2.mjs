#!/usr/bin/env node
/**
 * Tier 2 perf timings: REPORT ONLY (always exits 0). Wall-clock timings depend on the runner, so these are measured (median of 3, one retry for a
 * run that errors), compared with the provisional limits in perf-budgets.json, written as JSON for the trend artifact and as a step summary.
 * A timing becomes blocking only after ten PRs of CI data have set a limit of about 2.5x the CI p95 (docs/perf-budget.md).
 *
 *   node scripts/perf/perfTimingTier2.mjs [--out result.json] [--summary summary.md]
 *
 * Needs client/dist (`npm run build --prefix client`) and server/dist (`npm run build --prefix server`), and Playwright's chromium.
 *   pvf:  transitionHarness.mjs --mode pvf --profile phone --maxHands 1 (iPhone 14 landscape, 4x CPU, 10 Mbps / 150 ms), 3 runs: tap-to-first-frame for home -> hub and
 *         Start Match -> match, and the cold first contentful paint.
 *   mp:   the built server on the stub at 290 ms with MP_HAND_BOUNDARY_FAST=true, 3 runs x 2 hand boundaries: the second player's hand:ready ack and the time both are dealt.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBoundaryScenario } from './mpMatchDriver.mjs';
import { clientDir, here, median, repoDir, serverEnv, spawnService, stop, waitForHttp } from './perfCommon.mjs';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const limits = JSON.parse(fs.readFileSync(path.join(here, 'perf-budgets.json'), 'utf8')).tier2;
const rows = [];
const raw = {};

const withRetry = async (label, fn) => {
  try { return await fn(); } catch (error) {
    console.warn(`${label} failed (${error instanceof Error ? error.message.split('\n')[0] : error}); retrying once`);
    return fn();
  }
};

function add(id, label, values) {
  const value = median(values);
  const limit = limits[id]?.max;
  rows.push({ id, label, value, values, limit, over: Number.isFinite(value) && limit != null && value > limit });
  console.log(`${label}: median ${Math.round(value)} ms of [${values.map((v) => Math.round(v)).join(', ')}]${limit != null ? ` (limit ${limit}, report only)` : ''}`);
}

const STUB_PORT = 54399;
const SERVER_PORT = 3001;
let stub = null;
let server = null;
let statics = null;
try {
  // ── pvf, phone, cold ──
  statics = spawnService('static', process.execPath, [path.join(here, 'staticServer.mjs'), path.join(clientDir, 'dist'), '5431'], { cwd: clientDir });
  await waitForHttp('http://127.0.0.1:5431/', { child: statics });
  const homeToHub = [];
  const startToMatch = [];
  const fcp = [];
  for (let i = 1; i <= 3; i += 1) {
    await withRetry(`pvf run ${i}`, async () => {
      const out = path.join(os.tmpdir(), `perf-tier2-pvf-${process.pid}-${i}.json`);
      execFileSync(process.execPath, [path.join(here, 'transitionHarness.mjs'), '--mode', 'pvf', '--profile', 'phone', '--maxHands', '1', '--base', 'http://127.0.0.1:5431', '--out', out], { cwd: clientDir, stdio: 'ignore', timeout: 300_000 });
      const run = JSON.parse(fs.readFileSync(out, 'utf8'));
      const marks = run.runs[0].marks;
      const t = (prefix) => { const m = marks.find((x) => String(x.label).startsWith(prefix)); return m ? m.shownT - m.tapT : NaN; };
      homeToHub.push(t('home: Single Player'));
      startToMatch.push(t('start: Start Match'));
      const summary = JSON.parse(execFileSync(process.execPath, [path.join(here, 'analyzeTransitions.mjs'), out], { cwd: clientDir, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }));
      fcp.push(summary.sessions?.[0]?.load?.fcp ?? NaN);
      raw[`pvf${i}`] = { homeToHub: homeToHub.at(-1), startToMatch: startToMatch.at(-1), fcp: fcp.at(-1) };
    });
  }
  add('pvfHomeToHubMsPhoneCold', 'Play vs Fritz: home -> hub, phone cold (tap to first frame)', homeToHub);
  add('pvfStartMatchToMatchMsPhoneCold', 'Play vs Fritz: Start Match -> match, phone cold', startToMatch);
  add('coldLoadFcpMsPhone', 'Cold load: first contentful paint, phone', fcp);
  await stop(statics);
  statics = null;

  // ── mp hand boundary at 290 ms ──
  stub = spawnService('stub', process.execPath, [path.join(here, 'supabaseStub.mjs'), String(STUB_PORT), '290']);
  await waitForHttp(`http://127.0.0.1:${STUB_PORT}/__stats`, { child: stub });
  server = spawnService('server', process.execPath, [path.join(repoDir, 'server', 'dist', 'index.js')], { env: serverEnv({ stubPort: STUB_PORT, port: SERVER_PORT, fastFlag: true }), cwd: path.join(repoDir, 'server') });
  await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/ping`, { child: server });
  const secondAck = [];
  const dealt = [];
  for (let i = 1; i <= 3; i += 1) {
    await withRetry(`mp run ${i}`, async () => {
      const run = await runBoundaryScenario({ server: `http://127.0.0.1:${SERVER_PORT}`, boundaries: 2, order: ['guest-first', 'host-first'], gapMs: 10 });
      if (!run.boundaries.length) throw new Error('no hand boundary reached');
      secondAck.push(median(run.boundaries.map((b) => b.secondAckMs)));
      dealt.push(median(run.boundaries.map((b) => b.dealtMs)));
      raw[`mp${i}`] = run.boundaries.map((b) => ({ order: b.order, secondAckMs: b.secondAckMs, dealtMs: b.dealtMs }));
    });
  }
  add('mpSecondAckMsAt290', 'Multiplayer: second player hand:ready ack at 290 ms DB latency (flag on)', secondAck);
  add('mpDealtMsAt290', 'Multiplayer: both players dealt the next hand, from the first tap (flag on, 290 ms)', dealt);
} finally {
  await stop(statics, server, stub);
}

const summary = [
  '### Perf timings (Tier 2, report only)',
  '',
  '| timing | median | runs | provisional limit |',
  '|---|---|---|---|',
  ...rows.map((r) => `| ${r.label} | ${Math.round(r.value)} ms | ${r.values.map((v) => Math.round(v)).join(', ')} | ${r.limit ?? '-'} ms${r.over ? ' **over (not blocking)**' : ''} |`),
].join('\n');
console.log(`\n${summary}`);
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ at: new Date().toISOString(), sha: process.env.GITHUB_SHA ?? null, rows, raw }, null, 1));
if (args.summary) fs.writeFileSync(args.summary, `${summary}\n`);
process.exit(0);
