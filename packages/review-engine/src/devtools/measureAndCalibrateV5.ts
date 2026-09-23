/**
 * One-shot measurement + calibration report for v5 action-level forced.
 * Freezes Phase C inputs, measures old (tile) vs new (action) denominators,
 * fits K + boundaries with the existing Phase C harness methods, and writes
 * JSON to stdout for docs/review-accuracy-v5-action-forced-calibration.md.
 *
 *   npx tsx packages/review-engine/src/devtools/measureAndCalibrateV5.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dedupeCandidatesByTile,
  isForcedDecision,
  countDistinctLegalActions,
  REVIEW_ENGINE_CONTRACT_VERSION,
  type ReviewEvaluationV1,
} from '@racehorse/game-core/review';
import { isScorable } from '../reviewAccuracy';
import { gradeFromAccuracy } from '../accuracyGrade';
import {
  CALIBRATED_K as OLD_K,
  LOSS_BAND_BOUNDARIES as OLD_BOUNDARIES,
  ACCURACY_MODEL_CALIBRATION_VERSION as PRE_RECAL_VERSION,
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
  runCalibration,
  summarizeLosses,
} from './calibrateAccuracyModel';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** FREEZE — declared before looking at fit outcomes. */
const FROZEN = {
  reviewEngineVersion: REVIEW_ENGINE_CONTRACT_VERSION,
  accuracyModelCandidateVersion: 'accuracy-model-v5-action-forced-2026-09-22',
  searchBudget: CALIBRATION_FIXTURE_BUDGET,
  coverageGate: CALIBRATION_FIXTURE_COVERAGE_THRESHOLD,
  corpusRevision: 'recorded-self-play + recorded-client-policy as committed 2026-09-17; fixtures REVIEW_FIXTURE_CORPUS',
  fixtureIds: REVIEW_FIXTURE_CORPUS.map((f) => f.id),
  calibrationAlgorithm:
    'fitKLeastSquares (grid + golden-section) anchors: strong-policy mean→95, worst_legal mean→15; fitBoundaries: best=p75(strong), inacc→mistake=p75(ordinary PVF), mistake→blunder=p10(poor)',
  fittingObjective: 'sum of squared residuals vs target accuracies 95 and 15',
  acceptanceChecks: {
    ordinaryPvfPredictedBand: [65, 85] as const,
    poorPlayAccuracy: { lt: 60, gt: 0 },
    strongPolicyTarget: 95,
    poorPlayTarget: 15,
    monotonicity: true,
    forcedInvariance: true,
    optimalCeiling: 100,
  },
} as const;

function tileForced(candidates: ReviewEvaluationV1['candidates']): boolean {
  return dedupeCandidatesByTile(candidates).length <= 1;
}

function actionForced(candidates: ReviewEvaluationV1['candidates']): boolean {
  return isForcedDecision(candidates);
}

function sameTileMultiPlacement(candidates: ReviewEvaluationV1['candidates']): boolean {
  const plays = candidates.filter((c) => c.action.kind === 'play');
  if (plays.length < 2) return false;
  const tiles = new Set(
    plays.map((c) => {
      const a = c.action;
      if (a.kind !== 'play') return '';
      const lo = Math.min(a.tile.low, a.tile.high);
      const hi = Math.max(a.tile.low, a.tile.high);
      return `${lo}-${hi}`;
    }),
  );
  return tiles.size === 1 && countDistinctLegalActions(candidates) > 1;
}

function lossBand(loss: number, b: typeof OLD_BOUNDARIES): 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder' {
  if (loss <= b.bestTolerance) return 'Best';
  if (loss <= b.inaccuracyToMistake) return 'Inaccuracy';
  if (loss <= b.mistakeToBlunder) return 'Mistake';
  return 'Blunder';
}

function lossStats(losses: readonly number[]) {
  if (losses.length === 0) {
    return { count: 0, mean: null, median: null, p75: null, p90: null, p95: null };
  }
  const sorted = [...losses].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    count: sorted.length,
    mean,
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
  };
}

function bandDist(losses: readonly number[], b: typeof OLD_BOUNDARIES) {
  const out = { Best: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 };
  for (const loss of losses) out[lossBand(loss, b)] += 1;
  return out;
}

function accounting(records: readonly ReviewCaptureRecord[], forcedPred: (c: ReviewEvaluationV1['candidates']) => boolean) {
  let total = 0;
  let forced = 0;
  let exact = 0;
  let search = 0;
  let heuristic = 0;
  let unavailable = 0;
  const scorableLosses: number[] = [];
  for (const record of records) {
    const ev = record.evaluation;
    total += 1;
    if (forcedPred(ev.candidates)) {
      forced += 1;
      continue;
    }
    if (ev.evidence.source === 'exact') {
      exact += 1;
      scorableLosses.push(ev.loss.expectedPointDifferential);
    } else if (ev.evidence.source === 'search') {
      search += 1;
      scorableLosses.push(ev.loss.expectedPointDifferential);
    } else if (ev.evidence.source === 'heuristic') {
      heuristic += 1;
    } else {
      unavailable += 1;
    }
  }
  return {
    total,
    forced,
    exactScored: exact,
    searchScored: search,
    heuristicEstimate: heuristic,
    unavailable,
    scorableDenominator: exact + search,
    losses: lossStats(scorableLosses),
  };
}

function perGameAccuracies(
  records: readonly ReviewCaptureRecord[],
  forcedPred: (c: ReviewEvaluationV1['candidates']) => boolean,
  k: number,
) {
  const byGame = new Map<string, ReviewEvaluationV1[]>();
  for (const record of records) {
    const key = `${record.corpusKind}|${record.seed}|${record.gameIndex}|${record.tier}|${record.batchTag}`;
    const list = byGame.get(key) ?? [];
    list.push(record.evaluation);
    byGame.set(key, list);
  }
  const accuracies: number[] = [];
  const grades: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, null: 0 };
  for (const evaluations of byGame.values()) {
    // Override isScorable temporarily by filtering with forcedPred
    const scorable = evaluations.filter(
      (e) => !forcedPred(e.candidates) && e.evidence.source !== 'heuristic',
    );
    if (scorable.length === 0) continue;
    const meanLoss =
      scorable.reduce((s, e) => s + e.loss.expectedPointDifferential, 0) / scorable.length;
    const accuracy = Math.min(100, Math.max(0, 100 * Math.exp(-k * meanLoss)));
    accuracies.push(accuracy);
    // Grade only when no non-forced heuristic (complete coverage semantics)
    const nonForced = evaluations.filter((e) => !forcedPred(e.candidates));
    const hasHeuristic = nonForced.some((e) => e.evidence.source === 'heuristic');
    if (hasHeuristic) {
      grades.null += 1;
    } else {
      grades[gradeFromAccuracy(accuracy)] += 1;
    }
  }
  const sorted = [...accuracies].sort((a, b) => a - b);
  return {
    gameCount: accuracies.length,
    median: sorted.length ? percentile(sorted, 50) : null,
    p10: sorted.length ? percentile(sorted, 10) : null,
    p90: sorted.length ? percentile(sorted, 90) : null,
    mean: sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : null,
    gradeDistribution: grades,
  };
}

function main(): void {
  const selfPlay = readCorpusDir(RECORDED_SELF_PLAY_DIR);
  const clientPolicy = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);
  const all = [...selfPlay, ...clientPolicy];

  const oldAcc = accounting(all, tileForced);
  const newAcc = accounting(all, actionForced);

  // Newly scored exact/search: tile-forced but NOT action-forced, and exact|search
  const newlyScorable: {
    loss: number;
    source: string;
    tier: string;
    batchTag: string;
    corpusKind: string;
    sameTileMulti: boolean;
  }[] = [];
  for (const record of all) {
    const ev = record.evaluation;
    if (!tileForced(ev.candidates)) continue;
    if (actionForced(ev.candidates)) continue;
    if (ev.evidence.source !== 'exact' && ev.evidence.source !== 'search') continue;
    newlyScorable.push({
      loss: ev.loss.expectedPointDifferential,
      source: ev.evidence.source,
      tier: record.tier,
      batchTag: record.batchTag,
      corpusKind: record.corpusKind,
      sameTileMulti: sameTileMultiPlacement(ev.candidates),
    });
  }
  const newlyLosses = newlyScorable.map((r) => r.loss);
  const byTier: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let sameTileShare = 0;
  for (const row of newlyScorable) {
    byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    if (row.sameTileMulti) sameTileShare += 1;
  }

  const fixtures = evaluateFixtureCorpus();
  const worstLegal = fixtures.filter((f) => f.category === 'deliberately_poor');
  const worstLegalLosses = worstLegal
    .filter((f) => isScorable(f.evaluation, f.evaluation.candidates))
    .map((f) => f.evaluation.loss.expectedPointDifferential);

  const strongPolicyRecords = selfPlay.filter((r) => r.batchTag === 'strong-policy-top-tier');
  const pvfStandardRecords = clientPolicy.filter((r) => r.tier === 'standard');
  const strongLosses = strongPolicyRecords
    .filter((r) => isScorable(r.evaluation, r.evaluation.candidates))
    .map((r) => r.evaluation.loss.expectedPointDifferential);
  const ordinaryLosses = pvfStandardRecords
    .filter((r) => isScorable(r.evaluation, r.evaluation.candidates))
    .map((r) => r.evaluation.loss.expectedPointDifferential);

  const fittedK = fitKLeastSquares([
    {
      label: 'strong',
      meanLoss: strongLosses.reduce((s, v) => s + v, 0) / strongLosses.length,
      targetAccuracy: 95,
    },
    {
      label: 'poor',
      meanLoss: worstLegalLosses.reduce((s, v) => s + v, 0) / worstLegalLosses.length,
      targetAccuracy: 15,
    },
  ]);
  const fittedBoundaries = fitBoundaries(strongLosses, ordinaryLosses, worstLegalLosses);

  const harnessReport = runCalibration();

  const predicted = (meanLoss: number, k: number) =>
    Math.min(100, Math.max(0, 100 * Math.exp(-k * meanLoss)));

  const strongMean = strongLosses.reduce((s, v) => s + v, 0) / strongLosses.length;
  const ordinaryMean = ordinaryLosses.reduce((s, v) => s + v, 0) / ordinaryLosses.length;
  const poorMean = worstLegalLosses.reduce((s, v) => s + v, 0) / worstLegalLosses.length;

  const oldGameDist = perGameAccuracies(all, tileForced, OLD_K);
  const newGameDistOldK = perGameAccuracies(all, actionForced, OLD_K);
  const newGameDistNewK = perGameAccuracies(all, actionForced, fittedK);

  const report = {
    frozen: FROZEN,
    preRecalVersion: PRE_RECAL_VERSION,
    oldConstants: { k: OLD_K, boundaries: OLD_BOUNDARIES },
    forcedCorrection: {
      totalDecisions: all.length,
      wronglyForced: oldAcc.forced - newAcc.forced,
      wronglyForcedExactSearch: newlyScorable.length,
      old: oldAcc,
      new: newAcc,
    },
    newlyScored1740: {
      count: newlyScorable.length,
      byTier,
      bySource,
      sameTileMultiPlacementShare: sameTileShare / Math.max(1, newlyScorable.length),
      sameTileMultiPlacementCount: sameTileShare,
      losses: lossStats(newlyLosses),
      bandDistUnderOldBoundaries: bandDist(newlyLosses, OLD_BOUNDARIES),
      bandDistUnderNewBoundaries: bandDist(newlyLosses, fittedBoundaries),
    },
    gameAccuracyUnderCurrentK: {
      oldTileForced: oldGameDist,
      newActionForced: newGameDistOldK,
    },
    aggregateFit: {
      method: FROZEN.calibrationAlgorithm,
      oldK: OLD_K,
      candidateV5K: fittedK,
      strongMeanLoss: strongMean,
      poorMeanLoss: poorMean,
      ordinaryMeanLoss: ordinaryMean,
      predictedStrong: predicted(strongMean, fittedK),
      predictedOrdinary: predicted(ordinaryMean, fittedK),
      predictedPoor: predicted(poorMean, fittedK),
      ordinaryInBand65_85:
        predicted(ordinaryMean, fittedK) >= 65 && predicted(ordinaryMean, fittedK) <= 85,
    },
    lossBands: {
      old: OLD_BOUNDARIES,
      candidateV5: fittedBoundaries,
      retained:
        OLD_BOUNDARIES.bestTolerance === fittedBoundaries.bestTolerance &&
        OLD_BOUNDARIES.inaccuracyToMistake === fittedBoundaries.inaccuracyToMistake &&
        OLD_BOUNDARIES.mistakeToBlunder === fittedBoundaries.mistakeToBlunder,
    },
    distributionsWithV5K: newGameDistNewK,
    harnessReport,
    lossHistogramsActionLevel: {
      strong: summarizeLosses('strong', 'k-fit-anchor', strongLosses),
      ordinary: summarizeLosses('ordinary', 'validation', ordinaryLosses),
      poor: summarizeLosses('poor', 'k-fit-anchor', worstLegalLosses),
    },
  };

  const outPath = join(
    SCRIPT_DIR,
    '..',
    '..',
    '..',
    '..',
    'docs',
    'review-accuracy-v5-action-forced-calibration.raw.json',
  );
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`Wrote ${outPath}`);
}

main();
