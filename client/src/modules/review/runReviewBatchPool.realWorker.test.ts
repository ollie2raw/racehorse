// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ReviewDispatchBudget } from '@racehorse/review-engine';
import { REVIEW_FIXTURE_CORPUS } from '../../../../packages/game-core/src/reviewFixtureCorpus';
import { DEFAULT_REVIEW_COVERAGE_THRESHOLD } from './reviewEngineConfig';
import { runReviewBatch } from './runReviewBatch';
import { createNodeReviewWorker } from './reviewWorkerPool.node';
import { runReviewBatchPool, toOrderedEvaluations } from './runReviewBatchPool';

/**
 * F4a acceptance: real Node worker_threads, not mocks.
 * Budget matches production shape (no maxWallClockMs / F4b fields).
 * Fixture: first 12 hand-authored REVIEW_FIXTURE_CORPUS snapshots.
 */
const BUDGET: ReviewDispatchBudget = {
  maxNodes: 20_000,
  maxHiddenStateSamples: 20,
  maxPlyDepth: 2,
  seed: 'real-worker-parity',
};

const SNAPSHOTS = REVIEW_FIXTURE_CORPUS.slice(0, 12).map((fixture) => fixture.snapshot);

function runSequentialCanonical() {
  const resultsByDecisionId = new Map();
  const errorsByDecisionId = new Map();
  runReviewBatch(SNAPSHOTS, BUDGET, DEFAULT_REVIEW_COVERAGE_THRESHOLD, {
    onResult: (decisionId, evaluation) => {
      resultsByDecisionId.set(decisionId, evaluation);
    },
    onError: (decisionId, message) => {
      errorsByDecisionId.set(decisionId, message);
    },
    onDone: () => {},
    isCancelled: () => false,
  });
  return toOrderedEvaluations(SNAPSHOTS, { resultsByDecisionId, errorsByDecisionId });
}

describe('F4a real Node review workers', () => {
  it('matches sequential runReviewBatch and keeps 1/2/4-worker JSON byte-identical', async () => {
    const sequentialJson = JSON.stringify(runSequentialCanonical());

    const outcomes = await Promise.all(
      [1, 2, 4].map(async (poolSize) => {
        const result = await runReviewBatchPool(SNAPSHOTS, BUDGET, DEFAULT_REVIEW_COVERAGE_THRESHOLD, {
          poolSize,
          createWorker: createNodeReviewWorker,
        });
        expect([...result.errorsByDecisionId]).toEqual([]);
        return toOrderedEvaluations(SNAPSHOTS, result);
      }),
    );

    const json1 = JSON.stringify(outcomes[0]);
    const json2 = JSON.stringify(outcomes[1]);
    const json4 = JSON.stringify(outcomes[2]);

    expect(json1).toBe(sequentialJson);
    expect(json2).toBe(json1);
    expect(json4).toBe(json1);
  }, 120_000);

  it('repeated parallel runs with identical inputs emit identical JSON', async () => {
    const first = await runReviewBatchPool(SNAPSHOTS, BUDGET, DEFAULT_REVIEW_COVERAGE_THRESHOLD, {
      poolSize: 3,
      createWorker: createNodeReviewWorker,
    });
    const second = await runReviewBatchPool(SNAPSHOTS, BUDGET, DEFAULT_REVIEW_COVERAGE_THRESHOLD, {
      poolSize: 3,
      createWorker: createNodeReviewWorker,
    });
    expect(JSON.stringify(toOrderedEvaluations(SNAPSHOTS, first))).toBe(
      JSON.stringify(toOrderedEvaluations(SNAPSHOTS, second)),
    );
  }, 120_000);

  it('does not change DEFAULT_REVIEW_DISPATCH_BUDGET / coverage constants', async () => {
    const { DEFAULT_REVIEW_DISPATCH_BUDGET } = await import('./reviewEngineConfig');
    expect(DEFAULT_REVIEW_DISPATCH_BUDGET).toEqual({
      maxNodes: 200_000,
      maxHiddenStateSamples: 100,
      maxPlyDepth: 2,
      seed: 'racehorse-review-default-seed',
    });
    expect(DEFAULT_REVIEW_COVERAGE_THRESHOLD).toBe(0.02);
    expect('maxWallClockMs' in DEFAULT_REVIEW_DISPATCH_BUDGET).toBe(false);
  });
});
