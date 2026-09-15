import { useEffect, useRef, useState } from 'react';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from '../../analyzer/reviewWorkerTypes';

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
  return new Worker(new URL('../../analyzer/reviewWorker.ts', import.meta.url), { type: 'module' });
}

/**
 * B5 UI wiring (game-review-oracle-upgrade-2026-09-13.md): the streaming-
 * capable hook around the B5 worker. Built as real, incremental state
 * (resultsByDecisionId / errorsByDecisionId / pendingDecisionIds fill in as
 * messages arrive, not one final blob) even though nothing consumes it
 * incrementally yet -- retrofitting this shape later would be more
 * expensive than building it right the first time.
 *
 * `createWorker` is injectable (defaults to the real `new Worker(...)`)
 * specifically so this hook is testable without real Worker/jsdom support --
 * same testability-split principle B5's own runReviewBatch/reviewWorker
 * split already established. Read via a ref updated every render rather
 * than as an effect dependency: a factory function is semantically stable
 * regardless of its reference identity (it's "how do I construct a
 * worker", not batch input), and putting it in the dependency array would
 * make the effect re-run -- spawning a new worker and re-running the whole
 * batch -- every time a caller passes a non-memoized inline function,
 * which is the common case for a default parameter's replacement value.
 * (Confirmed the hard way: an inline `() => worker` in this file's own
 * first test draft created a new reference every render, re-triggering the
 * effect on every internal setState and crashing the test worker with an
 * infinite render loop before this fix.)
 *
 * Cancellation on unmount sends the message-based { type: 'cancel' } B5
 * already built (so any snapshot in flight still finishes and its result
 * stays valid -- see runReviewBatch.ts's own reasoning), then terminates
 * the worker to reclaim the OS thread, since no listener will remain
 * attached to receive anything further either way.
 */
export function useReviewWorkerBatch(
  snapshots: readonly ReviewPositionSnapshotV2[],
  budget: ReviewDispatchBudget,
  coverageThreshold: number,
  createWorker: () => ReviewWorkerLike = defaultCreateWorker,
): ReviewBatchState & { cancel: () => void } {
  const [state, setState] = useState<ReviewBatchState>(EMPTY_STATE);
  const workerRef = useRef<ReviewWorkerLike | null>(null);
  const createWorkerRef = useRef(createWorker);
  // Kept fresh in its own effect (runs after every render, no dependency
  // array) rather than written directly during render -- React flags
  // writing to a ref mid-render even for this "latest value" pattern.
  useEffect(() => {
    createWorkerRef.current = createWorker;
  });

  useEffect(() => {
    if (snapshots.length === 0) {
      setState(EMPTY_STATE);
      return;
    }

    const worker = createWorkerRef.current();
    workerRef.current = worker;

    setState({
      resultsByDecisionId: new Map(),
      errorsByDecisionId: new Map(),
      pendingDecisionIds: new Set(snapshots.map((s) => s.identifiers.decisionId)),
      done: false,
    });

    worker.onmessage = (event) => {
      const message = event.data;
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
        return { ...prev, done: true };
      });
    };

    const request: ReviewWorkerRequest = { type: 'run', snapshots, budget, coverageThreshold };
    worker.postMessage(request);

    return () => {
      const cancelMessage: ReviewWorkerRequest = { type: 'cancel' };
      worker.postMessage(cancelMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, [snapshots, budget, coverageThreshold]);

  const cancel = () => {
    const cancelMessage: ReviewWorkerRequest = { type: 'cancel' };
    workerRef.current?.postMessage(cancelMessage);
  };

  return { ...state, cancel };
}
