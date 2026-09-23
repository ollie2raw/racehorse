import { useMemo } from 'react';
import type { ReviewAction } from '@racehorse/game-core/review';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';
import { classifyHeuristicResult, type HeuristicClassification } from './classifyHeuristicResult';
import { lossBandLabelForEvaluation } from './gameAccuracyModel';

export type SelectMoveClassificationOptions = {
  /** D2 primary reference for heuristic tier (Fritz action when available). */
  readonly primaryReferenceAction?: ReviewAction | null;
};

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
 * 3-bucket scale. When primaryReferenceAction is supplied (D2), that
 * classification is Fritz-relative. Exact/search-sourced results (D5)
 * go through lossBandLabelForEvaluation.
 */
export function selectMoveHeuristicClassification(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
  options?: SelectMoveClassificationOptions,
): HeuristicClassification | null {
  if (!decisionId) return null;
  const evaluation = reviewWorkerBatch.resultsByDecisionId.get(decisionId);
  if (!evaluation) return null;
  if (evaluation.evidence.source === 'heuristic') {
    return classifyHeuristicResult(
      evaluation,
      options?.primaryReferenceAction
        ? { primaryReferenceAction: options.primaryReferenceAction }
        : undefined,
    );
  }
  const label = lossBandLabelForEvaluation(evaluation);
  return label ? { kind: 'calibrated', label } : null;
}

/** Thin memoized hook wrapper around the pure selector above. */
export function useMoveHeuristicClassification(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
  options?: SelectMoveClassificationOptions,
): HeuristicClassification | null {
  return useMemo(
    () => selectMoveHeuristicClassification(decisionId, reviewWorkerBatch, options),
    [decisionId, reviewWorkerBatch, options],
  );
}
