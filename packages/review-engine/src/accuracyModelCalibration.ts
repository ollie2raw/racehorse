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
 * human checkpoint yet. The v2 run's specific blocker -- the worst_legal
 * (poor-play) anchor having only n=2 scorable decisions -- is resolved as
 * of this v3 run (n=44, spread across opening/midgame/endgame phases and
 * ~40 distinct seeds; see reviewFixtureCorpus.ts's own comment on its
 * `deliberately_poor` category). That resolves the specific data-volume
 * objection, not the sign-off itself: product/data review of the observed
 * distribution (spec section 5 step 5) is a separate, still-pending step.
 * Until that sign-off happens, do not import CALIBRATED_K,
 * LOSS_BAND_BOUNDARIES, or ACCURACY_MODEL_CALIBRATION_VERSION from anywhere
 * outside calibrateAccuracyModel.ts and its own tests -- including from
 * reviewAccuracy.ts, moveAnalyzer.ts, any UI, or any other production
 * consumer, per-move or aggregate.
 */

/** Spec section 3's single free parameter. Fitted 2026-09-17 (v3, worst_legal corpus expanded to n=44) -- see the harness report for method and full histogram detail. */
export const CALIBRATED_K = 0.19770906562806756;

/** Spec section 4a's three loss-band boundary constants. Same fitting run as CALIBRATED_K -- always version and republish together. */
export type CalibratedLossBandBoundaries = {
  readonly bestTolerance: number;
  readonly inaccuracyToMistake: number;
  readonly mistakeToBlunder: number;
};

export const LOSS_BAND_BOUNDARIES: CalibratedLossBandBoundaries = {
  bestTolerance: 0.12999999999999995,
  inaccuracyToMistake: 0.895,
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
export const ACCURACY_MODEL_CALIBRATION_VERSION = 'accuracy-model-v3-calibrated-2026-09-17';
