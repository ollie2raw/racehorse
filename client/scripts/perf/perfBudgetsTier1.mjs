#!/usr/bin/env node
/**
 * Tier 1 perf budgets: counts and bytes only, so they do not depend on how fast the machine is. Blocking in CI (.github/workflows/perf-budgets.yml).
 * Thresholds: perf-budgets.json. Policy and rationale: docs/perf-budget.md.
 *
 *   node scripts/perf/perfBudgetsTier1.mjs [--only bundle,mp,daily] [--report-only] [--out result.json] [--summary summary.md]
 *
 * bundle: brotli bytes of the scripts index.html loads before anything renders (needs client/dist from `npm run build --prefix client`).
 * mp:     the built server (server/dist, MP_HAND_BOUNDARY_FAST=true) on the Supabase stub at 290 ms; two sockets play to hand boundaries
 *         (mpMatchDriver.mjs); the stub's timeline gives the room writes the second player awaited and the room-session bytes per boundary.
 * daily:  checkpointPosts.mjs on a production build with the dev-auth gate forced (vite.perf-daily.config.mjs): posts and bytes over 3 hands, phone 4x.
 * A check outside its range (max, and min where set) is run once more; it fails only if both attempts are outside.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { describeBudget, withinBudget } from './budgetCheck.mjs';
import { firstPaintScripts } from './firstPaintAssets.mjs';
import { runBoundaryScenario } from './mpMatchDriver.mjs';
import { boundaryWrites, clientDir, here, median, readTimeline, repoDir, serverEnv, spawnService, stop, waitForHttp } from './perfCommon.mjs';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : [])));
const only = new Set(String(args.only ?? 'bundle,mp,daily').split(','));
const budgets = JSON.parse(fs.readFileSync(path.join(here, 'perf-budgets.json'), 'utf8')).tier1;
const STUB_PORT = 54399;
const SERVER_PORT = 3001;
const results = [];

function record(id, label, unit, attempts, budget, detail = {}) {
  const ok = attempts.some((v) => withinBudget(v, budget)); // fails only if every attempt is outside
  const value = attempts[attempts.length - 1];
  results.push({ id, label, unit, value, attempts, max: budget.max, min: budget.min, ok, ...detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${attempts.map((v) => Math.round(v)).join(' -> ')} ${unit} (budget ${describeBudget(budget)})`);
}

async function withRetry(measure, budget) {
  const attempts = [await measure()];
  if (!withinBudget(attempts[0], budget)) attempts.push(await measure());
  return attempts;
}

// ── bundle ──
function jsBeforeFirstPaint() {
  const dist = path.join(clientDir, 'dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const files = firstPaintScripts(html);
  let bytes = 0;
  for (const file of files) {
    bytes += zlib.brotliCompressSync(fs.readFileSync(path.join(dist, file)), { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }).length;
  }
  return { bytes, files: files.length };
}

if (only.has('bundle')) {
  const m = jsBeforeFirstPaint();
  record('jsBeforeFirstPaintBrotliBytes', 'JS loaded before first paint (brotli)', 'bytes', [m.bytes], budgets.jsBeforeFirstPaintBrotliBytes, { files: m.files });
  // The byte budget alone passes when the parse finds nothing (0 bytes); the file count is pinned on purpose, in perf-budgets.json.
  record('jsBeforeFirstPaintFiles', 'script files loaded before first paint', 'files', [m.files], budgets.jsBeforeFirstPaintFiles);
}

// ── mp + daily need the stub and the built server ──
let stub = null;
let server = null;
let staticDaily = null;
try {
  if (only.has('mp') || only.has('daily')) {
    const timelineFile = path.join(os.tmpdir(), `perf-tier1-timeline-${process.pid}.jsonl`);
    fs.writeFileSync(timelineFile, '');
    stub = spawnService('stub', process.execPath, [path.join(here, 'supabaseStub.mjs'), String(STUB_PORT), '290', timelineFile]);
    await waitForHttp(`http://127.0.0.1:${STUB_PORT}/__stats`, { child: stub });
    server = spawnService('server', process.execPath, [path.join(repoDir, 'server', 'dist', 'index.js')], {
      env: serverEnv({ stubPort: STUB_PORT, port: SERVER_PORT, fastFlag: true }),
      cwd: path.join(repoDir, 'server'),
    });
    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/ping`, { child: server });

    if (only.has('mp')) {
      const measureMp = async () => {
        await fetch(`http://127.0.0.1:${STUB_PORT}/__lat?ms=290`);
        await fetch(`http://127.0.0.1:${STUB_PORT}/__reset`);
        const run = await runBoundaryScenario({ server: `http://127.0.0.1:${SERVER_PORT}`, boundaries: 3, order: ['guest-first', 'host-first', 'guest-first'], gapMs: 10 });
        const timeline = readTimeline(timelineFile);
        const joined = run.boundaries.map((b) => ({ ...b, ...boundaryWrites(b, timeline) }));
        if (joined.length < 2) throw new Error(`only ${joined.length} hand boundary reached (the match ended early); cannot measure`);
        return joined;
      };
      const evalBoundaries = (joined) => ({
        awaited: median(joined.map((b) => b.awaited)),
        bytes: median(joined.map((b) => b.bytesPerStep)),
      });
      let joined = await measureMp();
      let first = evalBoundaries(joined);
      const attemptsAwaited = [first.awaited];
      const attemptsBytes = [first.bytes];
      if (!withinBudget(first.awaited, budgets.awaitedRoomWritesSecondPlayer) || !withinBudget(first.bytes, budgets.roomSessionBytesPerStepAtHandBoundary)) {
        joined = await measureMp();
        const second = evalBoundaries(joined);
        attemptsAwaited.push(second.awaited);
        attemptsBytes.push(second.bytes);
      }
      const detail = { boundaries: joined.map((b) => ({ order: b.order, secondAckMs: b.secondAckMs, dealtMs: b.dealtMs, awaited: b.awaited, bytes: b.bytes, seq: b.seq, bytesPerStep: Math.round(b.bytesPerStep), writes: b.writes })) };
      record('awaitedRoomWritesSecondPlayer', 'room writes the second player awaits at a hand boundary (flag on, 290 ms)', 'writes', attemptsAwaited, budgets.awaitedRoomWritesSecondPlayer, detail);
      record('roomSessionBytesPerStepAtHandBoundary', 'room-session bytes written at a hand boundary, per game-state step so far', 'bytes/step', attemptsBytes, budgets.roomSessionBytesPerStepAtHandBoundary);
    }

    if (only.has('daily')) {
      await fetch(`http://127.0.0.1:${STUB_PORT}/__lat?ms=0`);
      const outDir = 'dist-perf-daily';
      if (!fs.existsSync(path.join(clientDir, outDir, 'index.html')) || args.rebuild) {
        console.log('building the dev-auth production client for the Daily check ...');
        execFileSync('npx', ['vite', 'build', '-c', 'scripts/perf/vite.perf-daily.config.mjs', '--outDir', outDir, '--emptyOutDir'], {
          cwd: clientDir,
          stdio: 'inherit',
          env: { ...process.env, VITE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`, VITE_LEGAL_LEGAL_ENTITY_NAME: 'CI Validation Only', VITE_LEGAL_SUPPORT_EMAIL: 'support@ci-validation.invalid', VITE_LEGAL_MINIMUM_AGE: '13', VITE_LEGAL_POLICY_EFFECTIVE_DATE: '2026-01-01', VITE_LEGAL_POSTHOG_LOCATION: 'discarded' },
        });
      }
      staticDaily = spawnService('static', process.execPath, [path.join(here, 'staticServer.mjs'), path.join(clientDir, outDir), '5422'], { cwd: clientDir });
      await waitForHttp('http://127.0.0.1:5422/', { child: staticDaily });
      const measureDaily = () => {
        const out = execFileSync(process.execPath, [path.join(here, 'checkpointPosts.mjs'), '--base', 'http://127.0.0.1:5422', '--hands', '3', '--cpu', '4', '--budgetMs', '300000'], { cwd: clientDir, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
        const parsed = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop());
        if (parsed.nextHands < 3) throw new Error(`only ${parsed.nextHands} hands were played`);
        return { posts: parsed.checkpointPosts, bytes: parsed.checkpointBytes };
      };
      let d = measureDaily();
      const posts = [d.posts];
      const bytes = [d.bytes];
      if (!withinBudget(d.posts, budgets.dailyCheckpointPostsOver3Hands) || !withinBudget(d.bytes, budgets.dailyCheckpointBytesOver3Hands)) {
        d = measureDaily();
        posts.push(d.posts);
        bytes.push(d.bytes);
      }
      record('dailyCheckpointPostsOver3Hands', 'Daily Fritz checkpoint posts over 3 hands (phone 4x)', 'posts', posts, budgets.dailyCheckpointPostsOver3Hands);
      record('dailyCheckpointBytesOver3Hands', 'Daily Fritz checkpoint bytes over 3 hands', 'bytes', bytes, budgets.dailyCheckpointBytesOver3Hands);
    }
  }
} finally {
  await stop(staticDaily, server, stub);
}

const failed = results.filter((r) => !r.ok);
const summary = [
  '### Perf budgets (Tier 1)',
  '',
  '| check | value | budget | result |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.label} | ${r.attempts.map((v) => Math.round(v).toLocaleString('en-US')).join(' then ')} ${r.unit} | ${describeBudget(r)} | ${r.ok ? 'pass' : '**FAIL**'} |`),
  '',
  failed.length ? `**${failed.length} budget(s) outside their range on both attempts.** Fix the regression, or, if the budget is wrong, change perf-budgets.json and docs/perf-budget.md in the same PR with the measurement that justifies it.` : 'All Tier 1 budgets hold.',
].join('\n');
console.log(`\n${summary}`);
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
if (args.summary) fs.writeFileSync(args.summary, `${summary}\n`);
process.exit(failed.length && !args['report-only'] ? 1 : 0);
