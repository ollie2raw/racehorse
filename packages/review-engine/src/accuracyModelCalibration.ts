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
 * *** SIGNED OFF -- 2026-09-22, v5 action-forced semantic migration. ***
 *
 * Forced predicate: action-level (`isForcedDecision` /
 * `countDistinctLegalActions(candidates) <= 1`). One tile with multiple
 * legal placements is NOT forced. See
 * `docs/review-accuracy-v5-action-forced-calibration.md`.
 *
 * History on this PR:
 *  1. Mechanical migration attempt under action-level → BLOCKED (ordinary
 *     PVF ~88.1 outside historical [65,85]; mechanical Best quantile → 0).
 *  2. Phase C provenance audit → published v4 K/bands/[65,85] were produced
 *     under obsolete tile-level forced on identical recorded trees.
 *  3. Project-lead policy: authorize v5 as a forced-semantics migration —
 *     refit K only; retain published semantic loss bands; demote [65,85] to
 *     historical v4 empirical validation (not a v5 gate).
 *  4. This file: final v5 constants under that policy.
 *
 * Aggregate (`CALIBRATED_K`): Phase C `fitKLeastSquares` over the corrected
 * action-level eligible exact/search population (strong→95, poor→15). Exact
 * harness float — do not hand-round.
 *
 * Loss bands (`LOSS_BAND_BOUNDARIES`): RETAINED from v4. The per-action loss
 * quantity `value(best) - value(played)` did not change; only eligibility
 * changed. Mechanical percentile re-fit under the zero-inflated newly
 * eligible same-tile/multi-placement mass collapses Best to 0 (p75(strong))
 * — rejected as a prevalence-driven quantile degeneracy, not a change in
 * severity semantics. Treat these thresholds as semantic thresholds on the
 * unchanged loss quantity, not population-share targets.
 *
 * Grades: unchanged (`gradeFromAccuracy` cutoffs).
 *
 * This sign-off clears CALIBRATED_K, LOSS_BAND_BOUNDARIES, and
 * ACCURACY_MODEL_CALIBRATION_VERSION for exactly two consumers, wired in
 * the same change that added this note (C4, phase-c-accuracy-model-spec.md
 * section 6):
 *  1. `reviewAccuracy.ts` -- `accuracyFromEvaluations`'s live default `k`
 *     and `ACCURACY_MODEL_VERSION`.
 *  2. `client/src/analyzer/gameAccuracyModel.ts` -- the §4a loss-band label
 *     function and `GameAccuracyModelResult` computation, via
 *     `LOSS_BAND_BOUNDARIES` re-exported from review-engine's `index.ts`.
 *
 * It is NOT a blanket clearance. A new consumer -- a different package, a
 * UI surface reading these numbers directly, anything computing its own
 * copy of the model -- needs its own explicit review, not an assumption
 * that this note already covers it. Note also (unchanged from C4's own
 * scope limit): being wired here does not mean players see it yet --
 * spec section 6's own cutover condition (a `GameAnalysis` only ever gets
 * a *populated* `accuracyModel` once a caller with real per-decision
 * `ReviewEvaluationV1` data computes one, which no shipping code does yet)
 * and any UI change are separate, later work.
 */

/**
 * Frozen calibration corpus revision for the v5 action-forced fit.
 * Bump this string AND recalibrate deliberately when recorded trees or
 * `REVIEW_FIXTURE_CORPUS` deliberately_poor fixtures change — do not silently
 * accept a drifted scorable denominator.
 */
export const V5_CALIBRATION_CORPUS_REVISION =
  'recorded-self-play+recorded-client-policy@2026-09-17+REVIEW_FIXTURE_CORPUS.deliberately_poor';

/** Action-level exact+search scorable count on the frozen recorded corpora (12,973 decisions). */
export const V5_FROZEN_RECORDED_SCORABLE_DENOMINATOR = 5538;

/** Spec section 3's single free parameter. Fitted 2026-09-22 (v5) via `fitKLeastSquares` under action-level forced. */
export const CALIBRATED_K = 0.20094184929012865;

/** Spec section 4a's three loss-band boundary constants. Semantic thresholds retained from v4 (see file header). */
export type CalibratedLossBandBoundaries = {
  readonly bestTolerance: number;
  readonly inaccuracyToMistake: number;
  readonly mistakeToBlunder: number;
};

export const LOSS_BAND_BOUNDARIES: CalibratedLossBandBoundaries = {
  // Retained from v4 publish (`943f5612`). Not re-derived from action-level
  // percentiles — mechanical Best=0 was rejected under the v5 migration policy.
  bestTolerance: 0.12999999999999995,
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
export const ACCURACY_MODEL_CALIBRATION_VERSION = 'accuracy-model-v5-action-forced-2026-09-22';
