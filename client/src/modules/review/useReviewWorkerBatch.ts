import { useEffect, useRef, useState } from 'react';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './reviewWorkerTypes';
import { partitionIndices } from './runReviewBatchPool';
import { createBrowserReviewWorker } from './reviewWorkerPool.browser';

export type ReviewBatchState = {
  readonly resultsByDecisionId: ReadonlyMap<string, ReviewEvaluationV1>;
  readonly errorsByDecisionId: ReadonlyMap<string, string>;
  readonly pendingDecisionIds: ReadonlySet<string>;
  readonly done: boolean;
};

const EMPTY_STATE: ReviewBatchState = {
  resultsByDecisionId: new Map(),
  errorsByDecisionId: new Map(),
  pendingDecisionIds: new Set(),
  done: false,
};

/** The minimal Worker surface this hook needs -- lets tests inject a fake without real Worker/jsdom support. */
export type ReviewWorkerLike = {
  postMessage: (message: ReviewWorkerRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<ReviewWorkerResponse>) => void) | null;
};

function defaultCreateWorker(): ReviewWorkerLike {
  return createBrowserReviewWorker() as unknown as ReviewWorkerLike;
}

/**
 * B5 (game-review-oracle-upgrade-2026-09-13.md) UI wiring, extended by
 * F4a (perf/review-batch-worker-pool) to spread a batch's decisions across
 * a pool of `poolSize` workers instead of one.
 *
 * DETERMINISM: each worker runs unmodified `runReviewBatch` over a
 * deterministic `partitionIndices` slice. Hook state is keyed by decisionId,
 * so arrival order never affects the final Maps. Default `poolSize` stays 1
 * so existing single-worker tests keep their exact request/response shape;
 * production opts into a larger pool via `defaultReviewWorkerPoolSize()`.
 *
 * `done` flips only after every pool worker reports its own `done`. The
 * completion counter is incremented outside React's setState updater so
 * Strict Mode double-invokes cannot over-count.
 */
export function useReviewWorkerBatch(
  snapshots: readonly ReviewPositionSnapshotV2[],
  budget: ReviewDispatchBudget,
  coverageThreshold: number,
  createWorker: () => ReviewWorkerLike = defaultCreateWorker,
  poolSize: number = 1,
): ReviewBatchState & { cancel: () => void } {
  const [state, setState] = useState<ReviewBatchState>(EMPTY_STATE);
  const workersRef = useRef<ReviewWorkerLike[]>([]);
  const createWorkerRef = useRef(createWorker);
  const poolSizeRef = useRef(poolSize);
  useEffect(() => {
    createWorkerRef.current = createWorker;
    poolSizeRef.current = poolSize;
  });

  const [lastInputs, setLastInputs] = useState<{
    snapshots: readonly ReviewPositionSnapshotV2[];
    budget: ReviewDispatchBudget;
    coverageThreshold: number;
  } | null>(null);
  if (
    lastInputs === null ||
    lastInputs.snapshots !== snapshots ||
    lastInputs.budget !== budget ||
    lastInputs.coverageThreshold !== coverageThreshold
  ) {
    setLastInputs({ snapshots, budget, coverageThreshold });
    setState(
      snapshots.length === 0
        ? EMPTY_STATE
        : {
            resultsByDecisionId: new Map(),
            errorsByDecisionId: new Map(),
            pendingDecisionIds: new Set(snapshots.map((s) => s.identifiers.decisionId)),
            done: false,
          },
    );
  }

  useEffect(() => {
    if (snapshots.length === 0) return;

    const partitions = partitionIndices(snapshots.length, poolSizeRef.current);
    const workers = partitions.map(() => createWorkerRef.current());
    workersRef.current = workers;
    let doneWorkerCount = 0;

    workers.forEach((worker, workerIndex) => {
      const partitionSnapshots = partitions[workerIndex].map((index) => snapshots[index]);

      worker.onmessage = (event) => {
        const message = event.data;
        if (message.type === 'done') {
          doneWorkerCount += 1;
          const allDone = doneWorkerCount >= workers.length;
          if (allDone) {
            setState((prev) => ({ ...prev, done: true }));
          }
          return;
        }
        setState((prev) => {
          if (message.type === 'result') {
            const resultsByDecisionId = new Map(prev.resultsByDecisionId);
            resultsByDecisionId.set(message.decisionId, message.evaluation);
            const pendingDecisionIds = new Set(prev.pendingDecisionIds);
            pendingDecisionIds.delete(message.decisionId);
            return { ...prev, resultsByDecisionId, pendingDecisionIds };
          }
          if (message.type === 'error') {
            const errorsByDecisionId = new Map(prev.errorsByDecisionId);
            errorsByDecisionId.set(message.decisionId, message.message);
            const pendingDecisionIds = new Set(prev.pendingDecisionIds);
            pendingDecisionIds.delete(message.decisionId);
            return { ...prev, errorsByDecisionId, pendingDecisionIds };
          }
          return prev;
        });
      };

      const request: ReviewWorkerRequest = {
        type: 'run',
        snapshots: partitionSnapshots,
        budget,
        coverageThreshold,
      };
      worker.postMessage(request);
    });

    return () => {
      const cancelMessage: ReviewWorkerRequest = { type: 'cancel' };
      for (const worker of workers) {
        worker.postMessage(cancelMessage);
        worker.terminate();
      }
      workersRef.current = [];
    };
  }, [snapshots, budget, coverageThreshold]);

  const cancel = () => {
    const cancelMessage: ReviewWorkerRequest = { type: 'cancel' };
    for (const worker of workersRef.current) {
      worker.postMessage(cancelMessage);
    }
  };

  return { ...state, cancel };
}
