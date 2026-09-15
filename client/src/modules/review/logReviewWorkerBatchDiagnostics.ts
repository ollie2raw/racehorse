import { logger } from '../../utils/logger';
import type { MoveEntry } from '../../game/moveLogger';
import type { ReviewBatchState } from './useReviewWorkerBatch';

/**
 * B5 UI wiring (game-review-oracle-upgrade-2026-09-13.md): dev-only
 * diagnostic surface for the review worker batch -- not user-facing UI.
 * Reuses `logger.info`, which already gates on `import.meta.env.DEV`
 * internally (client/src/utils/logger.ts), rather than introducing a new
 * dev-flag convention or raw `console.*` calls.
 *
 * Deliberately does not attempt to translate `evidence.confidence` or
 * `loss.expectedPointDifferential` into anything resembling a user-facing
 * rating or coaching word -- that mapping is Phase C's decision, made
 * deliberately later, not inferred here.
 */
export function logReviewWorkerBatchDiagnostics(
  state: ReviewBatchState,
  correlation: ReadonlyMap<string, MoveEntry>,
): void {
  const results = Array.from(state.resultsByDecisionId.entries()).map(([decisionId, evaluation]) => ({
    decisionId,
    moveNumber: correlation.get(decisionId)?.moveNumber ?? null,
    player: correlation.get(decisionId)?.player ?? null,
    candidates: evaluation.candidates.length,
    evidenceSource: evaluation.evidence.source,
    confidence: evaluation.evidence.confidence,
    coverage: evaluation.search.coverage,
    complete: evaluation.search.complete,
  }));
  const errors = Array.from(state.errorsByDecisionId.entries()).map(([decisionId, message]) => ({
    decisionId,
    moveNumber: correlation.get(decisionId)?.moveNumber ?? null,
    message,
  }));

  logger.info('reviewWorkerBatch', 'batch complete', {
    resultCount: results.length,
    errorCount: errors.length,
    results,
    errors,
  });
}
