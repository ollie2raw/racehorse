import { useMemo } from 'react';
import type { ReviewBatchState } from '../modules/review/useReviewWorkerBatch';

/**
 * Phase C (game-review-oracle-upgrade-2026-09-13.md), search-badge increment:
 * detects whether a rendered move's resolved oracle result is search-sourced,
 * so GameReviewer can add an informational badge alongside its unchanged
 * legacy 6-bucket label/class.
 *
 * Deliberately NOT merged into selectMoveHeuristicClassification's
 * discriminated union: that selector's job is producing a real
 * bucket/unclear/forced classification because heuristic scores are
 * zeroed/uncalibrated and need coarsening. Search candidates carry real,
 * calibrated scores -- classifyMove's existing 6-bucket rating already
 * applies to them correctly, so there is nothing to classify here, only a
 * confidence-tier fact to detect. Keeping it a separate, simpler function
 * means GameReviewer's render logic can query "is this a heuristic result"
 * and "is this a search result" independently, without a shared type that
 * would otherwise need a payload-less variant for this tier alongside the
 * heuristic tier's real bucket/reason payloads.
 *
 * Returns 'search' for any confidence level (high/medium/low) under
 * evidence.source === 'search' -- confidence granularity within the search
 * tier is not surfaced by this badge, only which tier produced the result.
 */
export function selectMoveSearchTier(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
): 'search' | null {
  if (!decisionId) return null;
  const evaluation = reviewWorkerBatch.resultsByDecisionId.get(decisionId);
  if (!evaluation || evaluation.evidence.source !== 'search') return null;
  return 'search';
}

/** Thin memoized hook wrapper around the pure selector above. */
export function useMoveSearchTier(
  decisionId: string | null | undefined,
  reviewWorkerBatch: ReviewBatchState,
): 'search' | null {
  return useMemo(
    () => selectMoveSearchTier(decisionId, reviewWorkerBatch),
    [decisionId, reviewWorkerBatch],
  );
}
