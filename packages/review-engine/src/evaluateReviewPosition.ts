import type {
  ReviewCandidateEvaluationV1,
  ReviewEvaluationV1,
  ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { REVIEW_EVALUATION_VERSION } from '@racehorse/game-core/review';
import { solveExactEndgame, type ExactEndgameResult } from './solveExactEndgame';
import { solveHeuristicOpening } from './solveHeuristicOpening';
import {
  solveMidgameDeterminization,
  type MidgameConvergence,
  type MidgameDeterminizationResult,
} from './solveMidgameDeterminization';

/**
 * B0 (game-review-oracle-upgrade-2026-09-13.md): fixed compute budget for a
 * single evaluateReviewPosition call. Determinism requirement from the doc's
 * Phase B section — "fixed node/sample budgets for determinism (not
 * performance.now() cutoffs)".
 *
 * Kept as its own type (not folded into ReviewDispatchBudget below) because
 * B3's solveMidgameDeterminization already imports this exact type — it
 * stays exactly as it always has; nothing here changes its shape.
 */
export type ReviewSearchBudget = {
  readonly maxNodes: number;
  readonly maxHiddenStateSamples: number;
};

/**
 * The dispatcher's own, richer budget input (game-review-oracle-upgrade-
 * 2026-09-13.md, integration research). Superset of what any individual
 * solver needs, constructed per-solver internally rather than widening
 * ReviewSearchBudget itself into a union: a seed and a ply-depth cutoff
 * aren't really "budget" concepts, and B2 needs neither, so a single shared
 * type would carry irrelevant fields for two of the three solvers.
 */
export type ReviewDispatchBudget = {
  readonly maxNodes: number;
  readonly maxHiddenStateSamples: number;
  readonly maxPlyDepth: number;
  readonly seed: string | number;
};

function findPlayedCandidate(
  snapshot: ReviewPositionSnapshotV2,
  candidates: readonly ReviewCandidateEvaluationV1[],
): ReviewCandidateEvaluationV1 {
  const actualKey = JSON.stringify(snapshot.actualAction);
  const played = candidates.find((c) => JSON.stringify(c.action) === actualKey);
  // Every legal action (actualAction included, per the capture contract)
  // gets a candidate from every solver here -- a miss would mean the
  // solver silently dropped a legal action, not a legitimate runtime case
  // to paper over with a fallback guess.
  if (!played) {
    throw new Error(
      'evaluateReviewPosition: no candidate matches snapshot.actualAction -- the solver dropped a legal action.',
    );
  }
  return played;
}

function computeLoss(
  played: ReviewCandidateEvaluationV1,
  best: ReviewCandidateEvaluationV1,
): ReviewEvaluationV1['loss'] {
  return {
    expectedPointDifferential: best.value.expectedPointDifferential - played.value.expectedPointDifferential,
    winProbability: null,
  };
}

function adaptExactEndgameResult(
  snapshot: ReviewPositionSnapshotV2,
  result: ExactEndgameResult,
): ReviewEvaluationV1 {
  const played = findPlayedCandidate(snapshot, result.candidates);
  return {
    evaluationVersion: REVIEW_EVALUATION_VERSION,
    snapshotId: snapshot.identifiers.decisionId,
    rulesVersion: snapshot.rulesVersion,
    reviewEngineVersion: snapshot.reviewEngineVersion,
    evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
    played,
    best: result.best,
    candidates: result.candidates,
    loss: computeLoss(played, result.best),
    search: {
      nodes: result.nodes,
      // B2 searches exhaustively to the hand's real end -- there is no
      // fixed ply cutoff to report (unlike B3's maxPlyDepth below), so 0 is
      // the honest value here, not a fabricated "no search happened" claim.
      depth: 0,
      hiddenStateSamples: result.hiddenStateSamples,
      coverage: result.coverage,
      complete: result.complete,
    },
    diagnostics: [],
  };
}

function adaptMidgameDeterminizationResult(
  snapshot: ReviewPositionSnapshotV2,
  result: MidgameDeterminizationResult,
  maxPlyDepth: number,
): ReviewEvaluationV1 {
  const played = findPlayedCandidate(snapshot, result.candidates);
  return {
    evaluationVersion: REVIEW_EVALUATION_VERSION,
    snapshotId: snapshot.identifiers.decisionId,
    rulesVersion: snapshot.rulesVersion,
    reviewEngineVersion: snapshot.reviewEngineVersion,
    // Only ever reached on the coverage >= threshold branch (see
    // evaluateReviewPosition below) -- below-threshold results fall through
    // to solveHeuristicOpening entirely rather than surfacing here as a
    // low-confidence 'search' result (a near-zero-coverage average can
    // still carry a confident-looking nonzero point-differential number
    // built from a handful of samples; full fallthrough to B4's
    // structurally-conservative heuristic avoids ever surfacing that false
    // precision). Confidence is therefore always 'medium' here in practice.
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    played,
    best: result.best,
    candidates: result.candidates,
    loss: computeLoss(played, result.best),
    search: {
      nodes: result.nodes,
      depth: maxPlyDepth,
      hiddenStateSamples: result.hiddenStateSamples,
      coverage: result.coverage,
      complete: result.complete,
    },
    // B3's convergence diagnostic has no dedicated field on
    // ReviewEvaluationV1 (game-core, untouched here) -- folded into
    // diagnostics, same convention B4 used for its raw heuristic scores.
    diagnostics: [
      `convergence: sameTopAction=${result.convergence.sameTopAction}, valueDelta=${result.convergence.valueDelta}`,
    ],
    // Structured form of the same data the diagnostics entry above already
    // carries as a formatted string -- both present, not one replacing the
    // other, per Phase C's structured-signal decision.
    convergence: result.convergence,
  };
}

/**
 * Annotates a heuristic-path result with why the dispatcher fell through to
 * it -- solveHeuristicOpening itself has no way to know this (see
 * heuristicFallbackReason's own doc comment on the type). `searchAttempt`
 * carries the real, sub-threshold coverage/convergence from an abandoned
 * B3 attempt (the 'coverage-below-threshold' case only) so that real signal
 * isn't silently discarded in favor of B4's own honest-zero defaults;
 * B4's own `nodes`/`depth`/`hiddenStateSamples`/`complete` values are left
 * alone, since those describe B4's own (different) computation, not B3's.
 */
function withHeuristicFallbackReason(
  result: ReviewEvaluationV1,
  reason: NonNullable<ReviewEvaluationV1['heuristicFallbackReason']>,
  searchAttempt?: { readonly coverage: number; readonly convergence: MidgameConvergence },
): ReviewEvaluationV1 {
  return {
    ...result,
    heuristicFallbackReason: reason,
    search: searchAttempt ? { ...result.search, coverage: searchAttempt.coverage } : result.search,
    convergence: searchAttempt ? searchAttempt.convergence : result.convergence,
  };
}

/**
 * B-integration (game-review-oracle-upgrade-2026-09-13.md): the dispatch
 * tree wiring B2-B4 together, locked from a dedicated research pass.
 *
 * `coverageThreshold` is a required, explicit parameter -- not a hardcoded
 * constant -- specifically so the still-provisional number (2%, see issue
 * #226) can be revisited without a code change once real product/data
 * review calibrates it.
 *
 * Dispatch, with every fallback edge reasoned through in research rather
 * than assumed:
 *  - `drawableCount === 0` -> solveExactEndgame. Non-null -> `exact`/`high`.
 *    Null (locked yard but zero feasible allocations, issue #220) ->
 *    solveHeuristicOpening directly. solveMidgameDeterminization is never
 *    called here: both solvers compute feasibility from the exact same
 *    inputs (resolveHiddenPoolEligibility + the same nCr math), so a B2
 *    null on this snapshot is a mathematical guarantee that B3 would also
 *    return null on it -- calling it would be a guaranteed-redundant call,
 *    not a real fallback.
 *  - `drawableCount > 0` -> solveMidgameDeterminization. Null (B3's own
 *    Adjustment 1 global infeasibility) -> solveHeuristicOpening.
 *    Non-null and `coverage >= coverageThreshold` -> `search`/`medium`.
 *    Non-null and below threshold -> solveHeuristicOpening (full
 *    fallthrough, not a down-weighted search result -- see the comment on
 *    adaptMidgameDeterminizationResult above for why).
 *  - No separate "is this the opening" detector exists. Research found
 *    that a real opening fixture (empty board, full hand) and a real
 *    near-win midgame fixture have nearly identical structural signatures
 *    (hand size, board tile count, action count) -- a mechanical opening
 *    detector built from those fields would risk misclassifying one as the
 *    other. Genuine openings naturally produce the largest hidden-state
 *    spaces and therefore the lowest B3 coverage, so they fall through to
 *    B4 via the same coverage-threshold path used for any other
 *    insufficiently-resolved midgame position -- no bespoke phase concept
 *    needed.
 */
export function evaluateReviewPosition(
  snapshot: ReviewPositionSnapshotV2,
  budget: ReviewDispatchBudget,
  coverageThreshold: number,
): ReviewEvaluationV1 {
  if (snapshot.preAction.boneyard.drawableCount === 0) {
    const exact = solveExactEndgame(snapshot, { maxNodes: budget.maxNodes });
    if (exact !== null) return adaptExactEndgameResult(snapshot, exact);
    return withHeuristicFallbackReason(solveHeuristicOpening(snapshot), 'locked-yard-infeasible');
  }

  const midgame = solveMidgameDeterminization(
    snapshot,
    { maxNodes: budget.maxNodes, maxHiddenStateSamples: budget.maxHiddenStateSamples },
    budget.seed,
    budget.maxPlyDepth,
  );
  if (midgame === null) {
    return withHeuristicFallbackReason(solveHeuristicOpening(snapshot), 'globally-infeasible');
  }
  if (midgame.coverage >= coverageThreshold) {
    return adaptMidgameDeterminizationResult(snapshot, midgame, budget.maxPlyDepth);
  }
  return withHeuristicFallbackReason(solveHeuristicOpening(snapshot), 'coverage-below-threshold', {
    coverage: midgame.coverage,
    convergence: midgame.convergence,
  });
}
