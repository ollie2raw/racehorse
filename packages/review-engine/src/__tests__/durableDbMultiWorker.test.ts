/**
 * Part B — process-death / multi-instance durable repository coverage.
 * Exercises SqlSemanticsCheckpointStore (mirrors Postgres claim/checkpoint RPCs).
 */
import { describe, expect, it } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import {
  createReviewCompletionJob,
  finalArtifactFromJob,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
} from '../durableReviewCompletionRuntime';
import { SqlSemanticsCheckpointStore } from '../durableSqlSemanticsCheckpointStore';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

function miniGameSnapshots() {
  return REVIEW_FIXTURE_CORPUS.slice(0, 4).map((f) => f.snapshot);
}

function liveMap(snapshots: ReturnType<typeof miniGameSnapshots>) {
  return new Map(
    snapshots.map((snapshot) => {
      const evaluation = evaluateReviewPosition(
        snapshot,
        {
          maxNodes: 50_000,
          maxHiddenStateSamples: 20,
          maxPlyDepth: 1,
          seed: 'durable-db-live',
          maxWallClockMs: 500,
        },
        0.02,
      );
      return [snapshot.identifiers.decisionId, evaluation] as const;
    }),
  );
}

async function driveToComplete(
  store: SqlSemanticsCheckpointStore,
  jobId: string,
  claimPrefix: string,
  maxPasses = 16,
) {
  let current = (await store.get(jobId))!;
  for (let pass = 0; pass < maxPasses && !jobAuthoritativeComplete(current); pass += 1) {
    const result = await runReviewCompletionPass({
      store,
      jobId,
      claimToken: `${claimPrefix}-${pass}`,
      maxTier: 3,
      leaseMs: 60_000,
    });
    current = result.job;
  }
  return current;
}

describe('durable DB repository — multi-worker / process death', () => {
  it('A: worker A claims → partial → dies → lease expires → B finishes → one result', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-death-a',
      sourceMatchId: 'match-a',
      userId: 'user-a',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);

    const t0 = 1_000_000;
    const passA = await runReviewCompletionPass({
      store,
      jobId: job.jobId,
      claimToken: 'worker-a',
      now: t0,
      leaseMs: 5_000,
      dieAfterDecisions: 1,
      maxTier: 3,
    });
    expect(passA.interrupted).toBe(true);
    expect(jobAuthoritativeComplete(passA.job)).toBe(false);
    const mid = (await store.get(job.jobId))!;
    const scoredMid = mid.decisions.filter(
      (d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED',
    ).length;
    expect(scoredMid).toBeGreaterThan(0);

    // Process A is dead; lease still held until expiry. B cannot claim yet.
    const tooEarly = await store.claim(job.jobId, 'worker-b', t0 + 1, 60_000);
    if (mid.claimToken === 'worker-a' && (mid.leaseExpiresAt ?? 0) > t0 + 1) {
      expect(tooEarly).toBeNull();
    }

    // After lease expiry, B recovers.
    const afterExpiry = Math.max(t0 + 10_000, (mid.leaseExpiresAt ?? t0) + 1);
    let current = (
      await runReviewCompletionPass({
        store,
        jobId: job.jobId,
        claimToken: 'worker-b',
        now: afterExpiry,
        leaseMs: 60_000,
        maxTier: 3,
      })
    ).job;
    expect(store.recoveredClaims).toBeGreaterThan(0);
    for (let i = 0; i < 12 && !jobAuthoritativeComplete(current); i += 1) {
      current = (
        await runReviewCompletionPass({
          store,
          jobId: job.jobId,
          claimToken: `worker-b-resume-${i}`,
          now: afterExpiry + i + 1,
          maxTier: 3,
        })
      ).job;
    }
    expect(jobAuthoritativeComplete(current)).toBe(true);
    expect(current.decisions.every((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED')).toBe(
      true,
    );
    // Single authoritative job for digest.
    const again = await store.getByGameDigest('db-death-a', 'user-a');
    expect(again?.jobId).toBe(job.jobId);
    expect(jobAuthoritativeComplete(again!)).toBe(true);
  }, 300_000);

  it('B: checkpoint then “server death” before client ack → resume without duplicate eval', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-death-b',
      sourceMatchId: 'match-b',
      userId: 'user-b',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);

    const partial = await runReviewCompletionPass({
      store,
      jobId: job.jobId,
      claimToken: 'worker-server-1',
      dieAfterDecisions: 1,
      maxTier: 3,
    });
    expect(partial.interrupted).toBe(true);
    const checkpointed = (await store.get(job.jobId))!;
    const attemptsBefore = checkpointed.decisions.map((d) => d.attemptCount);

    // New process: fresh store instance loaded from durable snapshot.
    // Server death releases lease (claim token cleared / nextAttemptAt=0) the
    // same way an expired lease would after RECOVERY_LEASE_MS.
    const store2 = new SqlSemanticsCheckpointStore();
    const restored = {
      ...JSON.parse(JSON.stringify(checkpointed)),
      status: 'pending' as const,
      claimToken: null,
      leaseExpiresAt: 0,
      nextAttemptAt: 0,
    };
    await store2.put(restored);

    const finished = await driveToComplete(store2, job.jobId, 'worker-server-2');
    expect(jobAuthoritativeComplete(finished)).toBe(true);
    // Decisions already SCORED/FORCED keep attempt counts (no re-eval).
    for (let i = 0; i < finished.decisions.length; i += 1) {
      const d = finished.decisions[i]!;
      if (attemptsBefore[i]! > 0 && (d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED')) {
        // Already terminal rows are skipped — attemptCount unchanged.
        expect(d.attemptCount).toBe(attemptsBefore[i]);
      }
    }
  }, 300_000);

  it('C: two workers race to claim → exactly one authoritative claim/result', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-race-c',
      sourceMatchId: 'match-c',
      userId: 'user-c',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);

    const now = Date.now();
    const [a, b] = await Promise.all([
      store.claim(job.jobId, 'racer-a', now, 60_000),
      store.claim(job.jobId, 'racer-b', now, 60_000),
    ]);
    const winners = [a, b].filter(Boolean);
    expect(winners).toHaveLength(1);
    const winnerToken = winners[0]!.claimToken;
    expect(winnerToken === 'racer-a' || winnerToken === 'racer-b').toBe(true);

    const loserToken = winnerToken === 'racer-a' ? 'racer-b' : 'racer-a';
    const lost = await runReviewCompletionPass({
      store,
      jobId: job.jobId,
      claimToken: loserToken,
      now: now + 1,
      maxTier: 3,
    });
    expect(lost.claimLost).toBe(true);

    let current = (
      await runReviewCompletionPass({
        store,
        jobId: job.jobId,
        claimToken: winnerToken!,
        now: now + 2,
        maxTier: 3,
      })
    ).job;
    for (let i = 0; i < 12 && !jobAuthoritativeComplete(current); i += 1) {
      current = (
        await runReviewCompletionPass({
          store,
          jobId: job.jobId,
          claimToken: `${winnerToken}-cont-${i}`,
          now: now + 100 + i,
          maxTier: 3,
        })
      ).job;
    }
    expect(jobAuthoritativeComplete(current)).toBe(true);
  }, 300_000);

  it('D: client gone — server still finishes; later poll sees immutable complete', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-client-d',
      sourceMatchId: 'match-d',
      userId: 'user-d',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);
    // Client closed permanently — only server workers remain.
    const finished = await driveToComplete(store, job.jobId, 'server-only');
    expect(jobAuthoritativeComplete(finished)).toBe(true);

    const poll1 = finalArtifactFromJob((await store.get(job.jobId))!);
    const poll2 = finalArtifactFromJob((await store.getByGameDigest('db-client-d', 'user-d'))!);
    expect(poll1.positionHashes).toEqual(poll2.positionHashes);
    expect(poll1.lifecycles).toEqual(poll2.lifecycles);
    expect(poll1.evaluations.map((e) => e.loss.expectedPointDifferential)).toEqual(
      poll2.evaluations.map((e) => e.loss.expectedPointDifferential),
    );

    // Re-put pending must not demote.
    await store.put({ ...finished, status: 'pending', claimToken: null });
    expect((await store.get(job.jobId))!.status).toBe('complete');
  }, 300_000);

  it('E: transient DB error → retry → no lost work', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-transient-e',
      sourceMatchId: 'match-e',
      userId: 'user-e',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);

    store.failNextMutations = 1;
    await expect(
      runReviewCompletionPass({
        store,
        jobId: job.jobId,
        claimToken: 'worker-e-1',
        maxTier: 3,
      }),
    ).rejects.toThrow(/transient/);

    // Job still durable from put; retry succeeds.
    const finished = await driveToComplete(store, job.jobId, 'worker-e-retry');
    expect(jobAuthoritativeComplete(finished)).toBe(true);
  }, 300_000);

  it('F: completed job polled/reopened repeatedly → identical immutable artifact', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-immutable-f',
      sourceMatchId: 'match-f',
      userId: 'user-f',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);
    const finished = await driveToComplete(store, job.jobId, 'worker-f');
    expect(jobAuthoritativeComplete(finished)).toBe(true);
    const artifact = finalArtifactFromJob(finished);

    for (let i = 0; i < 5; i += 1) {
      const polled = finalArtifactFromJob((await store.get(job.jobId))!);
      expect(polled).toEqual(artifact);
      // Attempt reclaim of completed → null.
      const claim = await store.claim(job.jobId, `ghost-${i}`, Date.now(), 60_000);
      expect(claim).toBeNull();
    }
  }, 300_000);

  it('idempotent: same game/decision/positionHash/job cannot double-attach results', async () => {
    const snapshots = miniGameSnapshots();
    const store = new SqlSemanticsCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'db-idempotent',
      sourceMatchId: 'match-idemp',
      userId: 'user-idemp',
      snapshots,
      liveResultsByDecisionId: liveMap(snapshots),
    });
    await store.put(job);
    const finished = await driveToComplete(store, job.jobId, 'w1');

    const twin = createReviewCompletionJob({
      gameDigest: 'db-idempotent',
      sourceMatchId: 'match-idemp',
      userId: 'user-idemp',
      snapshots,
    });
    expect(twin.jobId).toBe(job.jobId);
    await store.put(twin); // must not demote complete
    expect((await store.get(job.jobId))!.status).toBe('complete');
    expect(finalArtifactFromJob((await store.get(job.jobId))!)).toEqual(
      finalArtifactFromJob(finished),
    );
  }, 300_000);
});
