/**
 * Diagnostic-only Phase C provenance / 2×2 counterfactual.
 * Does NOT write production constants.
 *
 *   npx tsx packages/review-engine/src/devtools/auditPhaseCCalibrationProvenance.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dedupeCandidatesByTile,
  isForcedDecision,
  countDistinctLegalActions,
  type ReviewCandidateEvaluationV1,
  type ReviewEvaluationV1,
} from '@racehorse/game-core/review';
import {
  CALIBRATED_K as PUBLISHED_K,
  LOSS_BAND_BOUNDARIES as PUBLISHED_BANDS,
} from '../accuracyModelCalibration';
import type { ReviewCaptureRecord } from '../reviewCaptureSchema';
import {
  CALIBRATION_FIXTURE_BUDGET,
  CALIBRATION_FIXTURE_COVERAGE_THRESHOLD,
  RECORDED_CLIENT_POLICY_DIR,
  RECORDED_SELF_PLAY_DIR,
  evaluateFixtureCorpus,
  fitBoundaries,
  fitKLeastSquares,
  percentile,
  readCorpusDir,
} from './calibrateAccuracyModel';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLISHED_K_TARGET = 0.19770906562806756;
const PUBLISHED_BANDS_TARGET = {
  bestTolerance: 0.12999999999999995,
  inaccuracyToMistake: 0.79,
  mistakeToBlunder: 5.98,
} as const;

type ForcedMode = 'tile' | 'action';

function isForced(mode: ForcedMode, candidates: readonly ReviewCandidateEvaluationV1[]): boolean {
  return mode === 'tile'
    ? dedupeCandidatesByTile(candidates).length <= 1
    : isForcedDecision(candidates);
}

function isScorableMode(
  mode: ForcedMode,
  evaluation: ReviewEvaluationV1,
): boolean {
  return !isForced(mode, evaluation.candidates) && evaluation.evidence.source !== 'heuristic';
}

function lossStats(losses: readonly number[]) {
  if (losses.length === 0) {
    return { count: 0, mean: null as number | null, median: null as number | null, p75: null as number | null, p90: null as number | null, p95: null as number | null, zeroShare: null as number | null };
  }
  const sorted = [...losses].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const zeros = sorted.filter((v) => v === 0).length;
  return {
    count: sorted.length,
    mean,
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    zeroShare: zeros / sorted.length,
  };
}

function predicted(meanLoss: number, k: number): number {
  return Math.min(100, Math.max(0, 100 * Math.exp(-k * meanLoss)));
}

function scorableLossesFromRecords(records: readonly ReviewCaptureRecord[], mode: ForcedMode): number[] {
  return records
    .filter((r) => isScorableMode(mode, r.evaluation))
    .map((r) => r.evaluation.loss.expectedPointDifferential);
}

function runCell(label: string, mode: ForcedMode, selfPlay: ReviewCaptureRecord[], client: ReviewCaptureRecord[], worstLegalLosses: number[]) {
  const strong = selfPlay.filter((r) => r.batchTag === 'strong-policy-top-tier');
  const ordinary = client.filter((r) => r.tier === 'standard');
  const strongLosses = scorableLossesFromRecords(strong, mode);
  const ordinaryLosses = scorableLossesFromRecords(ordinary, mode);
  const all = [...selfPlay, ...client];
  const allScorable = scorableLossesFromRecords(all, mode);
  let forced = 0;
  let heuristic = 0;
  let exact = 0;
  let search = 0;
  for (const r of all) {
    if (isForced(mode, r.evaluation.candidates)) {
      forced += 1;
      continue;
    }
    if (r.evaluation.evidence.source === 'heuristic') heuristic += 1;
    else if (r.evaluation.evidence.source === 'exact') exact += 1;
    else if (r.evaluation.evidence.source === 'search') search += 1;
  }

  const fittedK = fitKLeastSquares([
    { label: 'strong', meanLoss: strongLosses.reduce((s, v) => s + v, 0) / strongLosses.length, targetAccuracy: 95 },
    { label: 'poor', meanLoss: worstLegalLosses.reduce((s, v) => s + v, 0) / worstLegalLosses.length, targetAccuracy: 15 },
  ]);
  const bands = fitBoundaries(strongLosses, ordinaryLosses, worstLegalLosses);
  const strongMean = strongLosses.reduce((s, v) => s + v, 0) / strongLosses.length;
  const ordinaryMean = ordinaryLosses.reduce((s, v) => s + v, 0) / ordinaryLosses.length;
  const poorMean = worstLegalLosses.reduce((s, v) => s + v, 0) / worstLegalLosses.length;

  return {
    label,
    forcedMode: mode,
    accounting: {
      total: all.length,
      forced,
      exact,
      search,
      heuristic,
      scorable: exact + search,
    },
    allScorable: lossStats(allScorable),
    strong: lossStats(strongLosses),
    ordinary: lossStats(ordinaryLosses),
    poor: lossStats(worstLegalLosses),
    fittedK,
    bands,
    predictedWithFittedK: {
      strong: predicted(strongMean, fittedK),
      ordinary: predicted(ordinaryMean, fittedK),
      poor: predicted(poorMean, fittedK),
      ordinaryInBand65_85: (() => {
        const p = predicted(ordinaryMean, fittedK);
        return p >= 65 && p <= 85;
      })(),
    },
    predictedWithPublishedK: {
      strong: predicted(strongMean, PUBLISHED_K),
      ordinary: predicted(ordinaryMean, PUBLISHED_K),
      poor: predicted(poorMean, PUBLISHED_K),
    },
    reproductionDeltasVsPublished: {
      kDelta: fittedK - PUBLISHED_K_TARGET,
      bestToleranceDelta: bands.bestTolerance - PUBLISHED_BANDS_TARGET.bestTolerance,
      inaccuracyToMistakeDelta: bands.inaccuracyToMistake - PUBLISHED_BANDS_TARGET.inaccuracyToMistake,
      mistakeToBlunderDelta: bands.mistakeToBlunder - PUBLISHED_BANDS_TARGET.mistakeToBlunder,
      kMatchesPublished: Math.abs(fittedK - PUBLISHED_K_TARGET) < 1e-12,
      bandsMatchPublished:
        bands.bestTolerance === PUBLISHED_BANDS_TARGET.bestTolerance &&
        bands.inaccuracyToMistake === PUBLISHED_BANDS_TARGET.inaccuracyToMistake &&
        bands.mistakeToBlunder === PUBLISHED_BANDS_TARGET.mistakeToBlunder,
    },
  };
}

function analyzeNewlyScored1740(all: ReviewCaptureRecord[]) {
  const rows: {
    loss: number;
    candidates: readonly ReviewCandidateEvaluationV1[];
    played: ReviewEvaluationV1['played'];
    best: ReviewEvaluationV1['best'];
  }[] = [];
  for (const r of all) {
    const ev = r.evaluation;
    const tileForced = dedupeCandidatesByTile(ev.candidates).length <= 1;
    const actionForced = isForcedDecision(ev.candidates);
    if (!(tileForced && !actionForced)) continue;
    if (ev.evidence.source !== 'exact' && ev.evidence.source !== 'search') continue;
    rows.push({ loss: ev.loss.expectedPointDifferential, candidates: ev.candidates, played: ev.played, best: ev.best });
  }

  let allPlacementValuesEqual = 0;
  let playedTiedForBest = 0;
  let exactZeroLoss = 0;
  let tinyPositive = 0; // (0, bestTolerance published]
  let aboveTiny = 0;
  const tinyCut = PUBLISHED_BANDS.bestTolerance;
  const nonzero: number[] = [];

  for (const row of rows) {
    if (row.loss === 0) exactZeroLoss += 1;
    else if (row.loss > 0 && row.loss <= tinyCut) tinyPositive += 1;
    else aboveTiny += 1;
    if (row.loss !== 0) nonzero.push(row.loss);

    const values = row.candidates
      .map((c) => c.value.expectedPointDifferential)
      .filter((v): v is number => typeof v === 'number');
    if (values.length >= 2 && values.every((v) => v === values[0])) allPlacementValuesEqual += 1;

    const bestVal = row.best.value.expectedPointDifferential;
    const playedVal = row.played.value.expectedPointDifferential;
    if (playedVal === bestVal) playedTiedForBest += 1;
  }

  nonzero.sort((a, b) => a - b);
  return {
    count: rows.length,
    exactZeroLoss,
    exactZeroShare: exactZeroLoss / Math.max(1, rows.length),
    tinyPositiveLoss_le_publishedBestTolerance: tinyPositive,
    aboveTiny: aboveTiny,
    allPlacementValuesExactlyEqual: allPlacementValuesEqual,
    playedTiedForBestValue: playedTiedForBest,
    nonzeroQuantiles: nonzero.length
      ? {
          count: nonzero.length,
          p10: percentile(nonzero, 10),
          p50: percentile(nonzero, 50),
          p75: percentile(nonzero, 75),
          p90: percentile(nonzero, 90),
          p95: percentile(nonzero, 95),
        }
      : null,
    note: 'Forced semantics unchanged: multi-placement remains not-forced even when values are equal.',
  };
}

function strongZeroMass(mode: ForcedMode, strong: ReviewCaptureRecord[]) {
  const losses = scorableLossesFromRecords(strong, mode);
  const zeros = losses.filter((l) => l === 0).length;
  const sorted = [...losses].sort((a, b) => a - b);
  return {
    mode,
    n: losses.length,
    zeroCount: zeros,
    zeroShare: zeros / Math.max(1, losses.length),
    p75: losses.length ? percentile(sorted, 75) : null,
    whyBestBecomesZero: losses.length && percentile(sorted, 75) === 0
      ? 'p75(strong scorable losses) is exactly 0 because ≥75% of strong-policy scorable decisions have loss===0 under this forced mode.'
      : 'p75(strong) is nonzero under this forced mode.',
  };
}

function main(): void {
  const selfPlay = readCorpusDir(RECORDED_SELF_PLAY_DIR);
  const client = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);
  const all = [...selfPlay, ...client];
  const strong = selfPlay.filter((r) => r.batchTag === 'strong-policy-top-tier');

  // Live fixture re-eval for poor-play anchor (same as harness). Tile and action
  // forced both typically leave deliberately_poor as scorable; compute once.
  const fixtures = evaluateFixtureCorpus();
  const worstLegal = fixtures.filter((f) => f.category === 'deliberately_poor');
  const worstLegalLossesTile = worstLegal
    .filter((f) => isScorableMode('tile', f.evaluation))
    .map((f) => f.evaluation.loss.expectedPointDifferential);
  const worstLegalLossesAction = worstLegal
    .filter((f) => isScorableMode('action', f.evaluation))
    .map((f) => f.evaluation.loss.expectedPointDifferential);

  // Historical corpus === current corpus for recorded JSONL (tree SHA identity
  // proven in git). Cells 1+3 and 2+4 therefore collapse on recorded data;
  // poor-play live re-eval may still differ slightly by forced mode if any
  // deliberately_poor fixture were tile-forced-only (they are not).
  const cellHistoricalOld = runCell(
    'historical(=current recorded) + tile-level forced',
    'tile',
    selfPlay,
    client,
    worstLegalLossesTile,
  );
  const cellHistoricalAction = runCell(
    'historical(=current recorded) + action-level forced',
    'action',
    selfPlay,
    client,
    worstLegalLossesAction,
  );
  const cellCurrentOld = { ...cellHistoricalOld, label: 'current corpus + tile-level forced (identical recorded tree to v4)' };
  const cellCurrentAction = { ...cellHistoricalAction, label: 'current corpus + action-level forced' };

  const report = {
    provenanceNote: {
      publishedForcedSemantics: 'tile-level (dedupeCandidatesByTile(...).length === 1) from C1 d545cd15 through C4 until 86db51b2',
      publishedK: PUBLISHED_K,
      publishedBands: PUBLISHED_BANDS,
      ordinaryBand6585:
        'Hardcoded in calibrateAccuracyModel.ts at C2b 48b85258 as pvfBotMatchStandardBand; NOT in Phase C0/parent scoping docs. Commit message: ordinary landed ~85.9 just outside — reported, not forced. Classification: post-hoc empirical validation range / manually chosen product expectation, not a formally derived objective.',
      strongTarget95: 'Harness midpoint of undocumented ~92-98 daily-fritz-master band comment in calibrateAccuracyModel.ts; not in Phase C0 numeric targets.',
      poorTarget15: 'Harness choice “comfortably below <25 ceiling” comment; <25 itself is harness commentary, not C0 numeric lock.',
      recordedCorpusIdentityVsV4Commit943f5612: 'IDENTICAL tree SHAs for recorded-self-play and recorded-client-policy.',
      fixtureIdsVsV4: 'IDENTICAL id list (54 fixtures).',
      harnessMethodDriftVsV4: 'NONE in fitKLeastSquares / fitBoundaries / targets.',
      engineCodeDriftSinceV4: 'evaluateReviewPosition / exact / midgame gained F4b deadline plumbing; recorded evaluations are frozen so recorded histograms are unaffected. Live fixture re-eval may differ.',
    },
    counterfactual2x2: {
      historical_tile: cellHistoricalOld,
      historical_action: cellHistoricalAction,
      current_tile: cellCurrentOld,
      current_action: cellCurrentAction,
    },
    historicalReproduction: {
      attempt: 'Re-fit on current(=historical) recorded corpus with tile-level forced + live worst_legal re-eval',
      ...cellHistoricalOld.reproductionDeltasVsPublished,
      fittedK: cellHistoricalOld.fittedK,
      fittedBands: cellHistoricalOld.bands,
      note:
        cellHistoricalOld.reproductionDeltasVsPublished.kMatchesPublished &&
        cellHistoricalOld.reproductionDeltasVsPublished.bandsMatchPublished
          ? 'EXACT reproduction of published v4 constants under tile-level forced.'
          : 'Deltas exist — inspect live worst_legal re-eval / float paths.',
    },
    bestBandDegeneracy: {
      tile: strongZeroMass('tile', strong),
      action: strongZeroMass('action', strong),
    },
    newlyScored1740: analyzeNewlyScored1740(all),
    conclusion: {
      rootCause: 'Forced-semantic dependency of the published acceptance contract: v4 K/bands/[65,85] check were produced under tile-level forced. Action-level expands scorable with near-zero-loss same-tile placements → mean loss drops → ordinary predicted accuracy rises above 85; strong p75 collapses to 0 → Best=0. Corpus identity and harness method are NOT the primary break (recorded trees identical; fit code unchanged).',
      phaseCUniquelySpecifiesValidV5: false,
      projectLeadDecisionRequired: [
        'Whether historical empirical [65,85] (already soft-failed at C2b intro at ~85.9) remains binding under corrected denominator',
        'How to treat degenerate Best=p75(strong)=0 when zero-inflated mass exceeds 75% after action-level inclusion',
        'Whether to re-derive acceptance ranges under action-level as a new signed-off Phase C revision (not agent-invented)',
      ],
    },
  };

  const outPath = join(SCRIPT_DIR, '..', '..', '..', '..', 'docs', 'review-accuracy-v5-phase-c-provenance-audit.raw.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${outPath}`);
}

main();
