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
 * *** SIGNED OFF -- 2026-09-17, this v4 run. *** Product/data review of the
 * observed distribution (spec section 5 step 5) is complete for this run:
 * histograms, the fitted k/boundaries, and the pvf-bot-match hard/master
 * tier-ordering finding (persists in direction at n=1063/1119, but shrinks
 * to statistical noise -- z ~= 0.54 on independent 25-game data; not a
 * blocker, handed back as a separate possible `botHeuristics.ts`
 * investigation, not fixed here) were all reviewed and accepted.
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
