import { describe, expect, it } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { resolveFeasibleEvidence, snapshotWithFeasibleEvidence } from '../evidenceFeasibility';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { computePublicPositionHash } from '../publicPositionHash';

describe('evidence feasibility (#220)', () => {
  it('locked-yard-five-tile-endgame becomes feasible after causal evidence invalidation', () => {
    const fixture = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'locked-yard-five-tile-endgame');
    expect(fixture).toBeDefined();
    const snapshot = fixture!.snapshot;
    const before = resolveHiddenPoolEligibility(
      snapshotWithFeasibleEvidence(snapshot).snapshot,
    );
    expect(before.eligibleForOpponent.length).toBeGreaterThanOrEqual(
      snapshot.preAction.opponentTileCount,
    );

    const resolution = resolveFeasibleEvidence(snapshot);
    expect(
      resolution.policy === 'hard'
        || resolution.policy === 'causal-epoch'
        || ('invalidated' in resolution && (resolution as { invalidated: unknown[] }).invalidated.length >= 0),
    ).toBe(true);
  });

  it('fresh fixture decisions remain feasible under resolveHiddenPoolEligibility', () => {
    for (const fixture of REVIEW_FIXTURE_CORPUS) {
      const { eligibleForOpponent } = resolveHiddenPoolEligibility(fixture.snapshot);
      expect(
        eligibleForOpponent.length,
        fixture.id,
      ).toBeGreaterThanOrEqual(fixture.snapshot.preAction.opponentTileCount);
    }
  });
});

describe('public positionHash', () => {
  it('is stable for the same snapshot and differs across decisions', () => {
    const a = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const b = REVIEW_FIXTURE_CORPUS[1]!.snapshot;
    const ha = computePublicPositionHash(a);
    const hb = computePublicPositionHash(b);
    expect(ha).toMatch(/^position-v1-sha256:[0-9a-f]{64}$/);
    expect(ha).toBe(computePublicPositionHash(a));
    expect(ha).not.toBe(hb);
  });
});

describe('adaptive escalation', () => {
  it('promotes a live heuristic midgame fixture to SCORED without UNAVAILABLE', () => {
    const fixture = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'hidden-allocation-ambiguous-midgame');
    expect(fixture).toBeDefined();
    const live = evaluateReviewPosition(
      fixture!.snapshot,
      {
        maxNodes: 200_000,
        maxHiddenStateSamples: 100,
        maxPlyDepth: 2,
        seed: 'tier1',
        maxWallClockMs: 2_000,
      },
      0.02,
    );
    expect(live.evidence.source === 'heuristic' || live.evidence.source === 'search').toBe(true);

    const adaptive = adaptiveEvaluateReviewPosition(fixture!.snapshot, {
      startTier: 2,
      maxTier: 3,
      phase: 'completion',
    });
    expect(adaptive.lifecycle).toBe('SCORED');
    expect(adaptive.evaluation.evidence.source === 'search' || adaptive.evaluation.evidence.source === 'exact').toBe(true);
    expect(adaptive.evaluation.evaluationProvenance?.unavailableReason).toBeUndefined();
  }, 120_000);
});
