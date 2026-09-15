import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';

/**
 * Message contract between the review worker host and reviewWorker.ts
 * (B5, game-review-oracle-upgrade-2026-09-13.md). One request runs one
 * batch (a full hand or game's worth of decisions) -- worker spin-up cost
 * makes per-decision workers wasteful, and the host needs the whole
 * batch's results anyway.
 */
export type ReviewBatchRunRequest = {
  readonly type: 'run';
  readonly snapshots: readonly ReviewPositionSnapshotV2[];
  readonly budget: ReviewDispatchBudget;
  readonly coverageThreshold: number;
};

/**
 * Checked between snapshots, not via worker.terminate() -- see
 * runReviewBatch.ts for why. A cancel sent mid-flight on one snapshot
 * doesn't interrupt that snapshot (evaluateReviewPosition is synchronous);
 * it takes effect before the next one starts.
 */
export type ReviewBatchCancelRequest = { readonly type: 'cancel' };

export type ReviewWorkerRequest = ReviewBatchRunRequest | ReviewBatchCancelRequest;

export type ReviewBatchResultMessage = {
  readonly type: 'result';
  readonly decisionId: string;
  readonly evaluation: ReviewEvaluationV1;
};

/**
 * Per-decision failure isolation: the dispatch path (findPlayedCandidate,
 * and anything else in evaluateReviewPosition's call chain) can throw by
 * design (B-integration's "fail loud" convention). One bad decision must
 * never kill the rest of the batch's results -- its slot gets an error
 * message instead of a fabricated ReviewEvaluationV1 (that type is locked
 * in packages/game-core; no synthetic value belongs in it), and the batch
 * continues.
 */
export type ReviewBatchErrorMessage = {
  readonly type: 'error';
  readonly decisionId: string;
  readonly message: string;
};

export type ReviewBatchDoneMessage = { readonly type: 'done' };

export type ReviewWorkerResponse = ReviewBatchResultMessage | ReviewBatchErrorMessage | ReviewBatchDoneMessage;
