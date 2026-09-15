import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';

vi.mock('@racehorse/review-engine', () => ({
  evaluateReviewPosition: vi.fn(),
}));

// Imported after the mock so runReviewBatch picks up the mocked binding.
import { evaluateReviewPosition } from '@racehorse/review-engine';
import { runReviewBatch } from './runReviewBatch';

const mockedEvaluate = vi.mocked(evaluateReviewPosition);

afterEach(() => {
  mockedEvaluate.mockReset();
});

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
      actorHand: [{ low: 1, high: 2 }],
      opponentTileCount: 7,
      boneyard: { physicalCount: 14, drawableCount: 14, deadCount: 0 },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 60,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: [],
    },
    legalActions: [{ kind: 'play', tile: { low: 1, high: 2 }, position: 'left' }],
    actualAction: { kind: 'play', tile: { low: 1, high: 2 }, position: 'left' },
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  } as ReviewPositionSnapshotV2;
}

function fakeEvaluation(decisionId: string): ReviewEvaluationV1 {
  const candidate = {
    action: { kind: 'play' as const, tile: { low: 1, high: 2 }, position: 'left' as const },
    value: { expectedPointDifferential: 0, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  return {
    evaluationVersion: 1,
    snapshotId: decisionId,
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

const BUDGET: ReviewDispatchBudget = {
  maxNodes: 1000,
  maxHiddenStateSamples: 10,
  maxPlyDepth: 2,
  seed: 'test-seed',
};
const COVERAGE_THRESHOLD = 0.02;

describe('runReviewBatch', () => {
  it('produces one result callback per snapshot, in order, then calls onDone', () => {
    const ids = ['d1', 'd2', 'd3'];
    const snapshots = ids.map(makeSnapshot);
    mockedEvaluate.mockImplementation((snapshot) => fakeEvaluation(snapshot.identifiers.decisionId));

    const onResult = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    runReviewBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, { onResult, onError, onDone, isCancelled: () => false });

    expect(onError).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledTimes(3);
    expect(onResult.mock.calls.map((call) => call[0])).toEqual(ids);
    expect(onDone).toHaveBeenCalledTimes(1);
    // onDone must fire after every result, not interleaved.
    const lastResultOrder = onResult.mock.invocationCallOrder[2];
    const doneOrder = onDone.mock.invocationCallOrder[0];
    expect(doneOrder).toBeGreaterThan(lastResultOrder);
  });

  it('isolates a mid-batch failure: its slot gets an error, the batch continues, done still fires', () => {
    const ids = ['d1', 'd2', 'd3'];
    const snapshots = ids.map(makeSnapshot);
    mockedEvaluate.mockImplementation((snapshot) => {
      if (snapshot.identifiers.decisionId === 'd2') {
        throw new Error('dispatch exploded for d2');
      }
      return fakeEvaluation(snapshot.identifiers.decisionId);
    });

    const onResult = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    runReviewBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, { onResult, onError, onDone, isCancelled: () => false });

    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onResult.mock.calls.map((call) => call[0])).toEqual(['d1', 'd3']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('d2', 'dispatch exploded for d2');
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('stops at cancellation: no further result/error messages, and the dispatcher is never called for remaining snapshots', () => {
    const ids = ['d1', 'd2', 'd3', 'd4'];
    const snapshots = ids.map(makeSnapshot);
    mockedEvaluate.mockImplementation((snapshot) => fakeEvaluation(snapshot.identifiers.decisionId));

    const onResult = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();
    let cancelled = false;

    // Cancel after the 2nd snapshot has been dispatched.
    const isCancelled = () => cancelled;
    mockedEvaluate.mockImplementation((snapshot) => {
      const evaluation = fakeEvaluation(snapshot.identifiers.decisionId);
      if (snapshot.identifiers.decisionId === 'd2') cancelled = true;
      return evaluation;
    });

    runReviewBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, { onResult, onError, onDone, isCancelled });

    expect(onResult.mock.calls.map((call) => call[0])).toEqual(['d1', 'd2']);
    expect(onError).not.toHaveBeenCalled();
    // Proves the dispatcher itself was never invoked for the remaining
    // snapshots -- not just that their messages were suppressed after the
    // fact.
    expect(mockedEvaluate).toHaveBeenCalledTimes(2);
    expect(mockedEvaluate).not.toHaveBeenCalledWith(
      expect.objectContaining({ identifiers: expect.objectContaining({ decisionId: 'd3' }) }),
      expect.anything(),
      expect.anything(),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('passes the request budget and coverageThreshold straight through to the dispatcher -- not silently defaulted or ignored', () => {
    const snapshot = makeSnapshot('d1');
    mockedEvaluate.mockReturnValue(fakeEvaluation('d1'));

    const customBudget: ReviewDispatchBudget = {
      maxNodes: 4321,
      maxHiddenStateSamples: 77,
      maxPlyDepth: 5,
      seed: 'a-very-specific-seed',
    };
    const customThreshold = 0.37;

    runReviewBatch([snapshot], customBudget, customThreshold, {
      onResult: vi.fn(),
      onError: vi.fn(),
      onDone: vi.fn(),
      isCancelled: () => false,
    });

    expect(mockedEvaluate).toHaveBeenCalledWith(snapshot, customBudget, customThreshold);
  });
});
