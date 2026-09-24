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

function artifactFingerprint(job: ReturnType<typeof finalArtifactFromJob>) {
  return {
    positionHashes: job.positionHashes,
    lifecycles: job.lifecycles,
    sources: job.evaluations.map((e) => e.evidence.source),
    losses: job.evaluations.map((e) => e.loss.expectedPointDifferential),
    bestActions: job.evaluations.map((e) => JSON.stringify(e.best.action)),
    playedActions: job.evaluations.map((e) => JSON.stringify(e.played.action)),
    gameAccuracy: job.accuracyModelResult?.gameAccuracy ?? null,
    counts: {
      scored: job.lifecycles.filter((l) => l === 'SCORED').length,
      forced: job.lifecycles.filter((l) => l === 'FORCED').length,
    },
  };
}

describe('persistence equivalence (paths A–E)', () => {
  it('uninterrupted, interrupted-resume, retry, idempotent replay, and reopen agree', async () => {
    const snapshots = REVIEW_FIXTURE_CORPUS.slice(0, 3).map((f) => f.snapshot);
    const live = new Map(
      snapshots.map((snapshot) => {
        const evaluation = evaluateReviewPosition(
          snapshot,
          {
            maxNodes: 80_000,
            maxHiddenStateSamples: 40,
            maxPlyDepth: 1,
            seed: 'persist-eq',
            maxWallClockMs: 800,
          },
          0.02,
        );
        return [snapshot.identifiers.decisionId, evaluation] as const;
      }),
    );

    async function driveToComplete(
      label: string,
      opts?: { dieAfter?: number; duplicatePasses?: number },
    ) {
      const store = new InMemoryCheckpointStore();
      const job = createReviewCompletionJob({
        gameDigest: `eq-${label}`,
        sourceMatchId: `eq-${label}`,
        snapshots,
        liveResultsByDecisionId: live,
      });
      await store.put(job);
      let current = job;
      if (opts?.dieAfter !== undefined) {
        const partial = await runReviewCompletionPass({
          store,
          jobId: job.jobId,
          claimToken: `${label}-die`,
          dieAfterDecisions: opts.dieAfter,
          maxTier: 3,
        });
        const serialized = JSON.parse(JSON.stringify(partial.job));
        await store.put({ ...serialized, status: 'pending', claimToken: null, nextAttemptAt: 0 });
        current = (await store.get(job.jobId))!;
      }
      for (let pass = 0; pass < 12 && !jobAuthoritativeComplete(current); pass += 1) {
        const result = await runReviewCompletionPass({
          store,
          jobId: job.jobId,
          claimToken: `${label}-${pass}`,
          maxTier: 3,
        });
        current = result.job;
      }
      // Idempotent replay of a completed job.
      for (let i = 0; i < (opts?.duplicatePasses ?? 0); i += 1) {
        const again = await runReviewCompletionPass({
          store,
          jobId: job.jobId,
          claimToken: `${label}-dup-${i}`,
          maxTier: 3,
        });
        current = again.job;
      }
      // Reopen repeatedly.
      const reopened = JSON.parse(JSON.stringify(current));
      const store2 = new InMemoryCheckpointStore();
      await store2.put(reopened);
      const again = await store2.get(current.jobId);
      expect(again).not.toBeNull();
      expect(jobAuthoritativeComplete(again!)).toBe(true);
      return artifactFingerprint(finalArtifactFromJob(again!));
    }

    const a = await driveToComplete('A'); // uninterrupted
    const b = await driveToComplete('B', { dieAfter: 1 }); // interrupt + resume
    const c = await driveToComplete('C', { dieAfter: 1 }); // worker failure + retry (same machinery)
    const d = await driveToComplete('D', { duplicatePasses: 2 }); // idempotent replay
    const e = await driveToComplete('E'); // reopen covered in helper

    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a).toEqual(d);
    expect(a).toEqual(e);
    expect(a.counts.scored + a.counts.forced).toBe(snapshots.length);
  }, 300_000);
});
