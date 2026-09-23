import {
  dedupeCandidatesByTile,
  isForcedDecision,
} from '@racehorse/game-core/review';
import type { ReviewAction, ReviewCandidateEvaluationV1, ReviewEvaluationV1 } from '@racehorse/game-core/review';

export { dedupeCandidatesByTile, isForcedDecision };

/**
 * Player-facing classification for a resolved review decision.
 *
 * - `forced`: exactly one legal ReviewAction (placement-distinct).
 * - `estimate`: heuristic-tier non-forced — no calibrated severity.
 * - `unclear`: cannot honestly compare (globally-infeasible, or Fritz
 *   primary absent from candidates, or flat-spread research path).
 * - `calibrated`: exact/search loss-band label.
 * - `bucket`: DEV/RESEARCH ONLY — provisional n=3 severity; not used for
 *   production player-facing heuristic classification after 2026-09-22.
 */
export type HeuristicClassification =
  | { readonly kind: 'forced' }
  | { readonly kind: 'estimate'; readonly matchedPrimary: boolean }
  | { readonly kind: 'unclear'; readonly reason: 'globally-infeasible' | 'flat-spread' | 'primary-absent' }
  | { readonly kind: 'bucket'; readonly bucket: 'Good' | 'Inaccuracy' | 'Blunder' }
  | { readonly kind: 'calibrated'; readonly label: 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder' };

// Provisional, from a real but tiny (n=3) dataset -- see issue #231.
// Kept only for researchClassifierHeuristicSeverity below — NOT production.
const FLAT_SPREAD_THRESHOLD = 5;
const GOOD_THRESHOLD = 0.25;
const INACCURACY_THRESHOLD = 0.6;

function findCandidateByAction(
  candidates: readonly ReviewCandidateEvaluationV1[],
  action: ReviewAction,
): ReviewCandidateEvaluationV1 | undefined {
  const key = JSON.stringify(action);
  return candidates.find((c) => JSON.stringify(c.action) === key);
}

export type ClassifyHeuristicOptions = {
  /** D2 Fritz (or other) primary reference action when resolved. */
  readonly primaryReferenceAction?: ReviewAction;
};

/**
 * Production heuristic classification: never emits calibrated severity
 * (Good / Inaccuracy / Blunder). Returns Forced, Estimate, or Unclear.
 */
export function classifyHeuristicResult(
  evaluation: ReviewEvaluationV1,
  options?: ClassifyHeuristicOptions,
): HeuristicClassification {
  if (evaluation.heuristicFallbackReason === 'globally-infeasible') {
    return { kind: 'unclear', reason: 'globally-infeasible' };
  }

  if (isForcedDecision(evaluation.candidates)) {
    return { kind: 'forced' };
  }

  const primary = options?.primaryReferenceAction;
  if (primary) {
    const primaryCandidate = findCandidateByAction(evaluation.candidates, primary);
    if (!primaryCandidate) {
      // Fritz (or other primary) not among heuristic candidates — cannot
      // invent Inaccuracy / Blunder from an unscored comparison.
      return { kind: 'unclear', reason: 'primary-absent' };
    }
    const matchedPrimary = JSON.stringify(evaluation.played.action) === JSON.stringify(primary);
    return { kind: 'estimate', matchedPrimary };
  }

  // No Fritz primary available: still Estimate, never provisional severity.
  return { kind: 'estimate', matchedPrimary: false };
}

/**
 * DEV/RESEARCH ONLY: provisional n=3 severity buckets. Do not wire into
 * GameReviewer production presentation.
 */
export function researchClassifierHeuristicSeverity(
  evaluation: ReviewEvaluationV1,
  options?: ClassifyHeuristicOptions,
): HeuristicClassification {
  if (evaluation.heuristicFallbackReason === 'globally-infeasible') {
    return { kind: 'unclear', reason: 'globally-infeasible' };
  }

  const playedCandidate = findCandidateByAction(evaluation.candidates, evaluation.played.action);
  const playedRawScore = playedCandidate?.rawScore;

  if (isForcedDecision(evaluation.candidates)) {
    return { kind: 'forced' };
  }

  const deduped = dedupeCandidatesByTile(evaluation.candidates);
  const rawScores = deduped
    .map((c) => c.rawScore)
    .filter((score): score is number => typeof score === 'number');

  if (rawScores.length < 2) {
    // Single tile with multiple placements still has action-level choice;
    // spread across tiles is flat / single — treat as unclear for research.
    return { kind: 'unclear', reason: 'flat-spread' };
  }

  const best = Math.max(...rawScores);
  const worst = Math.min(...rawScores);
  const spread = best - worst;

  if (spread < FLAT_SPREAD_THRESHOLD) {
    return { kind: 'unclear', reason: 'flat-spread' };
  }

  if (typeof playedRawScore !== 'number') {
    throw new Error('researchClassifierHeuristicSeverity: no rawScore for played action.');
  }

  const primary = options?.primaryReferenceAction;
  if (primary) {
    if (JSON.stringify(evaluation.played.action) === JSON.stringify(primary)) {
      return { kind: 'bucket', bucket: 'Good' };
    }
    const primaryCandidate = findCandidateByAction(evaluation.candidates, primary);
    const primaryRawScore = primaryCandidate?.rawScore;
    if (typeof primaryRawScore !== 'number') {
      return { kind: 'unclear', reason: 'primary-absent' };
    }
    if (playedRawScore >= primaryRawScore) return { kind: 'bucket', bucket: 'Good' };
    const normalizedLoss = (primaryRawScore - playedRawScore) / spread;
    if (normalizedLoss <= GOOD_THRESHOLD) return { kind: 'bucket', bucket: 'Good' };
    if (normalizedLoss <= INACCURACY_THRESHOLD) return { kind: 'bucket', bucket: 'Inaccuracy' };
    return { kind: 'bucket', bucket: 'Blunder' };
  }

  const normalizedLoss = (best - playedRawScore) / spread;
  if (normalizedLoss <= GOOD_THRESHOLD) return { kind: 'bucket', bucket: 'Good' };
  if (normalizedLoss <= INACCURACY_THRESHOLD) return { kind: 'bucket', bucket: 'Inaccuracy' };
  return { kind: 'bucket', bucket: 'Blunder' };
}
