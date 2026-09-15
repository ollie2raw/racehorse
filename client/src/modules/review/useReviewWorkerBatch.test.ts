// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';
import { useReviewWorkerBatch, type ReviewWorkerLike } from './useReviewWorkerBatch';
import type { ReviewWorkerRequest, ReviewWorkerResponse } from './reviewWorkerTypes';

function makeSnapshot(decisionId: string): ReviewPositionSnapshotV2 {
  return {
    snapshotVersion: 2,
    rulesVersion: 1,
    commandVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    stateDigestVersion: 1,
    identifiers: {
      sessionId: 'session-1',
      gameId: 'game-1',
      handId: 'hand-1',
      decisionId,
      mode: 'play-vs-fritz',
      gameNumber: 1,
      handNumber: 1,
      actionNumber: 1,
      turnSequence: 0,
      actorId: 'you',
      opponentId: 'bot',
    },
    preAction: {
      board: null,
      actorHand: [],
      opponentTileCount: 7,
      boneyard: { physicalCount: 14, drawableCount: 14, deadCount: 0 },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 60,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: [],
    },
    legalActions: [],
    actualAction: { kind: 'pass' },
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  } as ReviewPositionSnapshotV2;
}

function fakeEvaluation(): ReviewEvaluationV1 {
  const candidate = {
    action: { kind: 'pass' as const },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  return {
    evaluationVersion: 1,
    snapshotId: 'x',
    rulesVersion: 1,
    reviewEngineVersion: 'review-engine-v1',
    evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    played: candidate,
    best: candidate,
    candidates: [candidate],
    loss: { expectedPointDifferential: 0, winProbability: null },
    search: { nodes: 1, depth: 0, hiddenStateSamples: 0, coverage: 0, complete: true },
    diagnostics: [],
  } as ReviewEvaluationV1;
}

/** A controllable fake ReviewWorkerLike -- lets tests drive onmessage manually and spy on postMessage/terminate. */
function makeFakeWorker() {
  const postMessage = vi.fn();
  const terminate = vi.fn();
  const worker: ReviewWorkerLike = { postMessage, terminate, onmessage: null };
  return { worker, postMessage, terminate };
}

const BUDGET: ReviewDispatchBudget = { maxNodes: 1000, maxHiddenStateSamples: 10, maxPlyDepth: 2, seed: 'test' };
const COVERAGE_THRESHOLD = 0.02;

describe('useReviewWorkerBatch', () => {
  it('transitions from pending through partial results to done, without losing an errored decision', () => {
    const { worker } = makeFakeWorker();
    const snapshots = [makeSnapshot('d1'), makeSnapshot('d2'), makeSnapshot('d3')];

    const { result } = renderHook(() => useReviewWorkerBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, () => worker));

    expect(result.current.pendingDecisionIds).toEqual(new Set(['d1', 'd2', 'd3']));
    expect(result.current.done).toBe(false);

    act(() => {
      const resultMsg: ReviewWorkerResponse = { type: 'result', decisionId: 'd1', evaluation: fakeEvaluation() };
      worker.onmessage!({ data: resultMsg } as MessageEvent<ReviewWorkerResponse>);
    });
    expect(result.current.resultsByDecisionId.has('d1')).toBe(true);
    expect(result.current.pendingDecisionIds).toEqual(new Set(['d2', 'd3']));
    expect(result.current.done).toBe(false);

    act(() => {
      const errorMsg: ReviewWorkerResponse = { type: 'error', decisionId: 'd2', message: 'boom' };
      worker.onmessage!({ data: errorMsg } as MessageEvent<ReviewWorkerResponse>);
    });
    expect(result.current.errorsByDecisionId.get('d2')).toBe('boom');
    expect(result.current.resultsByDecisionId.has('d1')).toBe(true); // still present, not lost
    expect(result.current.pendingDecisionIds).toEqual(new Set(['d3']));

    act(() => {
      const resultMsg: ReviewWorkerResponse = { type: 'result', decisionId: 'd3', evaluation: fakeEvaluation() };
      worker.onmessage!({ data: resultMsg } as MessageEvent<ReviewWorkerResponse>);
    });
    act(() => {
      const doneMsg: ReviewWorkerResponse = { type: 'done' };
      worker.onmessage!({ data: doneMsg } as MessageEvent<ReviewWorkerResponse>);
    });

    expect(result.current.done).toBe(true);
    expect(result.current.pendingDecisionIds.size).toBe(0);
    expect(result.current.resultsByDecisionId.size).toBe(2);
    expect(result.current.errorsByDecisionId.size).toBe(1);
  });

  it('posts the run request with the exact snapshots/budget/coverageThreshold it was given', () => {
    const { worker, postMessage } = makeFakeWorker();
    const snapshots = [makeSnapshot('d1')];

    renderHook(() => useReviewWorkerBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, () => worker));

    const runRequest: ReviewWorkerRequest = {
      type: 'run',
      snapshots,
      budget: BUDGET,
      coverageThreshold: COVERAGE_THRESHOLD,
    };
    expect(postMessage).toHaveBeenCalledWith(runRequest);
  });

  it('cancels and terminates the worker on unmount', () => {
    const { worker, postMessage, terminate } = makeFakeWorker();
    const snapshots = [makeSnapshot('d1')];

    const { unmount } = renderHook(() => useReviewWorkerBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, () => worker));
    postMessage.mockClear(); // drop the initial 'run' call so we only see the unmount's cancel

    unmount();

    const cancelMessage: ReviewWorkerRequest = { type: 'cancel' };
    expect(postMessage).toHaveBeenCalledWith(cancelMessage);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
