/**
 * C2b (docs/scoping/phase-c-accuracy-model-spec.md, section 5): the
 * calibration harness. Fits `k` (spec section 3) and the three loss-band
 * boundaries (spec section 4a) against real loss histograms, computed from
 * real, recorded corpora plus the hand-authored fixture corpus -- no
 * fabricated or hand-picked constants.
 *
 * Inputs, mapped onto C0 section 5's five named fixture categories:
 *  - `daily-fritz-master` corpus, `strong-policy-top-tier` batch (FritzTier
 *    'master') -- C0's "Strong policy play (Master Fritz without tier
 *    noise, recorded)". THE strong-policy anchor for k.
 *  - `pvf-bot-match` corpus, tier 'standard' -- C0's "Ordinary PVF-tier
 *    play". A validation check on the fitted k (per the C2b task scope --
 *    NOT a second independent fitting target), and an anchor for the
 *    middle (inaccuracyToMistake) boundary.
 *  - `reviewFixtureCorpus.ts`'s `deliberately_poor` category (the
 *    'worst_legal' fixture strategy, confirmed reachable and real by
 *    reviewFixtureCorpus.deliberatelyPoor.test.ts) -- C0's "Deliberately
 *    poor / random-legal play". The poor-play anchor for k, and for the
 *    mistakeToBlunder boundary.
 *  - `reviewFixtureCorpus.ts`'s `forced_move` category -- C0's "Forced-move
 *    fixtures". Excluded from the loss-histogram fit entirely (not
 *    scorable, per spec section 2a) but read and evaluated here anyway so
 *    the forced-move-invariance acceptance test (item 4) has a real forced
 *    decision, run through the real dispatcher, to add/remove.
 *  - `pvf-bot-match` corpus, tiers 'hard'/'master' -- computed and reported
 *    for completeness, but explicitly NOT used as a fitting or validation
 *    target (see the module doc on ReviewCaptureCorpusKind and the C2a-3
 *    fidelity finding: 'hard'/'master' chooseBotMove are wall-clock timing
 *    sensitive, not purely state-seeded, so their exact loss distribution
 *    is not byte-reproducible the way every other input here is).
 *  - `daily-fritz-master` corpus, `ordinary-pvf-tier` batch (FritzTier
 *    'standard') -- also informational only. Distinct from the
 *    strong-policy anchor above; not one of C0's five named categories on
 *    its own, kept in the report for transparency about what data this
 *    harness actually read.
 *
 * "Oracle self-play / exact-endgame trajectory" (C0's remaining, still-open
 * gap category) is intentionally NOT read here -- C0 section 5 already
 * names it a real, separate gap this item does not claim to close. Item 2's
 * optimal-game ceiling acceptance test (packaged with the acceptance tests,
 * item 4) covers the "moveLoss = 0 ceiling" need directly instead, per the
 * C2b task's own explicit instruction not to build a new capture harness
 * for it.
 *
 * Hard runtime guard: `readCorpusDir` throws immediately if any manifest or
 * any individual record carries a `corpusKind` outside
 * `RECOGNIZED_CORPUS_KINDS` -- an unrecognized future corpus kind must be a
 * reviewed, explicit code change, never silently included or excluded.
 *
 * This is a manually-invoked script, the same convention as
 * recordSelfPlayCorpus.ts / recordClientPolicyCorpus.ts -- not wired into
 * CI, not part of any test suite, not run automatically. Invoke directly,
 * e.g.:
 *
 *   npx tsx packages/review-engine/src/devtools/calibrateAccuracyModel.ts
 *
 * Prints a JSON `CalibrationReport` to stdout. The published artifact,
 * `../accuracyModelCalibration.ts`, is a separate, hand-committed file --
 * this script does not write it automatically, so a re-run's numbers are
 * never silently republished without a human reading the report first.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewEvaluationV1 } from '@racehorse/game-core/review';
import { evaluateReviewPosition, type ReviewDispatchBudget } from '../evaluateReviewPosition';
import { isScorable } from '../reviewAccuracy';
import { LOSS_BAND_BOUNDARIES } from '../accuracyModelCalibration';
import {
  deserializeReviewCaptureRecordsFromJsonl,
  type ReviewCaptureCorpusKind,
  type ReviewCaptureManifest,
  type ReviewCaptureRecord,
} from '../reviewCaptureSchema';
// Same convention reviewFixtureCorpus.deliberatelyPoor.test.ts already
// uses: import the real source path directly, not through a package
// export -- REVIEW_FIXTURE_CORPUS is test/devtools-only fixture data, not
// part of game-core's public API surface (no "./reviewFixtureCorpus" entry
// in its package.json "exports" map).
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const RECORDED_SELF_PLAY_DIR = join(SCRIPT_DIR, '..', '..', 'fixtures', 'recorded-self-play');
export const RECORDED_CLIENT_POLICY_DIR = join(SCRIPT_DIR, '..', '..', 'fixtures', 'recorded-client-policy');

const RECOGNIZED_CORPUS_KINDS: readonly ReviewCaptureCorpusKind[] = ['daily-fritz-master', 'pvf-bot-match'];

function assertRecognizedCorpusKind(value: string, source: string): void {
  if (!(RECOGNIZED_CORPUS_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `Unrecognized corpusKind "${value}" in ${source} -- refusing to silently include or exclude it from ` +
      `calibration. A new corpus kind must be an explicit, reviewed decision: teach this harness how to bucket ` +
      `it (fitting anchor, validation, or informational) before adding it to RECOGNIZED_CORPUS_KINDS.`,
    );
  }
}

/** Reads every *.jsonl + its sidecar *.manifest.json in a corpus directory, refusing unrecognized corpusKind values. */
export function readCorpusDir(dir: string): ReviewCaptureRecord[] {
  const jsonlFiles = readdirSync(dir).filter((file) => file.endsWith('.jsonl')).sort();
  const records: ReviewCaptureRecord[] = [];
  for (const file of jsonlFiles) {
    const base = file.slice(0, -'.jsonl'.length);
    const manifestPath = join(dir, `${base}.manifest.json`);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReviewCaptureManifest;
    assertRecognizedCorpusKind(manifest.corpusKind, manifestPath);

    const fileRecords = deserializeReviewCaptureRecordsFromJsonl(readFileSync(join(dir, file), 'utf8'));
    fileRecords.forEach((record, index) => {
      assertRecognizedCorpusKind(record.corpusKind, `${file}:${index} (gameIndex=${record.gameIndex}, moveNumber=${record.moveNumber})`);
    });
    records.push(...fileRecords);
  }
  return records;
}

/** Every scorable (per C0 section 2 / reviewAccuracy.ts's isScorable) decision's moveLoss. */
export function scorableLosses(records: readonly ReviewCaptureRecord[]): number[] {
  return records
    .filter((record) => isScorable(record.evaluation, record.evaluation.candidates))
    .map((record) => record.evaluation.loss.expectedPointDifferential);
}

/**
 * Same realistic budget every other fixture-driven evaluation in this
 * package uses (evaluateReviewPosition.test.ts,
 * reviewFixtureCorpus.deliberatelyPoor.test.ts) -- keeps the hand-authored
 * fixture corpus's evaluations comparable to the recorded corpora.
 */
export const CALIBRATION_FIXTURE_BUDGET: ReviewDispatchBudget = {
  maxNodes: 200_000,
  // Opening fixtures (e.g. deliberately-poor-opening-s21-a10) need ~376+
  // samples to clear the 2% coverage diagnostic after evidence/hidden-pool
  // tightening. Historical 100 was enough under the pre-evidence dispatcher;
  // 500 keeps the corpus scorable without changing K/bands.
  maxHiddenStateSamples: 500,
  maxPlyDepth: 2,
  seed: 'calibrate-accuracy-model-fixtures',
};
export const CALIBRATION_FIXTURE_COVERAGE_THRESHOLD = 0.02;

export type EvaluatedFixture = {
  readonly id: string;
  readonly category: (typeof REVIEW_FIXTURE_CORPUS)[number]['category'];
  readonly evaluation: ReviewEvaluationV1;
};

/** Runs every hand-authored fixture through the real dispatcher (no mocks, no stub solver). */
export function evaluateFixtureCorpus(): EvaluatedFixture[] {
  return REVIEW_FIXTURE_CORPUS.map((fixture) => ({
    id: fixture.id,
    category: fixture.category,
    evaluation: evaluateReviewPosition(fixture.snapshot, CALIBRATION_FIXTURE_BUDGET, CALIBRATION_FIXTURE_COVERAGE_THRESHOLD),
  }));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Linear-interpolation percentile ("type 7", R's default / numpy's default) over an ascending-sorted array. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) throw new Error('percentile of an empty array is undefined.');
  if (sortedAscending.length === 1) return sortedAscending[0];
  const rank = (p / 100) * (sortedAscending.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedAscending[lower];
  const fraction = rank - lower;
  return sortedAscending[lower] * (1 - fraction) + sortedAscending[upper] * fraction;
}

export type LossHistogramSummary = {
  readonly label: string;
  readonly role: 'k-fit-anchor' | 'validation' | 'informational' | 'excluded-forced';
  readonly count: number;
  readonly mean: number | null;
  readonly median: number | null;
  readonly p10: number | null;
  readonly p90: number | null;
};

export function summarizeLosses(label: string, role: LossHistogramSummary['role'], losses: readonly number[]): LossHistogramSummary {
  if (losses.length === 0) {
    return { label, role, count: 0, mean: null, median: null, p10: null, p90: null };
  }
  const sorted = [...losses].sort((a, b) => a - b);
  return {
    label,
    role,
    count: sorted.length,
    mean: mean(sorted),
    median: percentile(sorted, 50),
    p10: percentile(sorted, 10),
    p90: percentile(sorted, 90),
  };
}

function predictedMeanAccuracy(meanLoss: number | null, k: number): number | null {
  if (meanLoss === null) return null;
  return Math.min(100, Math.max(0, 100 * Math.exp(-k * meanLoss)));
}

export type CalibrationAnchor = {
  readonly label: string;
  readonly meanLoss: number;
  readonly targetAccuracy: number;
};

/**
 * Fits `k` by least-squares against the anchors' target accuracy bands
 * (`accuracy = clamp(100 * exp(-k * meanLoss), 0, 100)`, spec section 3).
 * Real numerical method, not a hand-picked constant: a coarse log-spaced
 * grid search first brackets the minimum of the sum-of-squared-residuals
 * objective (bounded-exponential-decay objectives here are well-behaved --
 * a grid pass avoids just assuming that instead of checking it), then a
 * golden-section search refines within the bracket to high precision.
 */
export function fitKLeastSquares(anchors: readonly CalibrationAnchor[]): number {
  if (anchors.length === 0) throw new Error('fitKLeastSquares requires at least one anchor.');
  const objective = (k: number): number =>
    anchors.reduce((sum, anchor) => sum + (100 * Math.exp(-k * anchor.meanLoss) - anchor.targetAccuracy) ** 2, 0);

  const gridLo = 1e-6;
  const gridHi = 20;
  const gridSteps = 20_000;
  const logLo = Math.log(gridLo);
  const logHi = Math.log(gridHi);
  let bestIndex = 0;
  let bestObjective = Infinity;
  const grid: number[] = new Array(gridSteps + 1);
  for (let i = 0; i <= gridSteps; i += 1) {
    const k = Math.exp(logLo + (i / gridSteps) * (logHi - logLo));
    grid[i] = k;
    const value = objective(k);
    if (value < bestObjective) {
      bestObjective = value;
      bestIndex = i;
    }
  }

  let lo = grid[Math.max(0, bestIndex - 1)];
  let hi = grid[Math.min(grid.length - 1, bestIndex + 1)];
  const goldenRatio = (Math.sqrt(5) - 1) / 2;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const c = hi - goldenRatio * (hi - lo);
    const d = lo + goldenRatio * (hi - lo);
    if (objective(c) < objective(d)) {
      hi = d;
    } else {
      lo = c;
    }
  }
  return (lo + hi) / 2;
}

export type FittedBoundaries = {
  readonly bestTolerance: number;
  readonly inaccuracyToMistake: number;
  readonly mistakeToBlunder: number;
};

/**
 * Percentile-based boundary fit (spec section 4a), each boundary anchored
 * on the category whose loss distribution it most directly marks the edge
 * of:
 *  - `bestTolerance` = p75 of the strong-policy anchor's own losses -- a
 *    tolerance covering the bulk of a near-perfect policy's near-zero-loss
 *    mass, per the spec's "within search tolerance of top" wording (not
 *    `=== 0` exactly).
 *  - `inaccuracyToMistake` = p75 of the ordinary-PVF anchor's losses --
 *    the middle boundary, anchored on the middle (ordinary-play) category.
 *    NOT the median: both real corpora here are heavily zero-inflated
 *    (strong-policy 71% exact-zero-loss decisions, ordinary-PVF 55% --
 *    checked directly against the recorded data, not assumed), so the
 *    ordinary-PVF median lands at exactly 0 -- degenerate, and lower than
 *    even the strong-policy p75, which would break strict boundary
 *    ordering. p75 is the smallest ordinary-PVF percentile that is
 *    reliably above the routine near-optimal mass, i.e. where a decision
 *    starts looking like a genuine mistake rather than typical play.
 *  - `mistakeToBlunder` = p10 of the poor-play anchor's losses -- the low
 *    end of deliberately-poor play's own loss mass, marking where "clearly
 *    bad" begins.
 * Throws if the three do not come out strictly increasing -- a violation
 * would mean the underlying categories are not actually separated by
 * quality, which is a calibration-data problem to surface loudly, not a
 * boundary-ordering bug to silently reorder past.
 */
export function fitBoundaries(
  strongPolicyLosses: readonly number[],
  ordinaryPvfLosses: readonly number[],
  poorPlayLosses: readonly number[],
): FittedBoundaries {
  const bestTolerance = percentile([...strongPolicyLosses].sort((a, b) => a - b), 75);
  const inaccuracyToMistake = percentile([...ordinaryPvfLosses].sort((a, b) => a - b), 75);
  const mistakeToBlunder = percentile([...poorPlayLosses].sort((a, b) => a - b), 10);

  if (!(bestTolerance < inaccuracyToMistake && inaccuracyToMistake < mistakeToBlunder)) {
    throw new Error(
      `Fitted loss-band boundaries are not strictly increasing (bestTolerance=${bestTolerance}, ` +
      `inaccuracyToMistake=${inaccuracyToMistake}, mistakeToBlunder=${mistakeToBlunder}) -- the calibration data ` +
      `or method needs review before publishing, not a silent reordering.`,
    );
  }
  return { bestTolerance, inaccuracyToMistake, mistakeToBlunder };
}

// Midpoint of the spec's daily-fritz-master target band (~92-98).
const K_TARGET_STRONG_POLICY = 95;
// Comfortably below the spec's worst_legal target ceiling (<25) -- leaves
// real margin rather than fitting exactly to the boundary.
const K_TARGET_POOR_PLAY = 15;

export type CalibrationReport = {
  readonly histograms: {
    readonly dailyFritzMasterStrong: LossHistogramSummary;
    readonly pvfBotMatchStandard: LossHistogramSummary;
    readonly worstLegal: LossHistogramSummary;
    readonly forcedMove: { readonly count: number; readonly fixtureIds: readonly string[] };
    readonly informational: {
      readonly dailyFritzMasterOrdinaryTierSelfPlay: LossHistogramSummary;
      readonly pvfBotMatchHardTier: LossHistogramSummary;
      readonly pvfBotMatchMasterTier: LossHistogramSummary;
    };
  };
  readonly fit: {
    readonly method: string;
    readonly k: number;
    readonly targets: { readonly strongPolicy: number; readonly poorPlay: number };
    /**
     * Published semantic loss bands. Under v5 these are the retained v4
     * thresholds (not the mechanical percentile re-fit).
     */
    readonly boundaries: FittedBoundaries;
    readonly boundaryMethod: string;
    /**
     * Diagnostic only: what `fitBoundaries` would emit on the current
     * action-level population. Not published under the v5 migration policy
     * (Best collapses to 0 from zero-inflated newly eligible actions).
     */
    readonly mechanicalPercentileBoundaries: FittedBoundaries;
  };
  readonly predictedMeanAccuracy: {
    readonly dailyFritzMasterStrong: number | null;
    readonly pvfBotMatchStandard: number | null;
    readonly worstLegal: number | null;
    readonly dailyFritzMasterOrdinaryTierSelfPlay: number | null;
    readonly pvfBotMatchHardTier: number | null;
    readonly pvfBotMatchMasterTier: number | null;
  };
  readonly validation: {
    /**
     * Historical v4 empirical validation range under tile-level forced.
     * NOT a v5 acceptance gate (project-lead 2026-09-22). Kept for provenance.
     */
    readonly historicalV4OrdinaryPvfBand: readonly [65, 85];
    readonly ordinaryPvfPredictedAccuracy: number | null;
    readonly ordinaryWithinHistoricalV4Band: boolean;
    readonly ordinaryPvfIsV5Gate: false;
  };
};

export function runCalibration(): CalibrationReport {
  const selfPlayRecords = readCorpusDir(RECORDED_SELF_PLAY_DIR);
  const clientPolicyRecords = readCorpusDir(RECORDED_CLIENT_POLICY_DIR);

  const strongPolicyRecords = selfPlayRecords.filter((record) => record.batchTag === 'strong-policy-top-tier');
  const ordinaryTierSelfPlayRecords = selfPlayRecords.filter((record) => record.batchTag === 'ordinary-pvf-tier');
  const pvfStandardRecords = clientPolicyRecords.filter((record) => record.tier === 'standard');
  const pvfHardRecords = clientPolicyRecords.filter((record) => record.tier === 'hard');
  const pvfMasterRecords = clientPolicyRecords.filter((record) => record.tier === 'master');

  const fixtureEvaluations = evaluateFixtureCorpus();
  const worstLegalFixtures = fixtureEvaluations.filter((fixture) => fixture.category === 'deliberately_poor');
  const forcedMoveFixtures = fixtureEvaluations.filter((fixture) => fixture.category === 'forced_move');
  const worstLegalLosses = worstLegalFixtures
    .filter((fixture) => isScorable(fixture.evaluation, fixture.evaluation.candidates))
    .map((fixture) => fixture.evaluation.loss.expectedPointDifferential);

  const strongPolicyLosses = scorableLosses(strongPolicyRecords);
  const pvfStandardLosses = scorableLosses(pvfStandardRecords);
  const ordinaryTierSelfPlayLosses = scorableLosses(ordinaryTierSelfPlayRecords);
  const pvfHardLosses = scorableLosses(pvfHardRecords);
  const pvfMasterLosses = scorableLosses(pvfMasterRecords);

  const dailyFritzMasterStrong = summarizeLosses('daily-fritz-master, strong-policy-top-tier batch (FritzTier master)', 'k-fit-anchor', strongPolicyLosses);
  const pvfBotMatchStandard = summarizeLosses('pvf-bot-match, tier standard', 'validation', pvfStandardLosses);
  const worstLegal = summarizeLosses('reviewFixtureCorpus deliberately_poor (worst_legal strategy)', 'k-fit-anchor', worstLegalLosses);
  const dailyFritzMasterOrdinaryTierSelfPlay = summarizeLosses('daily-fritz-master, ordinary-pvf-tier batch (FritzTier standard)', 'informational', ordinaryTierSelfPlayLosses);
  const pvfBotMatchHardTier = summarizeLosses('pvf-bot-match, tier hard', 'informational', pvfHardLosses);
  const pvfBotMatchMasterTier = summarizeLosses('pvf-bot-match, tier master', 'informational', pvfMasterLosses);

  if (dailyFritzMasterStrong.mean === null) throw new Error('No scorable daily-fritz-master (strong-policy-top-tier) decisions found -- cannot fit k.');
  if (worstLegal.mean === null) throw new Error('No scorable worst_legal (deliberately_poor) decisions found -- cannot fit k.');

  const fittedK = fitKLeastSquares([
    { label: dailyFritzMasterStrong.label, meanLoss: dailyFritzMasterStrong.mean, targetAccuracy: K_TARGET_STRONG_POLICY },
    { label: worstLegal.label, meanLoss: worstLegal.mean, targetAccuracy: K_TARGET_POOR_PLAY },
  ]);

  // Diagnostic percentile re-fit on the current (action-level) population.
  // v5 does NOT publish these — Best collapses to 0 under zero-inflated
  // newly eligible same-tile/multi-placement mass. Published bands are the
  // retained semantic thresholds in accuracyModelCalibration.ts.
  const mechanicalPercentileBoundaries = fitBoundaries(
    strongPolicyLosses,
    pvfStandardLosses,
    worstLegalLosses,
  );
  const boundaries: FittedBoundaries = {
    bestTolerance: LOSS_BAND_BOUNDARIES.bestTolerance,
    inaccuracyToMistake: LOSS_BAND_BOUNDARIES.inaccuracyToMistake,
    mistakeToBlunder: LOSS_BAND_BOUNDARIES.mistakeToBlunder,
  };

  const pvfBotMatchStandardPredicted = predictedMeanAccuracy(pvfBotMatchStandard.mean, fittedK);

  return {
    histograms: {
      dailyFritzMasterStrong,
      pvfBotMatchStandard,
      worstLegal,
      forcedMove: { count: forcedMoveFixtures.length, fixtureIds: forcedMoveFixtures.map((fixture) => fixture.id) },
      informational: { dailyFritzMasterOrdinaryTierSelfPlay, pvfBotMatchHardTier, pvfBotMatchMasterTier },
    },
    fit: {
      method: 'least-squares (grid-search bracket + golden-section refinement) against 2 anchors: daily-fritz-master strong-policy-top-tier mean loss -> target accuracy 95 (midpoint of the 92-98 band), and worst_legal mean loss -> target accuracy 15 (comfortably below the <25 ceiling). Forced semantics: action-level (isForcedDecision).',
      k: fittedK,
      targets: { strongPolicy: K_TARGET_STRONG_POLICY, poorPlay: K_TARGET_POOR_PLAY },
      boundaries,
      boundaryMethod:
        'v5: RETAIN published semantic thresholds (bestTolerance / inaccuracyToMistake / mistakeToBlunder) from v4. Loss quantity unchanged; only eligibility changed. Mechanical percentile fitBoundaries (p75 strong / p75 ordinary / p10 poor) is reported separately as mechanicalPercentileBoundaries and is NOT published.',
      mechanicalPercentileBoundaries,
    },
    predictedMeanAccuracy: {
      dailyFritzMasterStrong: predictedMeanAccuracy(dailyFritzMasterStrong.mean, fittedK),
      pvfBotMatchStandard: pvfBotMatchStandardPredicted,
      worstLegal: predictedMeanAccuracy(worstLegal.mean, fittedK),
      dailyFritzMasterOrdinaryTierSelfPlay: predictedMeanAccuracy(dailyFritzMasterOrdinaryTierSelfPlay.mean, fittedK),
      pvfBotMatchHardTier: predictedMeanAccuracy(pvfBotMatchHardTier.mean, fittedK),
      pvfBotMatchMasterTier: predictedMeanAccuracy(pvfBotMatchMasterTier.mean, fittedK),
    },
    validation: {
      historicalV4OrdinaryPvfBand: [65, 85],
      ordinaryPvfPredictedAccuracy: pvfBotMatchStandardPredicted,
      ordinaryWithinHistoricalV4Band:
        pvfBotMatchStandardPredicted !== null &&
        pvfBotMatchStandardPredicted >= 65 &&
        pvfBotMatchStandardPredicted <= 85,
      ordinaryPvfIsV5Gate: false,
    },
  };
}

function main(): void {
  const report = runCalibration();
  console.log(JSON.stringify(report, null, 2));
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main();
}
