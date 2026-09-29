import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { computeGameAccuracyModel } from '../gameAccuracyModel';
import {
  createReviewCompletionJob,
  finalArtifactFromJob,
  InMemoryCheckpointStore,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
} from '../durableReviewCompletionRuntime';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

function fixtureSnapshots(count: number): ReviewPositionSnapshotV2[] {
  return Array.from({ length: count }, (_, index) => {
    const base = REVIEW_FIXTURE_CORPUS[index % REVIEW_FIXTURE_CORPUS.length]!.snapshot;
    const decisionId = `prod-shape-${index + 1}`;
    return {
      ...base,
      identifiers: { ...base.identifiers, decisionId },
    };
  });
}

function evaluationFor(snapshot: ReviewPositionSnapshotV2): ReviewEvaluationV1 {
  const evaluated = evaluateReviewPosition(snapshot, {
    maxNodes: 5_000,
    maxHiddenStateSamples: 2,
    maxPlyDepth: 1,
    seed: snapshot.identifiers.decisionId,
    maxWallClockMs: 100,
  }, 0.02);
  return { ...evaluated, snapshotId: snapshot.identifiers.decisionId };
}

describe('durable completion exact production partial shape', () => {
  it('keeps 20/53 partial work pending and only authorizes complete at exact 56/56 coverage', async () => {
    const fullSnapshots = fixtureSnapshots(56);
    const initialSnapshots = fullSnapshots.slice(0, 23);
    const baselineEvaluation = evaluationFor(fullSnapshots[0]!);
    const asDecisionEvaluation = (snapshot: ReviewPositionSnapshotV2, forced: boolean): ReviewEvaluationV1 => {
      const candidates = forced
        ? [baselineEvaluation.played]
        : [
            ...baselineEvaluation.candidates,
            { ...baselineEvaluation.best, action: { kind: 'pass' as const } },
            { ...baselineEvaluation.best, action: { kind: 'play' as const, tile: { low: 0, high: 1 }, position: 'left' as const } },
          ];
      return {
        ...baselineEvaluation,
        snapshotId: snapshot.identifiers.decisionId,
        candidates,
        evidence: forced ? baselineEvaluation.evidence : {
          source: 'search' as const,
          confidence: 'medium' as const,
          displayLabel: 'Review Engine search',
        },
        evaluationProvenance: { phase: 'completion', lifecycle: forced ? 'FORCED' : 'SCORED' },
      };
    };
    const live = new Map(initialSnapshots.map((snapshot, index) => [
      snapshot.identifiers.decisionId,
      asDecisionEvaluation(snapshot, index >= 20 && index < 23),
    ]));
    const expectedDecisionIds = fullSnapshots.map((snapshot) => snapshot.identifiers.decisionId);
    const pendingIds = expectedDecisionIds.slice(23);
    const seeded = createReviewCompletionJob({
      gameDigest: 'fresh-56-3-53-20-33',
      sourceMatchId: 'fresh-match-safe-fixture',
      userId: 'fixture-user',
      snapshots: initialSnapshots,
      expectedDecisionIds,
      captureFailures: pendingIds.map((decisionId, index) => ({
        decisionId,
        handId: `hand-${Math.floor(index / 11) + 1}`,
        sequence: index + 24,
        reason: 'fixture-unresolved-capture',
      })),
      liveResultsByDecisionId: live,
    });
    expect(seeded.captureFailures).toHaveLength(33);
    expect(seeded.captureFailures[0]).toMatchObject({ decisionId: pendingIds[0], handId: 'hand-1', sequence: 24 });
    const partial = {
      ...seeded,
      status: 'pending' as const,
      accuracyModelResult: null,
      decisions: seeded.decisions.map((decision, index) => ({
        ...decision,
        lifecycle: index < 20 ? 'SCORED' as const : index < 23 ? 'FORCED' as const : 'PENDING' as const,
        evaluation: index < 23 ? decision.evaluation : null,
      })),
    };
    expect(partial.expectedDecisionIds).toHaveLength(56);
    expect(partial.decisions.filter((decision) => decision.lifecycle === 'SCORED')).toHaveLength(20);
    expect(partial.decisions.filter((decision) => decision.lifecycle === 'FORCED')).toHaveLength(3);
    expect(partial.decisions.filter((decision) => decision.lifecycle === 'PENDING')).toHaveLength(33);
    expect(partial.decisions.filter((decision) => decision.lifecycle === 'SCORED').length / 53).toBeCloseTo(20 / 53);
    expect(partial.decisions.some((decision) => decision.lifecycle === 'UNAVAILABLE' as never)).toBe(false);
    expect(jobAuthoritativeComplete({ ...partial, status: 'complete' })).toBe(false);

    const store = new InMemoryCheckpointStore();
    await store.put(partial);
    const pass = await runReviewCompletionPass({
      store,
      jobId: partial.jobId,
      claimToken: 'coverage-regression-worker',
      maxTier: 1,
    });
    expect(pass.job.status).toBe('pending');
    expect(jobAuthoritativeComplete(pass.job)).toBe(false);
    expect(pass.job.accuracyModelResult).toBeNull();
    expect(pass.job.decisions.filter((decision) => decision.lifecycle === 'PENDING')).toHaveLength(33);
    expect(pass.job.decisions.some((decision) => decision.lifecycle === 'FAILED_FATAL')).toBe(false);
    expect(pass.job.decisions.filter((decision) => decision.lifecycle === 'FAILED_RETRYABLE')).toHaveLength(0);
    expect(pass.job.decisions.filter((decision) => decision.lifecycle === 'PENDING').every((decision) => decision.attemptCount === 1)).toBe(true);
    expect(pass.job.nextAttemptAt).toBeGreaterThan(pass.job.updatedAt);
    expect(pass.job.accuracyModelResult).toBeNull();

    const completedDecisions = fullSnapshots.map((snapshot, index) => {
      const evaluation = index < 23
        ? partial.decisions[index]!.evaluation
        : asDecisionEvaluation(snapshot, false);
      return {
        ...partial.decisions[index]!,
        lifecycle: index >= 20 && index < 23 ? 'FORCED' as const : 'SCORED' as const,
        evaluation: evaluation ? {
          ...evaluation,
          snapshotId: snapshot.identifiers.decisionId,
          evaluationProvenance: { phase: 'completion' as const, lifecycle: index >= 20 && index < 23 ? 'FORCED' as const : 'SCORED' as const },
        } : null,
      };
    });
    const complete = {
      ...pass.job,
      status: 'complete' as const,
      snapshots: fullSnapshots,
      decisions: completedDecisions,
      accuracyModelResult: computeGameAccuracyModel(completedDecisions.map((decision) => decision.evaluation!).filter(Boolean)),
    };
    expect(jobAuthoritativeComplete(complete)).toBe(true);
    expect(complete.decisions.filter((decision) => decision.lifecycle === 'SCORED')).toHaveLength(53);
    expect(complete.decisions.filter((decision) => decision.lifecycle === 'FORCED')).toHaveLength(3);
    expect(complete.decisions.some((decision) => ['PENDING', 'FAILED_RETRYABLE', 'FAILED_FATAL'].includes(decision.lifecycle))).toBe(false);
    expect(complete.decisions.filter((decision) => decision.lifecycle === 'SCORED' || decision.lifecycle === 'FORCED')).toHaveLength(56);
    expect(finalArtifactFromJob(complete).evaluations).toHaveLength(56);
    expect(complete.accuracyModelResult?.coverageFraction).toBe(1);
  });
});
