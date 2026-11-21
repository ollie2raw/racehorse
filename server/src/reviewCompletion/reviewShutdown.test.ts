/**
 * Audit C3 (docs/audit-parts/C-review-sweep.md): once shutdown begins, a running review pass must not start another search.
 * Before: runReviewCompletionPass checked only the lease (`leaseLost`), and the live-play hold releases on shutdown straight into a fresh evaluation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import { createReviewCompletionJob, InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import { resetReviewYieldForTests, setReviewLiveRoomProbe, setReviewYieldSleepForTests } from './reviewLivePlayYield';
import { setReviewCompletionStoreForTests, setReviewPositionEvaluatorForTests, stopReviewCompletionSweepForTests, sweepReviewCompletionJobs } from './reviewCompletionWorker';
import { closeProcessAdmission, resetProcessLifecycleForTests } from '../platform/processLifecycle';

const POLICY = { maxAttempts: 5, backoffMs: (n: number) => 30_000 * 2 ** (n - 1) };
const fastEval: typeof adaptiveEvaluateReviewPosition = (snapshot, options) => adaptiveEvaluateReviewPosition(snapshot, { ...options, maxTier: 1 });

async function seed(store: InMemoryCheckpointStore, digest: string, count: number) {
  const job = createReviewCompletionJob({
    gameDigest: digest,
    sourceMatchId: `m-${digest}`,
    userId: 'shutdown-user',
    snapshots: REVIEW_FIXTURE_CORPUS.slice(0, count).map((f) => f.snapshot),
    now: Date.now() - 1_000,
  });
  await store.put(job);
  return job;
}

beforeEach(() => {
  resetReviewYieldForTests();
  vi.stubEnv('REVIEW_SWEEP_ENABLED', 'true');
});
afterEach(() => {
  setReviewPositionEvaluatorForTests(null);
  stopReviewCompletionSweepForTests();
  resetReviewYieldForTests();
  resetProcessLifecycleForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('C3: a review pass stops evaluating when shutdown begins', () => {
  it('admission closes during decision 1 of 3: no further decision is evaluated', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'c3-shutdown', 3);
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      if (evaluations === 1) closeProcessAdmission(); // SIGTERM arrives during decision 1
      return fastEval(snapshot, options);
    });
    await sweepReviewCompletionJobs();
    expect(evaluations).toBe(1);
    // The decisions after the one that was running are left exactly as they were: not failed, not charged an attempt (a thrown decision would be
    // FAILED_RETRYABLE with an attempt counted; shouldAbort ends the pass before it gets there).
    const stored = (await store.get(job.jobId))!;
    const untouched = stored.decisions.filter((d) => d.attemptCount === 0);
    expect(untouched.length).toBeGreaterThanOrEqual(2);
    expect(stored.decisions.some((d) => String(d.status) === 'FAILED_RETRYABLE')).toBe(false);
  });

  it('a decision held for live play is not released into a search by shutdown', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    await seed(store, 'c3-held', 3);
    let live = 0;
    setReviewLiveRoomProbe(() => live);
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      if (evaluations === 1) live = 1; // a game starts while decision 1 runs: decision 2 is held
      return fastEval(snapshot, options);
    });
    setReviewYieldSleepForTests(async () => {
      closeProcessAdmission(); // shutdown while held: the hold releases on isProcessClosing
    });
    await sweepReviewCompletionJobs();
    expect(evaluations).toBe(1);
  });

  it('without shutdown the pass still evaluates every decision (the guard is not over-eager)', { timeout: 60_000 }, async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    await seed(store, 'c3-normal', 2);
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      return fastEval(snapshot, options);
    });
    await sweepReviewCompletionJobs();
    expect(evaluations).toBe(2);
  });
});
