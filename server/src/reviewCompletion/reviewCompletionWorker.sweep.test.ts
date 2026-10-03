import { afterEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../packages/game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../../../packages/review-engine/src/adaptiveEvaluateReviewPosition';
import {
  createReviewCompletionJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
} from '../../../packages/review-engine/src/durableReviewCompletionRuntime';
import {
  setReviewCompletionStoreForTests,
  setReviewPositionEvaluatorForTests,
  sweepReviewCompletionJobs,
} from './reviewCompletionWorker';

const POLICY = { maxAttempts: 5, backoffMs: (n: number) => 30_000 * 2 ** (n - 1) };

function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => { release = resolve; });
  return { opened, release };
}

const fastEval: typeof adaptiveEvaluateReviewPosition = (snapshot, options) =>
  adaptiveEvaluateReviewPosition(snapshot, { ...options, maxTier: 1 });

async function seed(store: InMemoryCheckpointStore, digest: string, count: number) {
  const job = createReviewCompletionJob({
    gameDigest: digest,
    sourceMatchId: `m-${digest}`,
    userId: 'sweep-user',
    snapshots: REVIEW_FIXTURE_CORPUS.slice(0, count).map((f) => f.snapshot),
    now: Date.now() - 1_000,
  });
  await store.put(job);
  return job;
}

describe('review completion sweep', () => {
  afterEach(() => {
    setReviewPositionEvaluatorForTests(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('single flight: an overlapping sweep does not claim or run the job again', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'single-flight', 1);
    const claim = vi.spyOn(store, 'claim');
    const { opened, release } = gate();
    let evaluations = 0;
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluations += 1;
      await opened;
      return fastEval(snapshot, options);
    });

    const first = sweepReviewCompletionJobs();
    await vi.waitFor(() => expect(evaluations).toBe(1));
    const overlapping = await sweepReviewCompletionJobs();
    expect(overlapping.ran).toBe(0);
    release();
    const result = await first;

    expect(claim).toHaveBeenCalledTimes(1);
    expect(evaluations).toBe(1);
    expect(result.completed).toBe(1);
    expect(jobAuthoritativeComplete((await store.get(job.jobId))!)).toBe(true);
  }, 60_000);

  it('heartbeat renews the lease while a position runs, and a lost lease stops the pass without writing', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const store = new InMemoryCheckpointStore(POLICY);
    setReviewCompletionStoreForTests(store);
    const job = await seed(store, 'heartbeat', 2);
    const renew = vi.spyOn(store, 'renewLease');
    const { opened, release } = gate();
    const evaluated: string[] = [];
    setReviewPositionEvaluatorForTests(async (snapshot, options) => {
      evaluated.push(snapshot.identifiers.decisionId);
      await opened;
      return fastEval(snapshot, options);
    });

    const sweep = sweepReviewCompletionJobs();
    await vi.waitFor(() => expect(evaluated.length).toBe(1));
    const claimed = (await store.get(job.jobId))!;
    const leaseBefore = claimed.leaseExpiresAt!;

    await vi.advanceTimersByTimeAsync(20_000);
    expect(renew).toHaveBeenCalledWith(job.jobId, claimed.claimToken, claimed.claimGeneration, 60_000);
    expect((await store.get(job.jobId))!.leaseExpiresAt!).toBeGreaterThanOrEqual(leaseBefore);

    // Another process takes the job over (its lease lapsed from its view).
    await store.put({ ...(await store.get(job.jobId))!, leaseExpiresAt: Date.now() - 1, nextAttemptAt: Date.now() - 1 });
    const takeover = (await store.claim(job.jobId, 'other-process', Date.now(), 60_000))!;
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(renew.mock.results.at(-1)!.value).resolves.toBe(false);

    release();
    await sweep;
    // Stopped at the next position: the second decision was never searched.
    expect(evaluated).toHaveLength(1);
    const final = (await store.get(job.jobId))!;
    expect(final.claimToken).toBe('other-process');
    expect(final.claimGeneration).toBe(takeover.claimGeneration);
    // The superseded pass wrote nothing after the takeover.
    expect(final.updatedAt).toBe(takeover.updatedAt);
    expect(final.decisions).toEqual(takeover.decisions);
  }, 60_000);
});
