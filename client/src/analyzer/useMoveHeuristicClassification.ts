import { useMemo } from 'react';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { classifyHeuristicResult, type HeuristicClassification } from './classifyHeuristicResult';

/**
 * Progressive-enhancement lookup for a single rendered move (game-review-
 * oracle-upgrade-2026-09-13.md, Phase C render wiring): given the move's
 * decisionId (resolved upstream via buildDecisionIdByMoveNumber -- cheap,
 * a plain map lookup, not recomputed here) and the shared batch state,
 * returns a real classification once that specific decision has resolved,
 * or null otherwise.
 *
 * null covers three cases deliberately treated the same way by design, not
 * merged accidentally: no decisionId for this move, a decisionId that
 * hasn't resolved yet (still pending in the worker batch), and a resolved
 * result whose evidence isn't heuristic-sourced (exact/search results keep
 * their own, unrelated 6-bucket rendering). In every case the caller's
 * correct behavior is identical: render the legacy rating unchanged --
 * there is no per-move loading state, since "not yet resolved" is already
 * a valid, already-handled render (the legacy rating).
 */
export function selectMoveHeuristicClassification(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
): HeuristicClassification | null {
  if (!decisionId) return null;
  const evaluation = reviewWorkerBatch.resultsByDecisionId.get(decisionId);
  if (!evaluation || evaluation.evidence.source !== 'heuristic') return null;
  return classifyHeuristicResult(evaluation);
}

/** Thin memoized hook wrapper around the pure selector above. */
export function useMoveHeuristicClassification(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
): HeuristicClassification | null {
  return useMemo(
    () => selectMoveHeuristicClassification(decisionId, reviewWorkerBatch),
    [decisionId, reviewWorkerBatch],
  );
}
