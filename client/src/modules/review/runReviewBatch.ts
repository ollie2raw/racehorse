import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { evaluateReviewPosition, type ReviewDispatchBudget } from '@racehorse/review-engine';

export type RunReviewBatchCallbacks = {
  readonly onResult: (decisionId: string, evaluation: ReviewEvaluationV1) => void;
  readonly onError: (decisionId: string, message: string) => void;
  readonly onDone: () => void;
  readonly isCancelled: () => boolean;
};

/**
 * B5 (game-review-oracle-upgrade-2026-09-13.md): the pure, worker-API-free
 * batch runner. reviewWorker.ts (the actual self.onmessage entry point,
 * untestable in vitest) is a thin adapter around this: it parses the
 * postMessage request, calls this, and posts a message from each callback.
 * Keeping all real logic here, with worker plumbing reduced to a 1:1
 * callback-to-postMessage mapping, is what makes the error-isolation and
 * cancellation paths fully unit-testable with plain fakes.
 *
 * Per-decision failure isolation: evaluateReviewPosition's dispatch path
 * (findPlayedCandidate, and anything else in its call chain) can throw by
 * design -- a deliberate "fail loud" convention from B-integration. Each
 * snapshot's call is wrapped in its own try/catch so one bad decision can
 * never take down the rest of the batch's results; its slot reports
 * onError instead of a fabricated ReviewEvaluationV1 (that type is locked
 * in packages/game-core -- no synthetic value belongs in it).
 *
 * Cancellation is checked once per snapshot, between dispatch calls, via
 * `isCancelled()` rather than by having the host call `worker.terminate()`
 * from outside. Two reasons: evaluateReviewPosition is synchronous, so
 * there is no meaningful finer-grained check point anyway -- a snapshot
 * already in flight when cancellation is requested always finishes and
 * reports its result (or error) before the next check stops the batch, and
 * every result already posted for earlier snapshots remains valid and
 * usable by the host regardless of when cancellation lands. `terminate()`
 * would instead discard the in-flight snapshot's result outright and give
 * the host nothing to distinguish "cancelled" from "crashed". This is also
 * the only mechanism testable without real worker APIs, per the
 * testability split above.
 *
 * `onDone` fires exactly once, always, whether the loop ran to completion
 * or stopped early via cancellation -- so a host waiting on "done" to know
 * the batch has stopped never hangs either way.
 */
export function runReviewBatch(
  snapshots: readonly ReviewPositionSnapshotV2[],
  budget: ReviewDispatchBudget,
  coverageThreshold: number,
  callbacks: RunReviewBatchCallbacks,
): void {
  for (const snapshot of snapshots) {
    if (callbacks.isCancelled()) break;
    try {
      const evaluation = evaluateReviewPosition(snapshot, budget, coverageThreshold);
      callbacks.onResult(snapshot.identifiers.decisionId, evaluation);
    } catch (error) {
      callbacks.onError(snapshot.identifiers.decisionId, error instanceof Error ? error.message : String(error));
    }
  }
  callbacks.onDone();
}
