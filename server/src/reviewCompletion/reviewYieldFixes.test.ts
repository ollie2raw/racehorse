/**
 * Audit C1 and C2 (docs/audit-parts/C-review-sweep.md, branch audit/2026-11-17), as plain tests, with the flag on and off.
 * C1: a queued job's claim depended on which 15 s tick fell inside a 5 s starvation slice. C2: a held decision whose lease was lost ran a search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import { createReviewCompletionJob, InMemoryCheckpointStore } from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  REVIEW_YIELD_CONFIG,
  msUntilNextReviewSlice,
  resetReviewYieldForTests,
  reviewYieldDecision,
  setReviewLiveRoomProbe,
  setReviewYieldSleepForTests,
} from './reviewLivePlayYield';
import {
  setReviewCompletionStoreForTests,
  setReviewPositionEvaluatorForTests,
  stopReviewCompletionSweepForTests,
  sweepReviewCompletionJobs,
} from './reviewCompletionWorker';
import { resetProcessLifecycleForTests } from '../platform/processLifecycle';

const POLICY = { maxAttempts: 5, backoffMs: (n: number) => 30_000 * 2 ** (n - 1) };
const MIN = 60_000;
const fastEval: typeof adaptiveEvaluateReviewPosition = (snapshot, options) => adaptiveEvaluateReviewPosition(snapshot, { ...options, maxTier: 1 });

async function seed(store: InMemoryCheckpointStore, digest: string, count: number) {
  const job = createReviewCompletionJob({
    gameDigest: digest,
    sourceMatchId: `m-${digest}`,
    userId: 'fix-user',
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

describe('msUntilNextReviewSlice', () => {
  it('is null when nothing live has been seen, counts to the starvation point first, then to the next 60 s boundary, and is null inside a slice', () => {
    expect(msUntilNextReviewSlice(0)).toBeNull();
    setReviewLiveRoomProbe(() => 1);
    reviewYieldDecision(7_000); // the stretch starts at 7 s
    const start = 7_000;
    expect(msUntilNextReviewSlice(start)).toBe(REVIEW_YIELD_CONFIG.starvationAfterMs);
    expect(msUntilNextReviewSlice(start + 10 * MIN - 1_000)).toBe(1_000);
    expect(msUntilNextReviewSlice(start + 10 * MIN)).toBeNull(); // inside slice 0
    expect(msUntilNextReviewSlice(start + 10 * MIN + 4_999)).toBeNull();
    expect(msUntilNextReviewSlice(start + 10 * MIN + 5_000)).toBe(MIN - 5_000);
    expect(msUntilNextReviewSlice(start + 10 * MIN + 59_000)).toBe(1_000);
  });
});

describe('C1: a queued job is claimed during live play even when the ticks miss the slice phase', () => {
  // The clock is started by a poll at t = 7 s (a waiting player's poll calls reviewYieldDecision); the periodic ticks are every 15 s from 0,
  // so no tick ever lands inside a slice (slices open at 7 s + 10 min + k * 60 s, 5 s wide; ticks are at multiples of 15 s).
  async function run(): Promise<{ status: string | undefined }> {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(0);
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'c1-queued', 1);
    setReviewLiveRoomProbe(() => 1);
    setReviewPositionEvaluatorForTests((snapshot, options) => fastEval(snapshot, options));
    await vi.advanceTimersByTimeAsync(7_000);
    reviewYieldDecision(); // the poll that starts the 10-minute clock
    // 20 minutes of ticks, exactly as the periodic timer would call them (it calls sweepReviewCompletionJobs), 5 s polls in between.
    for (let t = 7_000; t < 20 * MIN; t += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
      if ((t + 1_000) % 5_000 === 2_000) reviewYieldDecision(); // polls keep the stretch continuous
      if ((t + 1_000) % 15_000 === 0) await sweepReviewCompletionJobs();
    }
    return { status: (await store.get(job.jobId))?.status };
  }

  it('flag off (today): the job is never claimed in 20 minutes of continuous play', async () => {
    const { status } = await run();
    expect(status).not.toBe('complete');
  });

  it('flag on: the deferred sweep arms one at the next slice and the job completes', async () => {
    vi.stubEnv('REVIEW_YIELD_FIXES_ENABLED', 'true');
    const { status } = await run();
    expect(status).toBe('complete');
  });
});

describe('C2: a decision held while the lease is lost does not run a search', () => {
  async function run(): Promise<number> {
    const store = new InMemoryCheckpointStore(POLICY);
    store.renewLease = async () => false; // fenced: another claimant holds the job
    setReviewCompletionStoreForTests(store);
    await seed(store, 'c2-lease-lost', 2);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let live = 0;
    setReviewLiveRoomProbe(() => live);
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      if (evaluations === 1) live = 1; // a game starts while decision 1 runs; decision 2 is held
      return fastEval(snapshot, options);
    });
    setReviewYieldSleepForTests(async () => {
      await vi.advanceTimersByTimeAsync(20_000); // the 20 s heartbeat fires and learns the lease is lost
      await new Promise((resolve) => setImmediate(resolve));
    });
    await sweepReviewCompletionJobs();
    return evaluations;
  }

  it('flag off (today): the held decision is released into a search (2 evaluations)', async () => {
    expect(await run()).toBe(2);
  });

  it('flag on: the pass stops after the first decision', async () => {
    vi.stubEnv('REVIEW_YIELD_FIXES_ENABLED', 'true');
    expect(await run()).toBe(1);
  });
});
