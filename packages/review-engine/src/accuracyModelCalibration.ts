/**
 * C2b (docs/scoping/phase-c-accuracy-model-spec.md, sections 3-5): the
 * published calibration artifact. Fitted by
 * `devtools/calibrateAccuracyModel.ts` against real loss histograms --
 * `daily-fritz-master`'s `strong-policy-top-tier` batch (chooseOfficialFritzDecision
 * at FritzTier 'master', C2a-2), `pvf-bot-match`'s tier-'standard' batch
 * (the real chooseBotMove policy, C2a-3), and `reviewFixtureCorpus.ts`'s
 * `deliberately_poor` fixtures (C2a-1 + its 2026-09-17 corpus-expansion
 * follow-up) -- not guessed, not hand-picked.
 *
 * Regenerate by running (from the repo root):
 *
 *   npx tsx packages/review-engine/src/devtools/calibrateAccuracyModel.ts
 *
 * This file is NOT imported by reviewAccuracy.ts, moveAnalyzer.ts, or
 * anything shipping -- it is a standalone, inspectable artifact pending
 * product/data sign-off on the observed distribution (spec section 5, step
 * 5), imported only by calibrateAccuracyModel.ts's own acceptance tests. Do
 * not wire this into `UNCALIBRATED_DEFAULT_K` / `ACCURACY_MODEL_VERSION`
 * (reviewAccuracy.ts) without that separate, explicit sign-off and a
 * dedicated cutover change.
 *
 * A re-run of the harness against the SAME committed corpus files
 * reproduces these exact numbers -- `daily-fritz-master` (chooseOfficialFritzDecision)
 * and the `pvf-bot-match` tier-'standard' batch are both fully
 * deterministic (recordSelfPlayCorpus.ts / recordClientPolicyCorpus.ts's
 * own `reproducible` manifest field confirms this), and the fixture corpus
 * is deterministic by construction. Only a change to the corpus files
 * themselves (a re-record, or a new/removed batch) or to the fitting method
 * should ever change these numbers -- if either happens, bump
 * `ACCURACY_MODEL_CALIBRATION_VERSION` and republish this whole file, never
 * edit the constants in place silently.
 *
 * *** PROVISIONAL -- NOT PRODUCT-REVIEWED -- NOT CLEARED FOR ANY PRODUCTION
 * CONSUMER. *** This specific run has not cleared the spec section 5 step 5
 * human checkpoint yet. The v2 run's blocker (worst_legal n=2) was resolved
 * in v3 (n=44). This v4 run widens the pvf-bot-match informational tiers
 * (hard/master) and the standard-tier validation anchor from 5 games each
 * to 30 (5 original + 25 new, independent seed) -- addressing a specific
 * finding from the v3 report: hard-tier's small (n=182) informational
 * sample showed a LOWER mean moveLoss than both standard and master, an
 * inverted difficulty ordering that could have been sampling noise or a
 * real tier-weighting issue. At this wider sample (hard n=1063, master
 * n=1119) the direction persists (hard mean 0.521 < master mean 0.619,
 * i.e. hard still edges out master) but the gap is no longer
 * distinguishable from noise (two-sample z ~= 1.42 on the combined data,
 * ~= 0.54 on the new 25-game-only data alone) -- see the harness report /
 * PR for full numbers. This is an observation about client/src/modules/
 * fritz/botHeuristics.ts's real chooseBotMove tier weighting, NOT
 * something this calibration artifact or its harness investigates or
 * fixes; botHeuristics.ts is untouched by this file. Product/data review
 * of the full observed distribution (spec section 5 step 5) is still a
 * separate, pending step. Until that sign-off happens, do not import
 * CALIBRATED_K, LOSS_BAND_BOUNDARIES, or ACCURACY_MODEL_CALIBRATION_VERSION
 * from anywhere outside calibrateAccuracyModel.ts and its own tests --
 * including from reviewAccuracy.ts, moveAnalyzer.ts, any UI, or any other
 * production consumer, per-move or aggregate.
 */

/** Spec section 3's single free parameter. Fitted 2026-09-17 (v4) -- unchanged from v3 since the strong-policy and worst_legal anchors this fits against are untouched by this run's corpus widening. See the harness report for method and full histogram detail. */
export const CALIBRATED_K = 0.19770906562806756;

/** Spec section 4a's three loss-band boundary constants. Same fitting run as CALIBRATED_K -- always version and republish together. */
export type CalibratedLossBandBoundaries = {
  readonly bestTolerance: number;
  readonly inaccuracyToMistake: number;
  readonly mistakeToBlunder: number;
};

export const LOSS_BAND_BOUNDARIES: CalibratedLossBandBoundaries = {
  bestTolerance: 0.12999999999999995,
  // Only this boundary moved from v3 (0.895 -> 0.79): it's fit from
  // pvf-bot-match standard-tier's own losses (p75), and standard-tier's
  // sample widened from 5 to 30 games this run.
  inaccuracyToMistake: 0.79,
  mistakeToBlunder: 5.98,
};

/**
 * Bump whenever CALIBRATED_K or LOSS_BAND_BOUNDARIES changes (a re-fit
 * against new/updated corpus data, or a change to the fitting method
 * itself) -- mirrors reviewAccuracy.ts's ACCURACY_MODEL_VERSION convention,
 * but is deliberately a SEPARATE constant/string space: this is the
 * calibration artifact's own version, not a value reviewAccuracy.ts reads
 * or stamps onto anything today.
 */
export const ACCURACY_MODEL_CALIBRATION_VERSION = 'accuracy-model-v4-calibrated-2026-09-17';
