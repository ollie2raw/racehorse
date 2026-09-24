import { describe, expect, it } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import {
  createReviewCompletionJob,
  finalArtifactFromJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
} from '../durableReviewCompletionRuntime';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

describe('durable review completion resume', () => {
  it('start → partial → simulated death → recreate runtime → resume → identical artifact', async () => {
    const fixture = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'hidden-allocation-ambiguous-midgame');
    expect(fixture).toBeDefined();
    // Use several corpus snapshots as a mini "game".
    const snapshots = REVIEW_FIXTURE_CORPUS.slice(0, 4).map((f) => f.snapshot);
    const live = new Map(
      snapshots.map((snapshot) => {
        const evaluation = evaluateReviewPosition(
          snapshot,
          {
            maxNodes: 50_000,
            maxHiddenStateSamples: 20,
            maxPlyDepth: 1,
            seed: 'live-partial',
            maxWallClockMs: 500,
          },
          0.02,
        );
        return [snapshot.identifiers.decisionId, evaluation] as const;
      }),
    );

    const storeA = new InMemoryCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'digest-resume-test',
      sourceMatchId: 'match-resume-test',
      snapshots,
      liveResultsByDecisionId: live,
    });
    await storeA.put(job);

    const pass1 = await runReviewCompletionPass({
      store: storeA,
      jobId: job.jobId,
      claimToken: 'worker-a',
      dieAfterDecisions: 1,
      maxTier: 3,
    });
    expect(pass1.interrupted || !jobAuthoritativeComplete(pass1.job)).toBe(true);
    const mid = pass1.job;
    expect(mid.decisions.some((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED')).toBe(true);

    // Simulate process death: serialize + new store (new runtime).
    const serialized = JSON.parse(JSON.stringify(mid)) as typeof mid;
    const storeB = new InMemoryCheckpointStore();
    await storeB.put({ ...serialized, status: 'pending', claimToken: null, nextAttemptAt: 0 });

    // Drive to completion with bounded passes.
    let current = (await storeB.get(job.jobId))!;
    for (let pass = 0; pass < 12 && !jobAuthoritativeComplete(current); pass += 1) {
      const result = await runReviewCompletionPass({
        store: storeB,
        jobId: job.jobId,
        claimToken: `worker-b-${pass}`,
        maxTier: 3,
      });
      current = result.job;
    }
    expect(jobAuthoritativeComplete(current)).toBe(true);

    // Uninterrupted control path.
    const storeC = new InMemoryCheckpointStore();
    const controlJob = createReviewCompletionJob({
      gameDigest: 'digest-resume-control',
      sourceMatchId: 'match-resume-control',
      snapshots,
      liveResultsByDecisionId: live,
    });
    await storeC.put(controlJob);
    let control = controlJob;
    for (let pass = 0; pass < 12 && !jobAuthoritativeComplete(control); pass += 1) {
      const result = await runReviewCompletionPass({
        store: storeC,
        jobId: controlJob.jobId,
        claimToken: `worker-c-${pass}`,
        maxTier: 3,
      });
      control = result.job;
    }
    expect(jobAuthoritativeComplete(control)).toBe(true);

    const a = finalArtifactFromJob(current);
    const b = finalArtifactFromJob(control);
    expect(a.positionHashes).toEqual(b.positionHashes);
    expect(a.lifecycles).toEqual(b.lifecycles);
    expect(a.evaluations.map((e) => e.evidence.source)).toEqual(
      b.evaluations.map((e) => e.evidence.source),
    );
    expect(a.evaluations.map((e) => e.loss.expectedPointDifferential)).toEqual(
      b.evaluations.map((e) => e.loss.expectedPointDifferential),
    );
    expect(a.accuracyModelResult?.gameAccuracy).toBe(b.accuracyModelResult?.gameAccuracy);
  }, 300_000);
});
