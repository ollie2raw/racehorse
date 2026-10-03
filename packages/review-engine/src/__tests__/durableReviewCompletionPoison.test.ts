/**
 * Worker-isolation contract (2026-10-01): claim-time due check, job-level
 * attempt cap, fenced lease renewal, stale-pass write rejection, resume from
 * checkpoint, and per-position failures that stay retryable.
 */
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 120_000 });
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import {
  createReviewCompletionJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
  ReviewPositionBudgetExceeded,
  runReviewCompletionPass,
  type ReviewCompletionAttemptPolicy,
} from '../durableReviewCompletionRuntime';

const POLICY: ReviewCompletionAttemptPolicy = { maxAttempts: 3, backoffMs: (n) => 30_000 * 2 ** (n - 1) };
const LEASE = 60_000;

function snapshots(count = 3) {
  return REVIEW_FIXTURE_CORPUS.slice(0, count).map((f) => f.snapshot);
}

async function seed(store: InMemoryCheckpointStore, digest: string, count = 3) {
  const job = createReviewCompletionJob({
    gameDigest: digest,
    sourceMatchId: `match-${digest}`,
    userId: 'user-poison',
    snapshots: snapshots(count),
    now: 0,
  });
  await store.put(job);
  return job;
}

/** Make the stored job due now: lease and next attempt in the past. */
async function makeDue(store: InMemoryCheckpointStore, jobId: string) {
  const current = (await store.get(jobId))!;
  await store.put({ ...current, leaseExpiresAt: Date.now() - 1, nextAttemptAt: Date.now() - 1 });
}

const fastEval: typeof adaptiveEvaluateReviewPosition = (snapshot, options) =>
  adaptiveEvaluateReviewPosition(snapshot, { ...options, maxTier: 1 });

describe('claim-time due check (claim_review_completion_job_v2 semantics)', () => {
  it('does not claim a job pushed out after it was listed', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'due-pushed');
    const listed = await store.listClaimable(Date.now(), 8);
    expect(listed.map((j) => j.jobId)).toContain(job.jobId);
    // Operator pause lands between the listing and the claim.
    await store.put({ ...(await store.get(job.jobId))!, nextAttemptAt: Date.now() + 7 * 86_400_000 });
    expect(await store.claim(job.jobId, 'sweep-stale', Date.now(), LEASE)).toBeNull();
    const after = (await store.get(job.jobId))!;
    expect(after.claimGeneration ?? 0).toBe(0);
    expect(after.attemptCount ?? 0).toBe(0);
  });

  it('does not re-claim a live lease, even with the same token', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'live-lease');
    const now = Date.now();
    expect(await store.claim(job.jobId, 'tok', now, LEASE)).not.toBeNull();
    expect(await store.claim(job.jobId, 'tok', now + 1, LEASE)).toBeNull();
    expect(await store.claim(job.jobId, 'other', now + 1, LEASE)).toBeNull();
  });

  it('claim adds the attempt backoff to next_attempt_at', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'backoff');
    const now = Date.now();
    const claimed = (await store.claim(job.jobId, 'tok', now, LEASE))!;
    expect(claimed.attemptCount).toBe(1);
    expect(claimed.nextAttemptAt).toBe(now + LEASE + 30_000);
  });
});

describe('attempt cap', () => {
  it('fails the job with max_attempts_exceeded at the cap and never claims it again', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'poison');
    const evaluatePosition = () => { throw new Error('poison position'); };
    for (let attempt = 1; attempt <= POLICY.maxAttempts; attempt += 1) {
      await makeDue(store, job.jobId);
      const pass = await runReviewCompletionPass({
        store, jobId: job.jobId, claimToken: `p${attempt}`, leaseMs: LEASE, evaluatePosition,
      });
      expect(pass.claimLost).not.toBe(true);
      expect(pass.job.status).not.toBe('complete');
    }
    await makeDue(store, job.jobId);
    const capped = await runReviewCompletionPass({
      store, jobId: job.jobId, claimToken: 'p-over', leaseMs: LEASE, evaluatePosition,
    });
    expect(capped.claimLost).toBe(true);
    const final = (await store.get(job.jobId))!;
    expect(final.status).toBe('failed_fatal');
    expect(final.failureReason).toBe('max_attempts_exceeded');
    expect(final.attemptCount).toBe(POLICY.maxAttempts);
    await makeDue(store, job.jobId);
    expect(await store.claim(job.jobId, 'later', Date.now(), LEASE)).toBeNull();
  });
});

describe('lease renewal fencing', () => {
  it('renews only for the current token and generation', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'renew');
    const claimed = (await store.claim(job.jobId, 'tok', Date.now(), LEASE))!;
    const gen = claimed.claimGeneration!;
    expect(await store.renewLease(job.jobId, 'tok', gen, LEASE)).toBe(true);
    expect(await store.renewLease(job.jobId, 'other', gen, LEASE)).toBe(false);
    expect(await store.renewLease(job.jobId, 'tok', gen - 1, LEASE)).toBe(false);
  });
});

describe('stale pass cannot write', () => {
  it('a pass whose lease was taken over has its checkpoint rejected; the new pass result stands', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'stale', 1);
    let releaseA!: () => void;
    const aBlocked = new Promise<void>((resolve) => { releaseA = resolve; });
    let aEntered!: () => void;
    const aStarted = new Promise<void>((resolve) => { aEntered = resolve; });

    const passA = runReviewCompletionPass({
      store, jobId: job.jobId, claimToken: 'A', leaseMs: LEASE,
      evaluatePosition: async (snapshot, options) => {
        aEntered();
        await aBlocked;
        return fastEval(snapshot, options);
      },
    });
    await aStarted;
    // A's lease lapses (no heartbeat) and its backoff elapses; B takes over.
    await makeDue(store, job.jobId);
    const passB = await runReviewCompletionPass({
      store, jobId: job.jobId, claimToken: 'B', leaseMs: LEASE, evaluatePosition: fastEval,
    });
    expect(passB.claimLost).not.toBe(true);
    expect(jobAuthoritativeComplete(passB.job)).toBe(true);

    releaseA();
    const resultA = await passA;
    expect(resultA.claimLost).toBe(true);
    const final = (await store.get(job.jobId))!;
    expect(jobAuthoritativeComplete(final)).toBe(true);
    expect(final.claimGeneration).toBe(passB.job.claimGeneration);
  });
});

describe('resume from checkpoint and retryable per-position failures', () => {
  it('a budget overrun leaves that decision FAILED_RETRYABLE; the next pass evaluates only it', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'resume', 3);
    const slowId = job.decisions.find((d) => d.lifecycle === 'PENDING')!.decisionId;
    const calls: string[] = [];
    let first = true;

    const pass1 = await runReviewCompletionPass({
      store, jobId: job.jobId, claimToken: 'r1', leaseMs: LEASE,
      jobBackoffMs: POLICY.backoffMs,
      evaluatePosition: (snapshot, options) => {
        calls.push(snapshot.identifiers.decisionId);
        if (snapshot.identifiers.decisionId === slowId && first) {
          first = false;
          throw new ReviewPositionBudgetExceeded();
        }
        return fastEval(snapshot, options);
      },
    });
    const slow = pass1.job.decisions.find((d) => d.decisionId === slowId)!;
    expect(slow.lifecycle).toBe('FAILED_RETRYABLE');
    expect(slow.attemptCount).toBe(1);
    expect(pass1.job.status).toBe('pending');
    // Job-level backoff applies to the requeue, not just the decision backoff.
    expect(pass1.job.nextAttemptAt - pass1.job.updatedAt).toBeGreaterThanOrEqual(30_000);
    const doneAfterPass1 = pass1.job.decisions
      .filter((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED')
      .map((d) => d.decisionId);
    expect(doneAfterPass1.length).toBeGreaterThan(0);

    calls.length = 0;
    await makeDue(store, job.jobId);
    const pass2 = await runReviewCompletionPass({
      store, jobId: job.jobId, claimToken: 'r2', leaseMs: LEASE,
      evaluatePosition: (snapshot, options) => {
        calls.push(snapshot.identifiers.decisionId);
        return fastEval(snapshot, options);
      },
    });
    expect(calls).toEqual([slowId]);
    expect(jobAuthoritativeComplete(pass2.job)).toBe(true);
  });

  it('an evaluator crash is retryable, never FAILED_FATAL', async () => {
    const store = new InMemoryCheckpointStore(POLICY);
    const job = await seed(store, 'crash', 1);
    const pass = await runReviewCompletionPass({
      store, jobId: job.jobId, claimToken: 'c1', leaseMs: LEASE,
      evaluatePosition: () => { throw new Error('worker exited'); },
    });
    expect(pass.job.decisions.every((d) => d.lifecycle !== 'FAILED_FATAL')).toBe(true);
    expect(pass.job.status).toBe('pending');
  });
});
