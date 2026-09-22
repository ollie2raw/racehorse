import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../../packages/game-core/src/reviewFixtureCorpus';
import { evaluateReviewPosition, WALL_CLOCK_CEILING_DIAGNOSTIC, type ReviewDispatchBudget } from '@racehorse/review-engine';
import {
  partitionIndices,
  runReviewBatchPool,
  toOrderedEvaluations,
  type ReviewWorkerLike,
} from './runReviewBatchPool';
import { runReviewBatch } from './runReviewBatch';
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
    legalActions: [{ kind: 'pass' }],
    actualAction: { kind: 'pass' },
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  } as ReviewPositionSnapshotV2;
}

function fakeEvaluation(decisionId: string): ReviewEvaluationV1 {
  const candidate = {
    action: { kind: 'pass' as const },
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

const BUDGET: ReviewDispatchBudget = { maxNodes: 1000, maxHiddenStateSamples: 10, maxPlyDepth: 2, seed: 'test-seed' };
const COVERAGE_THRESHOLD = 0.02;

describe('partitionIndices', () => {
  it('round-robins indices across the pool, covering every index exactly once', () => {
    const partitions = partitionIndices(7, 3);
    expect(partitions).toEqual([
      [0, 3, 6],
      [1, 4],
      [2, 5],
    ]);
    const flat = partitions.flat().sort((a, b) => a - b);
    expect(flat).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('clamps pool size to at least 1 and at most the item count', () => {
    expect(partitionIndices(3, 10)).toHaveLength(3);
    expect(partitionIndices(3, 0)).toHaveLength(1);
    expect(partitionIndices(0, 4)).toHaveLength(1);
    expect(partitionIndices(0, 4)[0]).toEqual([]);
  });

  it('is a pure function of (length, poolSize) -- same result every call', () => {
    expect(partitionIndices(10, 4)).toEqual(partitionIndices(10, 4));
  });
});

/**
 * A fake worker that runs the REAL runReviewBatch synchronously against
 * whatever partition it's given, in a controllable arrival order (via
 * `resolveOrder`) -- lets tests simulate one worker's messages arriving
 * before or after another's without any real thread/timing involved.
 */
function makeFakeWorkerFactory() {
  const workers: ReviewWorkerLike[] = [];
  const createWorker = (): ReviewWorkerLike => {
    const worker: ReviewWorkerLike = {
      postMessage: vi.fn((message: ReviewWorkerRequest) => {
        if (message.type === 'cancel') return;
        // Deferred to a microtask so multiple workers' message delivery can
        // be interleaved by the test in whatever order it chooses, rather
        // than one worker always finishing entirely before the next starts.
        queueMicrotask(() => {
          runReviewBatch(message.snapshots, message.budget, message.coverageThreshold, {
            onResult: (decisionId, evaluation) => {
              const response: ReviewWorkerResponse = { type: 'result', decisionId, evaluation };
              worker.onmessage?.({ data: response });
            },
            onError: (decisionId, msg) => {
              const response: ReviewWorkerResponse = { type: 'error', decisionId, message: msg };
              worker.onmessage?.({ data: response });
            },
            onDone: () => {
              worker.onmessage?.({ data: { type: 'done' } });
            },
            isCancelled: () => false,
          });
        });
      }),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };
    workers.push(worker);
    return worker;
  };
  return { createWorker, workers };
}

describe('runReviewBatchPool', () => {
  it('produces the same resultsByDecisionId regardless of pool size (1, 2, 4 workers)', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `d${i}`);
    const snapshots = ids.map(makeSnapshot);

    const outcomes = await Promise.all(
      [1, 2, 4].map(async (poolSize) => {
        const { createWorker } = makeFakeWorkerFactory();
        const result = await runReviewBatchPool(snapshots, BUDGET, COVERAGE_THRESHOLD, { poolSize, createWorker });
        return toOrderedEvaluations(snapshots, result);
      }),
    );

    // The real determinism claim: byte-identical JSON regardless of pool
    // size, whether each decision resolved to a real evaluation or an
    // isolated per-decision error -- both are covered by the same
    // real runReviewBatch/evaluateReviewPosition call, not a mock.
    expect(JSON.stringify(outcomes[0])).toEqual(JSON.stringify(outcomes[1]));
    expect(JSON.stringify(outcomes[0])).toEqual(JSON.stringify(outcomes[2]));
    // Every slot was accounted for (no decision silently dropped).
    expect(outcomes[0]).toHaveLength(ids.length);
  });

  it('reassembles in original snapshot order even when workers report out of order', async () => {
    const ids = ['d0', 'd1', 'd2', 'd3'];
    const snapshots = ids.map(makeSnapshot);
    const evaluationsByDecision = new Map(ids.map((id) => [id, fakeEvaluation(id)]));

    // Two workers, each handling one partition -- worker for the ODD
    // indices reports its results before the worker for the EVEN indices,
    // simulating arrival-order independence directly (no real evaluation
    // needed here; toOrderedEvaluations is what must not care).
    const workerA: ReviewWorkerLike = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
    const workerB: ReviewWorkerLike = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
    let call = 0;
    const createWorker = () => (call++ === 0 ? workerA : workerB);

    const resultPromise = runReviewBatchPool(snapshots, BUDGET, COVERAGE_THRESHOLD, { poolSize: 2, createWorker });

    // workerA handles [d0, d2] (even indices), workerB handles [d1, d3].
    // Fire workerB's messages first to prove arrival order doesn't leak
    // into the aggregation.
    workerB.onmessage!({ data: { type: 'result', decisionId: 'd3', evaluation: evaluationsByDecision.get('d3')! } });
    workerB.onmessage!({ data: { type: 'result', decisionId: 'd1', evaluation: evaluationsByDecision.get('d1')! } });
    workerB.onmessage!({ data: { type: 'done' } });
    workerA.onmessage!({ data: { type: 'result', decisionId: 'd0', evaluation: evaluationsByDecision.get('d0')! } });
    workerA.onmessage!({ data: { type: 'result', decisionId: 'd2', evaluation: evaluationsByDecision.get('d2')! } });
    workerA.onmessage!({ data: { type: 'done' } });

    const result = await resultPromise;
    const ordered = toOrderedEvaluations(snapshots, result);
    expect((ordered as ReviewEvaluationV1[]).map((e) => e.snapshotId)).toEqual(['d0', 'd1', 'd2', 'd3']);
  });

  it('isolates a per-decision error to its slot without losing the rest of the batch', async () => {
    const ids = ['d0', 'd1', 'd2'];
    const snapshots = ids.map(makeSnapshot);
    const worker: ReviewWorkerLike = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null };
    const createWorker = () => worker;

    const resultPromise = runReviewBatchPool(snapshots, BUDGET, COVERAGE_THRESHOLD, { poolSize: 1, createWorker });
    worker.onmessage!({ data: { type: 'result', decisionId: 'd0', evaluation: fakeEvaluation('d0') } });
    worker.onmessage!({ data: { type: 'error', decisionId: 'd1', message: 'boom' } });
    worker.onmessage!({ data: { type: 'result', decisionId: 'd2', evaluation: fakeEvaluation('d2') } });
    worker.onmessage!({ data: { type: 'done' } });

    const result = await resultPromise;
    expect(result.resultsByDecisionId.size).toBe(2);
    expect(result.errorsByDecisionId.get('d1')).toBe('boom');
    const ordered = toOrderedEvaluations(snapshots, result);
    expect(ordered[1]).toEqual({ decisionId: 'd1', error: 'boom' });
  });

  it('terminates every worker once it reports done', async () => {
    const ids = ['d0', 'd1'];
    const snapshots = ids.map(makeSnapshot);
    const { createWorker, workers } = makeFakeWorkerFactory();

    await runReviewBatchPool(snapshots, BUDGET, COVERAGE_THRESHOLD, { poolSize: 2, createWorker });
    for (const worker of workers) {
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    }
  });

  it('matches sequential runReviewBatch JSON for poolSize 1 (pre-pool canonical)', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `canon-${i}`);
    const snapshots = ids.map(makeSnapshot);
    const sequentialResults = new Map<string, ReviewEvaluationV1>();
    const sequentialErrors = new Map<string, string>();
    runReviewBatch(snapshots, BUDGET, COVERAGE_THRESHOLD, {
      onResult: (decisionId, evaluation) => {
        sequentialResults.set(decisionId, evaluation);
      },
      onError: (decisionId, message) => {
        sequentialErrors.set(decisionId, message);
      },
      onDone: () => {},
      isCancelled: () => false,
    });
    const sequentialOrdered = toOrderedEvaluations(snapshots, {
      resultsByDecisionId: sequentialResults,
      errorsByDecisionId: sequentialErrors,
    });

    const { createWorker } = makeFakeWorkerFactory();
    const pooled = await runReviewBatchPool(snapshots, BUDGET, COVERAGE_THRESHOLD, {
      poolSize: 1,
      createWorker,
    });
    expect(JSON.stringify(toOrderedEvaluations(snapshots, pooled))).toEqual(JSON.stringify(sequentialOrdered));
  });

  it('F4b: mixed normal+forced-timeout decisions stay byte-identical across 1 vs 2 workers; timeout does not poison siblings', async () => {
    const fixtures = REVIEW_FIXTURE_CORPUS.filter((f) => f.snapshot.preAction.boneyard.drawableCount > 0).slice(0, 2);
    expect(fixtures.length).toBe(2);
    const snapshots = fixtures.map((f) => f.snapshot);
    const timeoutId = snapshots[0].identifiers.decisionId;

    const budget: ReviewDispatchBudget = {
      maxNodes: 5_000,
      maxHiddenStateSamples: 8,
      maxPlyDepth: 2,
      seed: 'f4b-pool-mix',
      maxWallClockMs: 100,
    };

    const makeNowForDecision = (decisionId: string): (() => number) => {
      if (decisionId !== timeoutId) return () => 0;
      let calls = 0;
      return () => {
        calls += 1;
        return calls === 1 ? 0 : 1_000_000;
      };
    };

    const createWorkerWithPerDecisionClock = (): ReviewWorkerLike => {
      const worker: ReviewWorkerLike = {
        postMessage: vi.fn((message: ReviewWorkerRequest) => {
          if (message.type === 'cancel') return;
          queueMicrotask(() => {
            for (const snapshot of message.snapshots) {
              try {
                const evaluation = evaluateReviewPosition(
                  snapshot,
                  message.budget,
                  message.coverageThreshold,
                  makeNowForDecision(snapshot.identifiers.decisionId),
                );
                worker.onmessage?.({ data: { type: 'result', decisionId: snapshot.identifiers.decisionId, evaluation } });
              } catch (error) {
                worker.onmessage?.({
                  data: {
                    type: 'error',
                    decisionId: snapshot.identifiers.decisionId,
                    message: error instanceof Error ? error.message : String(error),
                  },
                });
              }
            }
            worker.onmessage?.({ data: { type: 'done' } });
          });
        }),
        terminate: vi.fn(),
        onmessage: null,
        onerror: null,
      };
      return worker;
    };

    const runPool = async (poolSize: number) => {
      const result = await runReviewBatchPool(snapshots, budget, COVERAGE_THRESHOLD, {
        poolSize,
        createWorker: createWorkerWithPerDecisionClock,
      });
      expect([...result.errorsByDecisionId]).toEqual([]);
      return toOrderedEvaluations(snapshots, result);
    };

    const ordered1 = await runPool(1);
    const ordered2 = await runPool(2);
    expect(JSON.stringify(ordered1)).toEqual(JSON.stringify(ordered2));

    const timeoutEval = ordered1[0] as ReviewEvaluationV1;
    const normalEval = ordered1[1] as ReviewEvaluationV1;
    expect(timeoutEval.search.complete).toBe(false);
    expect(timeoutEval.diagnostics).toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
    expect(normalEval.search.complete).toBe(true);
    expect(normalEval.diagnostics).not.toContain(WALL_CLOCK_CEILING_DIAGNOSTIC);
  });
});
