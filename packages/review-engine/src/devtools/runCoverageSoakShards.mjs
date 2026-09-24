#!/usr/bin/env node
/**
 * Sharded coverage soak — one OS process per shard for real parallelism.
 *
 * Modes (REVIEW_COVERAGE_SOAK_MODE):
 *   logical     — accelerated budgets OK; full evidence lifecycle; ≥10k games
 *   production  — exact production budgets; smaller count (500–1000)
 *
 * Usage:
 *   REVIEW_COVERAGE_SOAK_MODE=logical REVIEW_COVERAGE_SOAK_GAMES=10000 \
 *     REVIEW_COVERAGE_ADVERSARIAL=1 REVIEW_COVERAGE_SHARDS=8 \
 *     node --import tsx src/devtools/runCoverageSoakShards.mjs
 *
 *   REVIEW_COVERAGE_SOAK_MODE=production REVIEW_COVERAGE_SOAK_GAMES=500 \
 *     REVIEW_COVERAGE_SHARDS=4 node --import tsx src/devtools/runCoverageSoakShards.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const soakMode = process.env.REVIEW_COVERAGE_SOAK_MODE ?? 'logical';
const totalGames = Number(
  process.env.REVIEW_COVERAGE_SOAK_GAMES ?? (soakMode === 'production' ? 500 : 10000),
);
const shards = Math.max(1, Number(process.env.REVIEW_COVERAGE_SHARDS ?? 8) || 8);
const maxTier = process.env.REVIEW_COVERAGE_MAX_TIER ?? '4';
// Logical completeness soak must exercise evidence lifecycle (#220).
const adversarial =
  process.env.REVIEW_COVERAGE_ADVERSARIAL
  ?? (soakMode === 'logical' ? '1' : '0');
const outDir =
  process.env.REVIEW_COVERAGE_SOAK_OUT
  ?? `/tmp/racehorse-soak-${soakMode}`;

mkdirSync(outDir, { recursive: true });

const perShard = Math.ceil(totalGames / shards);
const children = [];

for (let s = 0; s < shards; s += 1) {
  const start = s * perShard;
  const count = Math.min(perShard, Math.max(0, totalGames - start));
  if (count <= 0) break;
  const outFile = join(outDir, `shard-${s}.json`);
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      join(import.meta.dirname, 'runCoverageSoakShardWorker.ts'),
      String(start),
      String(count),
      outFile,
    ],
    {
      env: {
        ...process.env,
        REVIEW_COVERAGE_SOAK_MODE: soakMode,
        REVIEW_COVERAGE_MAX_TIER: maxTier,
        REVIEW_COVERAGE_ADVERSARIAL: adversarial,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  // Line-buffer-ish: flush shard logs as they arrive (still pipe-buffered by OS).
  child.stdout?.on('data', (buf) => process.stdout.write(`[shard ${s}] ${buf}`));
  child.stderr?.on('data', (buf) => process.stderr.write(`[shard ${s}] ${buf}`));
  children.push({ child, outFile, s, count });
}

const codes = await Promise.all(
  children.map(
    ({ child }) =>
      new Promise((resolve) => {
        child.on('exit', (code) => resolve(code ?? 1));
      }),
  ),
);

if (codes.some((c) => c !== 0)) {
  console.error('shard failure', codes);
  process.exit(1);
}

function dist(values) {
  if (values.length === 0) return { p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { p50: pct(50), p75: pct(75), p90: pct(90), p95: pct(95), p99: pct(99), max: sorted[sorted.length - 1] };
}

const merged = {
  mode: soakMode,
  adversarial: adversarial === '1',
  games: 0,
  hands: 0,
  totalDecisions: 0,
  forced: 0,
  scored: 0,
  estimates: 0,
  unavailable: 0,
  pending: 0,
  retryable: 0,
  fatal: 0,
  tierNeed: { 1: 0, 2: 0, 3: 0, 4: 0 },
  convergenceReasons: {},
  samples: [],
  nodes: [],
  wallMs: [],
  feasibleStates: [],
  evidenceItemsCreated: 0,
  evidenceInvalidations: 0,
  invalidationsByCause: {},
  snapshotsWithMultiEpoch: 0,
  snapshotsWithDrawAfterEvidence: 0,
  feasibilityFailures: 0,
  minimalConflictInvocations: 0,
  gameWallMs: [],
  failures: [],
};

for (const { outFile } of children) {
  if (!existsSync(outFile)) {
    console.error('missing', outFile);
    process.exit(1);
  }
  const part = JSON.parse(readFileSync(outFile, 'utf8'));
  merged.games += part.games;
  merged.hands += part.hands;
  merged.totalDecisions += part.totalDecisions;
  merged.forced += part.forced;
  merged.scored += part.scored;
  merged.estimates += part.estimates;
  merged.unavailable += part.unavailable;
  merged.pending += part.pending;
  merged.retryable += part.retryable;
  merged.fatal += part.fatal;
  merged.evidenceItemsCreated += part.evidenceItemsCreated ?? 0;
  merged.evidenceInvalidations += part.evidenceInvalidations ?? 0;
  merged.snapshotsWithMultiEpoch += part.snapshotsWithMultiEpoch ?? 0;
  merged.snapshotsWithDrawAfterEvidence += part.snapshotsWithDrawAfterEvidence ?? 0;
  merged.feasibilityFailures += part.feasibilityFailures ?? 0;
  merged.minimalConflictInvocations += part.minimalConflictInvocations ?? 0;
  merged.gameWallMs.push(...(part.gameWallMs ?? []));
  merged.samples.push(...part.samples);
  merged.nodes.push(...part.nodes);
  merged.wallMs.push(...part.wallMs);
  merged.feasibleStates.push(...part.feasibleStates);
  merged.failures.push(...part.failures);
  for (const [k, v] of Object.entries(part.tierNeed ?? {})) {
    merged.tierNeed[k] = (merged.tierNeed[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(part.convergenceReasons ?? {})) {
    merged.convergenceReasons[k] = (merged.convergenceReasons[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(part.invalidationsByCause ?? {})) {
    merged.invalidationsByCause[k] = (merged.invalidationsByCause[k] ?? 0) + v;
  }
}

const report = {
  mode: soakMode,
  adversarial: merged.adversarial,
  games: merged.games,
  hands: merged.hands,
  totalDecisions: merged.totalDecisions,
  forced: merged.forced,
  scored: merged.scored,
  estimates: merged.estimates,
  unavailable: merged.unavailable,
  pending: merged.pending,
  retryable: merged.retryable,
  fatal: merged.fatal,
  tierNeed: merged.tierNeed,
  convergenceReasons: merged.convergenceReasons,
  samples: dist(merged.samples),
  nodes: dist(merged.nodes),
  wallMsPerDecision: dist(merged.wallMs),
  wallMsPerGame: dist(merged.gameWallMs),
  feasibleStates: dist(merged.feasibleStates),
  evidenceItemsCreated: merged.evidenceItemsCreated,
  evidenceInvalidations: merged.evidenceInvalidations,
  invalidationsByCause: merged.invalidationsByCause,
  snapshotsWithMultiEpoch: merged.snapshotsWithMultiEpoch,
  snapshotsWithDrawAfterEvidence: merged.snapshotsWithDrawAfterEvidence,
  feasibilityFailures: merged.feasibilityFailures,
  minimalConflictInvocations: merged.minimalConflictInvocations,
  failureCount: merged.failures.length,
  failureSamples: merged.failures.slice(0, 8),
  worstFeasibleState: Math.max(0, ...merged.feasibleStates),
};

writeFileSync(join(outDir, 'merged.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

const completenessFail =
  report.failureCount > 0
  || report.estimates > 0
  || report.unavailable > 0
  || report.pending > 0
  || report.retryable > 0
  || report.fatal > 0
  || report.forced + report.scored !== report.totalDecisions
  || report.feasibilityFailures > 0
  || report.minimalConflictInvocations > 0;

const evidenceFail =
  soakMode === 'logical' && report.evidenceInvalidations <= 0;

if (completenessFail || evidenceFail) {
  if (evidenceFail) {
    console.error('LOGICAL soak requires evidenceInvalidations > 0 (live missing-pip lifecycle)');
  }
  process.exit(2);
}
