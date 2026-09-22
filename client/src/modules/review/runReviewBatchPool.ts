import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './reviewWorkerTypes';

/**
 * perf/review-batch-worker-pool: parallelizes runReviewBatch's per-decision
 * loop across a pool of workers, reusing the B5 worker-host message
 * contract (game-review-oracle-upgrade-2026-09-13.md) rather than inventing
 * a second transport. Each pool worker runs the exact same runReviewBatch
 * entry point B5 already built (via reviewWorker.ts in the browser, or its
 * Node counterpart -- see reviewWorkerPool.browser.ts / reviewWorkerPool.node.ts)
 * over its own slice of the snapshots; this file only contains the
 * environment-agnostic partition/dispatch/merge logic shared by both hosts.
 *
 * DETERMINISM: evaluateReviewPosition is a pure function of
 * (snapshot, budget, coverageThreshold) -- solveMidgameDeterminization's own
 * seeding derives every sub-seed from `budget.seed` plus the snapshot alone
 * (see its doc comment: "sub-seeds are a pure function of the seed and
 * index, not just empirically"), so there is no shared mutable state and no
 * cross-decision ordering dependency for a worker pool to violate. The
 * requirement this file must still uphold itself: the FINAL aggregated
 * result must not depend on which worker finishes which decision when.
 * That is enforced structurally, not by luck -- toOrderedEvaluations below
 * always reassembles the output by iterating the original `snapshots` input
 * order and looking up each decisionId in the merged map, never by
 * emission/arrival order from the workers.
 */

/** The minimal worker surface a pool host needs -- same shape useReviewWorkerBatch.ts already defined for its single-worker case, plus an optional onerror so a genuine worker crash (not a per-decision evaluateReviewPosition error, which is already isolated via the 'error' message type) rejects rather than hanging the pool forever. */
export type ReviewWorkerLike = {
  postMessage: (message: ReviewWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: { data: ReviewWorkerResponse }) => void) | null;
  onerror?: ((error: unknown) => void) | null;
};

export type ReviewBatchPoolResult = {
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly errorsByDecisionId: ReadonlyMap<string, string>;
};

/**
 * Deterministic partition of `snapshots` into up to `poolSize` slices.
 * Round-robin by original index (not contiguous blocks): per-decision
 * search cost varies hugely by game phase (a locked-yard exact endgame is
 * far cheaper than a wide-open midgame determinization), and a real game's
 * decisions are naturally clustered by phase in original order (opening,
 * then midgame, then endgame) -- contiguous blocks would hand one worker
 * an almost-all-cheap slice and another an almost-all-expensive slice.
 * Round-robin striping spreads every phase across every worker instead.
 * Pure function of (length, poolSize) -- the same partition for the same
 * inputs regardless of worker count's effect on timing.
 */
export function partitionIndices(length: number, poolSize: number): number[][] {
  const effectivePoolSize = Math.max(1, Math.min(poolSize, length || 1));
  const partitions: number[][] = Array.from({ length: effectivePoolSize }, () => []);
  for (let index = 0; index < length; index += 1) {
    partitions[index % effectivePoolSize].push(index);
  }
  return partitions;
}

export type RunReviewBatchPoolOptions = {
  readonly poolSize: number;
  readonly createWorker: () => ReviewWorkerLike;
  /** Streaming callback, fired as results/errors arrive from any worker -- arrival order is NOT the aggregation order (see module doc). Optional: the measurement/devtools callers only need the final awaited result. */
  readonly onResult?: (decisionId: string, evaluation: ReviewEvaluationV1) => void;
  readonly onError?: (decisionId: string, message: string) => void;
};

/**
 * Runs `snapshots` through a pool of `poolSize` workers (browser Web
 * Workers or Node worker_threads, depending on which `createWorker` the
 * caller injects -- see reviewWorkerPool.browser.ts / .node.ts), each
 * running the unmodified runReviewBatch loop over its own partition, and
 * resolves once every worker has reported 'done'.
 *
 * `poolSize` is clamped to `snapshots.length` (no point spinning up more
 * workers than there is work) and to a minimum of 1. Every worker is
 * terminated once it reports done, whether the batch as a whole succeeded
 * or partially errored -- no leaked OS threads.
 */
export function runReviewBatchPool(
  snapshots: readonly ReviewPositionSnapshotV2[],
  budget: ReviewDispatchBudget,
  coverageThreshold: number,
  options: RunReviewBatchPoolOptions,
): Promise<ReviewBatchPoolResult> {
  if (snapshots.length === 0) {
    return Promise.resolve({ resultsByDecisionId: new Map(), errorsByDecisionId: new Map() });
  }

  const partitions = partitionIndices(snapshots.length, options.poolSize);
  const resultsByDecisionId = new Map<string, ReviewEvaluationV1>();
  const errorsByDecisionId = new Map<string, string>();

  const workerDonePromises = partitions.map((indices) => {
    const partitionSnapshots = indices.map((index) => snapshots[index]);
    const worker = options.createWorker();

    return new Promise<void>((resolve, reject) => {
      worker.onerror = (error) => {
        worker.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'result') {
          resultsByDecisionId.set(message.decisionId, message.evaluation);
          options.onResult?.(message.decisionId, message.evaluation);
        } else if (message.type === 'error') {
          errorsByDecisionId.set(message.decisionId, message.message);
          options.onError?.(message.decisionId, message.message);
        } else {
          worker.terminate();
          resolve();
        }
      };

      try {
        const request: ReviewWorkerRequest = {
          type: 'run',
          snapshots: partitionSnapshots,
          budget,
          coverageThreshold,
        };
        worker.postMessage(request);
      } catch (error) {
        worker.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });

  return Promise.all(workerDonePromises).then(() => ({ resultsByDecisionId, errorsByDecisionId }));
}

/**
 * Projects a pool result back into an array in the ORIGINAL snapshot order
 * -- the mechanism that actually delivers the determinism guarantee: this
 * never consults arrival order, only the fixed `snapshots` input order and
 * a decisionId lookup, so the same input always serializes to the same
 * JSON regardless of poolSize or completion timing. Throws if any snapshot
 * has neither a result nor a recorded error (a worker crashed without
 * reporting either), since that would otherwise silently produce a
 * shorter-than-expected array.
 */
export function toOrderedEvaluations(
  snapshots: readonly ReviewPositionSnapshotV2[],
  result: ReviewBatchPoolResult,
): (ReviewEvaluationV1 | { readonly decisionId: string; readonly error: string })[] {
  return snapshots.map((snapshot) => {
    const decisionId = snapshot.identifiers.decisionId;
    const evaluation = result.resultsByDecisionId.get(decisionId);
    if (evaluation) return evaluation;
    const error = result.errorsByDecisionId.get(decisionId);
    if (error !== undefined) return { decisionId, error };
    throw new Error(`runReviewBatchPool: decision ${decisionId} has neither a result nor an error -- a worker never reported it.`);
  });
}
