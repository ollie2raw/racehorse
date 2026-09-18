import { useMemo } from 'react';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { classifyHeuristicResult, type HeuristicClassification } from './classifyHeuristicResult';
import { lossBandLabelForEvaluation } from './gameAccuracyModel';

/**
 * Progressive-enhancement lookup for a single rendered move (game-review-
 * oracle-upgrade-2026-09-13.md, Phase C render wiring; extended by D5 for
 * exact/search evidence -- see the doc's Phase D table). Given the move's
 * decisionId (resolved upstream via buildDecisionIdByMoveNumber -- cheap,
 * a plain map lookup, not recomputed here) and the shared batch state,
 * returns a real classification once that specific decision has resolved,
 * or null otherwise.
 *
 * Heuristic-sourced results go through classifyHeuristicResult's coarse
 * 3-bucket scale, unchanged from Phase C. Exact/search-sourced results (D5)
 * go through lossBandLabelForEvaluation -- the same calibrated
 * per-decision label the game's own accuracyModel uses
 * (phase-c-accuracy-model-spec.md section 4a) -- instead of falling back to
 * the legacy move.rating (classifyMove) scorer.
 *
 * null covers three cases deliberately treated the same way by design, not
 * merged accidentally: no decisionId for this move, a decisionId that
 * hasn't resolved yet (still pending in the worker batch), and a resolved
 * result that lossBandLabelForEvaluation/classifyHeuristicResult can't
 * label at all -- a forced decision (single real candidate), for any
 * evidence source. In every case the caller's correct behavior is
 * identical: render the legacy rating unchanged -- there is no per-move
 * loading state, since "not yet resolved" is already a valid,
 * already-handled render (the legacy rating).
 */
export function selectMoveHeuristicClassification(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
): HeuristicClassification | null {
  if (!decisionId) return null;
  const evaluation = reviewWorkerBatch.resultsByDecisionId.get(decisionId);
  if (!evaluation) return null;
  if (evaluation.evidence.source === 'heuristic') return classifyHeuristicResult(evaluation);
  const label = lossBandLabelForEvaluation(evaluation);
  return label ? { kind: 'calibrated', label } : null;
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
