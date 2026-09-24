import { writeFileSync } from 'node:fs';
import { analyzeGame, type GameResult, type PlayOptions } from './coverageSoakLib';

const startIndex = Number(process.argv[2] ?? 0);
const count = Number(process.argv[3] ?? 0);
const outFile = String(process.argv[4] ?? '');
const maxTier = (Number(process.env.REVIEW_COVERAGE_MAX_TIER ?? 4) || 4) as 1 | 2 | 3 | 4;
const adversarial = process.env.REVIEW_COVERAGE_ADVERSARIAL === '1';
const soakMode = process.env.REVIEW_COVERAGE_SOAK_MODE ?? 'logical';

if (!outFile || count <= 0) {
  console.error('usage: runCoverageSoakShardWorker.ts <startIndex> <count> <outFile>');
  process.exit(1);
}

const aggregated: GameResult = {
  seed: startIndex,
  hands: 0,
  decisions: 0,
  forced: 0,
  scored: 0,
  failures: [],
  samples: [],
  nodes: [],
  wallMs: [],
  feasibleStates: [],
  tierNeed: { 1: 0, 2: 0, 3: 0, 4: 0 },
  convergenceReasons: {},
  evidenceItemsCreated: 0,
  evidenceInvalidations: 0,
  invalidationsByCause: {},
  snapshotsWithMultiEpoch: 0,
  snapshotsWithDrawAfterEvidence: 0,
  feasibilityFailures: 0,
  minimalConflictInvocations: 0,
  estimates: 0,
  unavailable: 0,
  pending: 0,
  retryable: 0,
  fatal: 0,
};

const gameWallMsAll: number[] = [];
const t0 = Date.now();
for (let i = 0; i < count; i += 1) {
  const seed = 1000 + (startIndex + i) * 97;
  const opts: PlayOptions = adversarial
    ? {
        preferDraw: seed % 3 === 0,
        preferPass: seed % 5 === 0,
        winningScore: seed % 7 === 0 ? 25 : 30,
        depleteHighTiles: true,
        maxHands: soakMode === 'logical' ? 2 : 3,
      }
    : {
        preferDraw: soakMode === 'logical' ? seed % 11 === 0 : false,
        preferPass: soakMode === 'logical' ? seed % 13 === 0 : false,
        depleteHighTiles: soakMode === 'logical',
        winningScore: soakMode === 'logical' ? 30 : 50,
        // Production-equivalent: exact engine budgets; maxHands is harness
        // length only (not a search-budget change).
        maxHands: soakMode === 'logical' ? 2 : 3,
      };
  const r = analyzeGame(seed, opts, maxTier);
  if (r.gameWallMs != null) gameWallMsAll.push(r.gameWallMs);
  aggregated.hands += r.hands;
  aggregated.decisions += r.decisions;
  aggregated.forced += r.forced;
  aggregated.scored += r.scored;
  aggregated.estimates += r.estimates;
  aggregated.unavailable += r.unavailable;
  aggregated.pending += r.pending;
  aggregated.retryable += r.retryable;
  aggregated.fatal += r.fatal;
  aggregated.evidenceItemsCreated += r.evidenceItemsCreated;
  aggregated.evidenceInvalidations += r.evidenceInvalidations;
  aggregated.snapshotsWithMultiEpoch += r.snapshotsWithMultiEpoch;
  aggregated.snapshotsWithDrawAfterEvidence += r.snapshotsWithDrawAfterEvidence;
  aggregated.feasibilityFailures += r.feasibilityFailures;
  aggregated.minimalConflictInvocations += r.minimalConflictInvocations;
  aggregated.samples.push(...r.samples);
  aggregated.nodes.push(...r.nodes);
  aggregated.wallMs.push(...r.wallMs);
  aggregated.feasibleStates.push(...r.feasibleStates);
  aggregated.failures.push(...r.failures);
  for (const [k, v] of Object.entries(r.tierNeed)) {
    aggregated.tierNeed[Number(k)] = (aggregated.tierNeed[Number(k)] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(r.convergenceReasons)) {
    aggregated.convergenceReasons[k] = (aggregated.convergenceReasons[k] ?? 0) + v;
  }
  for (const [k, v] of Object.entries(r.invalidationsByCause)) {
    aggregated.invalidationsByCause[k as keyof typeof aggregated.invalidationsByCause] =
      (aggregated.invalidationsByCause[k as keyof typeof aggregated.invalidationsByCause] ?? 0) + v;
  }
  if (r.failures.length > 0) {
    process.stderr.write(
      `FAILURE seed=${r.seed} ${JSON.stringify(r.failures).slice(0, 500)}\n`,
    );
  }
  if ((i + 1) % 5 === 0 || i + 1 === count || i < 3) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const line =
      `mode=${soakMode} progress ${i + 1}/${count} games decisions=${aggregated.decisions} ` +
      `evidenceInv=${aggregated.evidenceInvalidations} failures=${aggregated.failures.length} ${elapsed}s\n`;
    process.stderr.write(line);
    try {
      writeFileSync(
        `${outFile}.progress.json`,
        JSON.stringify({
          mode: soakMode,
          done: i + 1,
          count,
          decisions: aggregated.decisions,
          evidenceInvalidations: aggregated.evidenceInvalidations,
          evidenceItemsCreated: aggregated.evidenceItemsCreated,
          failures: aggregated.failures.length,
          forced: aggregated.forced,
          scored: aggregated.scored,
          elapsedSec: Number(elapsed),
        }),
      );
    } catch {
      // ignore progress write failures
    }
  }
}

writeFileSync(
  outFile,
  JSON.stringify({
    mode: soakMode,
    games: count,
    hands: aggregated.hands,
    totalDecisions: aggregated.decisions,
    forced: aggregated.forced,
    scored: aggregated.scored,
    estimates: aggregated.estimates,
    unavailable: aggregated.unavailable,
    pending: aggregated.pending,
    retryable: aggregated.retryable,
    fatal: aggregated.fatal,
    tierNeed: aggregated.tierNeed,
    convergenceReasons: aggregated.convergenceReasons,
    samples: aggregated.samples,
    nodes: aggregated.nodes,
    wallMs: aggregated.wallMs,
    feasibleStates: aggregated.feasibleStates,
    evidenceItemsCreated: aggregated.evidenceItemsCreated,
    evidenceInvalidations: aggregated.evidenceInvalidations,
    invalidationsByCause: aggregated.invalidationsByCause,
    snapshotsWithMultiEpoch: aggregated.snapshotsWithMultiEpoch,
    snapshotsWithDrawAfterEvidence: aggregated.snapshotsWithDrawAfterEvidence,
    feasibilityFailures: aggregated.feasibilityFailures,
    minimalConflictInvocations: aggregated.minimalConflictInvocations,
    gameWallMs: gameWallMsAll,
    failures: aggregated.failures,
  }),
);
console.log(`wrote ${outFile}`);
