/**
 * F4c: before/after wall-clock measurement for one fixed master-tier
 * recorded-corpus game.
 *
 * Protocol (predeclared; not result-driven):
 *   BEFORE (baseline SHA worktree, serial evaluateReviewPosition):
 *     1 warm-up (discarded) + 5 measured runs
 *   AFTER (current main with F4a pool + F4b ceiling):
 *     1 warm-up (discarded) + 5 measured runs
 * Headline: median total batch wall-clock.
 *
 * Game selection: recovered F4c harness gameId
 * `client-policy:demo-client-policy-master-1:0` — first game (gameIndex 0)
 * of the committed master-tier recorded-client-policy corpus
 * (`strong-policy-top-tier--tier-master--seed-demo-client-policy-master-1--games-5`).
 *
 * Usage:
 *   npx tsx client/src/devtools/measureReviewLatencyF4c.ts \
 *     /path/to/baseline-worktree [/path/to/output.json]
 */
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewCaptureRecord } from '@racehorse/review-engine';
import { createDeterministicDoubleSixDeal, type GameCommand } from '@racehorse/game-core';
import {
  applyPlayMove,
  createFixedBotMatch,
  drawOne,
  passTurn,
  startNextFixedBotHand,
  type BotMatchState,
} from '../modules/match/runtime/botEngine.ts';
import { captureReviewSnapshotAtDecision } from '../modules/review/captureReviewSnapshotAtDecision.ts';
import { observeActorDrawPastOpenEnds, observeActorPassOnOpenEnds } from '../modules/review/missingPipEvidenceAccumulate.ts';
import {
  DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  DEFAULT_REVIEW_DISPATCH_BUDGET,
  defaultReviewWorkerPoolSize,
} from '../modules/review/reviewEngineConfig.ts';
import { createNodeReviewWorker } from '../modules/review/reviewWorkerPool.node.ts';
import { runReviewBatchPool, toOrderedEvaluations } from '../modules/review/runReviewBatchPool.ts';

/** Canonical F4c game — recovered measureReviewBatchPool.ts selection. */
export const F4C_GAME_ID = 'client-policy:demo-client-policy-master-1:0';
export const F4C_CORPUS_FILE =
  'strong-policy-top-tier--tier-master--seed-demo-client-policy-master-1--games-5.jsonl';
export const F4C_WARMUPS = 1;
export const F4C_MEASURED_RUNS = 5;

const WALL_CLOCK_DIAGNOSTIC = 'wall-clock safety ceiling exceeded';

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Replay only gameIndex 0 from the master-tier client-policy file.
 * Avoids the known multi-file recorded-client-policy cursor mismatch by
 * never touching other jsonl corpora.
 */
export function loadF4cMasterGameSnapshots(fixturesDir: string): ReviewPositionSnapshotV2[] {
  const file = join(fixturesDir, F4C_CORPUS_FILE);
  const records = readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReviewCaptureRecord)
    .filter((row) => row.seed === 'demo-client-policy-master-1' && row.gameIndex === 0);
  if (records.length === 0) throw new Error(`No records for ${F4C_GAME_ID} in ${file}`);

  const game = `${records[0].seed}:game${records[0].gameIndex}`;
  const deal = (handNumber: number) => {
    const value = createDeterministicDoubleSixDeal({
      seed: `${game}:h${handNumber}`,
      tilesPerPlayer: 7,
      deadTileCount: 2,
    });
    return {
      player_tiles: [...value.playerTiles],
      fritz_tiles: [...value.opponentTiles],
      boneyard: [...value.boneyard],
      locked: [...value.deadTiles],
    };
  };

  let state: BotMatchState = createFixedBotMatch(deal(1));
  let expectedMove = 1;
  const snapshots: ReviewPositionSnapshotV2[] = [];

  for (const row of records) {
    if (state.handOver && !state.gameOver) {
      state = startNextFixedBotHand(state, deal(state.handNumber + 1));
    }
    if (
      state.gameOver ||
      state.handNumber !== row.handNumber ||
      state.currentPlayer !== row.actorId ||
      row.moveNumber !== expectedMove
    ) {
      throw new Error(
        `F4c cursor mismatch at move ${row.moveNumber}: hand=${state.handNumber}/${row.handNumber} actor=${state.currentPlayer}/${row.actorId} expectedMove=${expectedMove}`,
      );
    }
    expectedMove += 1;
    const actor = state.currentPlayer;
    const action = row.evaluation.played.action;
    if (action.kind === 'draw') state = observeActorDrawPastOpenEnds(state, actor);
    if (action.kind === 'pass') state = observeActorPassOnOpenEnds(state, actor);
    const command: GameCommand = {
      version: 1,
      commandId: `f4c-replay:${game}:${row.moveNumber}`,
      sequence: state.turnIndex ?? 0,
      actorId: actor,
      ...action,
    };
    const snapshot = captureReviewSnapshotAtDecision({
      preState: state,
      command,
      identifiers: {
        sessionId: F4C_GAME_ID,
        gameId: F4C_GAME_ID,
        handId: `${F4C_GAME_ID}:hand-${row.handNumber}`,
        decisionId: row.evaluation.snapshotId,
        mode: 'fixture',
        gameNumber: 1,
        actionNumber: row.moveNumber,
      },
    });
    snapshots.push(snapshot);
    state =
      action.kind === 'play'
        ? applyPlayMove(state, actor, { type: 'play', tile: action.tile, position: action.position }).state
        : action.kind === 'draw'
          ? drawOne(state, actor).state
          : passTurn(state, actor).state;
  }
  return snapshots;
}

function summarizeEvaluations(evaluations: readonly ReviewEvaluationV1[]) {
  const tiers = { exact: 0, search: 0, heuristic: 0 };
  let incomplete = 0;
  let deadlineIncomplete = 0;
  for (const evaluation of evaluations) {
    const source = evaluation.evidence.source;
    if (source === 'exact' || source === 'search' || source === 'heuristic') tiers[source] += 1;
    if (!evaluation.search.complete) {
      incomplete += 1;
      if (evaluation.diagnostics.includes(WALL_CLOCK_DIAGNOSTIC)) deadlineIncomplete += 1;
    }
  }
  return { tiers, incomplete, deadlineIncomplete };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const baselineArgument = process.argv[2];
  if (!baselineArgument) {
    throw new Error('Usage: measureReviewLatencyF4c.ts BASELINE_WORKTREE [OUTPUT_JSON]');
  }
  const baselineRoot = resolve(baselineArgument);
  if (baselineRoot === root) throw new Error('Baseline must be a separate worktree.');

  const out = resolve(process.argv[3] ?? '/private/tmp/racehorse-f4c-timing.json');
  const fixturesDir = join(root, 'packages/review-engine/fixtures/recorded-client-policy');
  const snapshots = loadF4cMasterGameSnapshots(fixturesDir);

  const baseline = (await import(
    pathToFileURL(join(baselineRoot, 'packages/review-engine/src/index.ts')).href
  )) as typeof import('@racehorse/review-engine');

  const budget = DEFAULT_REVIEW_DISPATCH_BUDGET;
  const threshold = DEFAULT_REVIEW_COVERAGE_THRESHOLD;
  // Production-representative pool size. Node has no navigator — fallback is 4
  // per defaultReviewWorkerPoolSize(); also record host CPU count.
  const hostCpuCount = cpus().length;
  const effectivePoolSize = defaultReviewWorkerPoolSize();

  const runBefore = (): { ms: number; evaluations: ReviewEvaluationV1[] } => {
    const started = performance.now();
    const evaluations = snapshots.map((snapshot) =>
      baseline.evaluateReviewPosition(snapshot, budget, threshold),
    );
    return { ms: performance.now() - started, evaluations };
  };

  const runAfter = async (): Promise<{ ms: number; evaluations: ReviewEvaluationV1[] }> => {
    const started = performance.now();
    const result = await runReviewBatchPool(snapshots, budget, threshold, {
      poolSize: effectivePoolSize,
      createWorker: createNodeReviewWorker,
    });
    const ms = performance.now() - started;
    if (result.errorsByDecisionId.size > 0) {
      throw new Error(`After batch errors: ${JSON.stringify([...result.errorsByDecisionId])}`);
    }
    const evaluations = toOrderedEvaluations(snapshots, result) as ReviewEvaluationV1[];
    if (evaluations.length !== snapshots.length) {
      throw new Error(`After pool omitted decisions: ${evaluations.length}/${snapshots.length}`);
    }
    return { ms, evaluations };
  };

  // ---- BEFORE protocol ----
  process.stderr.write(`F4c BEFORE warm-up (${F4C_WARMUPS})…\n`);
  for (let i = 0; i < F4C_WARMUPS; i += 1) runBefore();
  const beforeRuns: number[] = [];
  let beforeSample: ReviewEvaluationV1[] | null = null;
  for (let i = 0; i < F4C_MEASURED_RUNS; i += 1) {
    const { ms, evaluations } = runBefore();
    beforeRuns.push(ms);
    beforeSample = evaluations;
    process.stderr.write(`  BEFORE run ${i + 1}/${F4C_MEASURED_RUNS}: ${ms.toFixed(1)} ms\n`);
  }

  // ---- AFTER protocol ----
  process.stderr.write(`F4c AFTER warm-up (${F4C_WARMUPS})…\n`);
  for (let i = 0; i < F4C_WARMUPS; i += 1) await runAfter();
  const afterRuns: number[] = [];
  let afterSample: ReviewEvaluationV1[] | null = null;
  for (let i = 0; i < F4C_MEASURED_RUNS; i += 1) {
    const { ms, evaluations } = await runAfter();
    afterRuns.push(ms);
    afterSample = evaluations;
    process.stderr.write(`  AFTER run ${i + 1}/${F4C_MEASURED_RUNS}: ${ms.toFixed(1)} ms\n`);
  }

  if (!beforeSample || !afterSample) throw new Error('Missing sample evaluations');

  const beforeSummary = summarizeEvaluations(beforeSample);
  const afterSummary = summarizeEvaluations(afterSample);
  const beforeMedian = median(beforeRuns);
  const afterMedian = median(afterRuns);
  const absoluteDeltaMs = afterMedian - beforeMedian;
  const percentDelta = beforeMedian === 0 ? null : (absoluteDeltaMs / beforeMedian) * 100;

  // Workload honesty: compare best actions (stable under F4b unless deadline fires)
  let bestActionMismatches = 0;
  for (let i = 0; i < beforeSample.length; i += 1) {
    if (JSON.stringify(beforeSample[i].best.action) !== JSON.stringify(afterSample[i].best.action)) {
      bestActionMismatches += 1;
    }
  }

  const report = {
    status: 'complete',
    protocol: {
      warmups: F4C_WARMUPS,
      measuredRuns: F4C_MEASURED_RUNS,
      headline: 'median total batch wall-clock',
      beforeMode: 'serial evaluateReviewPosition from baseline worktree',
      afterMode: 'runReviewBatchPool with defaultReviewWorkerPoolSize + production F4b ceiling',
    },
    environment: {
      beforeSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baselineRoot, encoding: 'utf8' }).trim(),
      afterSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostCpuCount,
      effectiveWorkerCount: effectivePoolSize,
      loadavgAtEnd: loadavg(),
    },
    game: {
      gameId: F4C_GAME_ID,
      corpusFile: F4C_CORPUS_FILE,
      decisions: snapshots.length,
      beforeTiers: beforeSummary.tiers,
      afterTiers: afterSummary.tiers,
    },
    budget,
    coverageThreshold: threshold,
    wallClockCeilingMsNote:
      'AFTER uses engine default DEFAULT_REVIEW_WALL_CLOCK_CEILING_MS=2000 (budget omits maxWallClockMs). BEFORE baseline has no ceiling.',
    headline: {
      beforeMedianMs: beforeMedian,
      afterMedianMs: afterMedian,
      absoluteDeltaMs,
      percentDelta,
    },
    rawRunsMs: {
      before: beforeRuns,
      after: afterRuns,
    },
    completeness: {
      beforeIncomplete: beforeSummary.incomplete,
      afterIncomplete: afterSummary.incomplete,
      afterDeadlineIncomplete: afterSummary.deadlineIncomplete,
      bestActionMismatches,
    },
    caveats: [
      'BEFORE is serial evaluation in-process from the pre-F4a baseline SHA; AFTER includes worker create/loader overhead.',
      'AFTER applies the production 2000ms per-decision ceiling; BEFORE has no wall-clock ceiling.',
      'If afterDeadlineIncomplete > 0, the wall-clock delta is not a pure parallelization speedup.',
      'Node timing only — not a browser latency claim.',
      'No production budgets/config were changed for this measurement.',
    ],
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  process.stderr.write(`Wrote ${out}\n`);
  process.stdout.write(JSON.stringify(report.headline, null, 2) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
