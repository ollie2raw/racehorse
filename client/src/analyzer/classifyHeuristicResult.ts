import { dedupeCandidatesByTile } from '@racehorse/game-core/review';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';

export { dedupeCandidatesByTile };

/**
 * The 'calibrated' variant is D5's (game-review-oracle-upgrade-2026-09-13.md
 * Phase D), not produced by classifyHeuristicResult below -- it's the
 * exact/search-evidence sibling result selectMoveHeuristicClassification
 * (useMoveHeuristicClassification.ts) returns via lossBandLabelForEvaluation
 * (phase-c-accuracy-model-spec.md section 4a). Kept in this shared union
 * rather than a separate type because both are "a real per-move
 * classification GameReviewer can render instead of the legacy rating" --
 * the same caller-facing concept, just backed by two different real-evidence
 * tiers with different label vocabularies (3-bucket heuristic vs the
 * calibrated 4-band scale).
 */
export type HeuristicClassification =
  | { readonly kind: 'forced' }
  | { readonly kind: 'unclear'; readonly reason: 'globally-infeasible' | 'flat-spread' }
  | { readonly kind: 'bucket'; readonly bucket: 'Good' | 'Inaccuracy' | 'Blunder' }
  | { readonly kind: 'calibrated'; readonly label: 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder' };

// Provisional, from a real but tiny (n=3) dataset -- see issue #231 for the
// full evidentiary basis and what would need to happen before these are
// finalized (real product/data review against live game data).
const FLAT_SPREAD_THRESHOLD = 5;
const GOOD_THRESHOLD = 0.25;
const INACCURACY_THRESHOLD = 0.6;

function findCandidateByAction(
  candidates: readonly ReviewCandidateEvaluationV1[],
  action: ReviewAction,
): ReviewCandidateEvaluationV1 | undefined {
  // Same JSON.stringify(action) equality convention evaluateReviewPosition.ts's
  // own findPlayedCandidate uses -- reused deliberately rather than
  // reinventing tile-matching logic.
  const key = JSON.stringify(action);
  return candidates.find((c) => JSON.stringify(c.action) === key);
}

export type ClassifyHeuristicOptions = {
  /**
   * D2: when present, heuristic classification is Fritz-relative (or any
   * explicit primary reference), not oracle-max rawScore relative. Matching
   * the primary can never render Blunder/Inaccuracy.
   */
  readonly primaryReferenceAction?: ReviewAction;
};

/**
 * Phase C (game-review-oracle-upgrade-2026-09-13.md): classifies a
 * heuristic-confidence ReviewEvaluationV1 into the coarse 3-bucket scale,
 * a distinct "Unclear" state, or "forced" -- never the full 6-bucket scale
 * classifyMove uses for exact/search results, which this function neither
 * touches nor replaces. Client-side (not packages/review-engine) because
 * bucket/rating policy is a presentation concern, the same reasoning that
 * already keeps classifyMove and MoveRating client-side.
 *
 * When `primaryReferenceAction` is supplied (D2 Fritz-primary path), loss is
 * measured against that action's rawScore among candidates — never against
 * the oracle-heuristic max alone. That removes the BLUNDER + "Best move"
 * contradiction when the player matches Fritz but not the oracle max.
 */
export function classifyHeuristicResult(
  evaluation: ReviewEvaluationV1,
  options?: ClassifyHeuristicOptions,
): HeuristicClassification {
  // Unconditional, before anything else: no valid hidden-state model at
  // all is a different kind of not-knowing than "the heuristic evaluated
  // fine but everything looked equally good" -- confirmed during research
  // that globally-infeasible can coexist with a large, real spread, so
  // spread must never be allowed to override this.
  if (evaluation.heuristicFallbackReason === 'globally-infeasible') {
    return { kind: 'unclear', reason: 'globally-infeasible' };
  }

  const playedCandidate = findCandidateByAction(evaluation.candidates, evaluation.played.action);
  const playedRawScore = playedCandidate?.rawScore;

  const deduped = dedupeCandidatesByTile(evaluation.candidates);
  const rawScores = deduped
    .map((c) => c.rawScore)
    .filter((score): score is number => typeof score === 'number');

  if (rawScores.length < 2) {
    // Either a genuinely single-legal-move decision, or multiple candidates
    // that all turned out to be position-variants of the same tile -- both
    // are "no real choice existed here", not "we don't know which was
    // best".
    return { kind: 'forced' };
  }

  const best = Math.max(...rawScores);
  const worst = Math.min(...rawScores);
  const spread = best - worst;

  if (spread < FLAT_SPREAD_THRESHOLD) {
    return { kind: 'unclear', reason: 'flat-spread' };
  }

  if (typeof playedRawScore !== 'number') {
    // The played action's own candidate carries a rawScore whenever the
    // solver produced any real candidates at all (confirmed: B4 always
    // includes the played action among its candidates) -- a miss here
    // means the upstream result is malformed, not a legitimate runtime
    // case to paper over with a guess.
    throw new Error('classifyHeuristicResult: no rawScore found for the played action.');
  }

  const primary = options?.primaryReferenceAction;
  if (primary) {
    if (JSON.stringify(evaluation.played.action) === JSON.stringify(primary)) {
      return { kind: 'bucket', bucket: 'Good' };
    }
    const primaryCandidate = findCandidateByAction(evaluation.candidates, primary);
    const primaryRawScore = primaryCandidate?.rawScore;
    if (typeof primaryRawScore === 'number') {
      if (playedRawScore >= primaryRawScore) return { kind: 'bucket', bucket: 'Good' };
      const normalizedLoss = (primaryRawScore - playedRawScore) / spread;
      if (normalizedLoss <= GOOD_THRESHOLD) return { kind: 'bucket', bucket: 'Good' };
      if (normalizedLoss <= INACCURACY_THRESHOLD) return { kind: 'bucket', bucket: 'Inaccuracy' };
      return { kind: 'bucket', bucket: 'Blunder' };
    }
    // Primary known but not among heuristic candidates: cannot honestly
    // claim Blunder via oracle-max ranking. Treat as a miss without overclaiming.
    return { kind: 'bucket', bucket: 'Inaccuracy' };
  }

  const normalizedLoss = (best - playedRawScore) / spread;
  if (normalizedLoss <= GOOD_THRESHOLD) return { kind: 'bucket', bucket: 'Good' };
  if (normalizedLoss <= INACCURACY_THRESHOLD) return { kind: 'bucket', bucket: 'Inaccuracy' };
  return { kind: 'bucket', bucket: 'Blunder' };
}
