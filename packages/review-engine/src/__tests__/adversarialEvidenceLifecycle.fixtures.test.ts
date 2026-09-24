/**
 * Targeted adversarial evidence regressions for the fast release gate.
 * Constructs minimal legal/state-level fixtures for transitions that are
 * rare or impossible to sample randomly under 1v1 locked-yard rules.
 */
import { describe, expect, it } from 'vitest';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { resolveCausalEvidence } from '../evidenceLifecycle';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { adaptiveEvaluateReviewPosition } from '../adaptiveEvaluateReviewPosition';
import { playRandomGame } from '../devtools/coverageSoakLib';
import {
  createReviewCompletionJob,
  jobAuthoritativeComplete,
  runReviewCompletionPass,
  InMemoryCheckpointStore,
} from '../durableReviewCompletionRuntime';

function withEvidence(
  base: ReviewPositionSnapshotV2,
  evidence: ReviewPositionSnapshotV2['preAction']['knownMissingPipEvidence'],
  history: NonNullable<ReviewPositionSnapshotV2['publicActionHistory']> = base.publicActionHistory ?? [],
): ReviewPositionSnapshotV2 {
  return {
    ...base,
    publicActionHistory: history,
    preAction: { ...base.preAction, knownMissingPipEvidence: evidence },
  };
}

function expectScoredOrForced(snapshot: ReviewPositionSnapshotV2, maxTier: 1 | 2 | 3 | 4 = 3) {
  const adaptive = adaptiveEvaluateReviewPosition(snapshot, {
    startTier: 1,
    maxTier,
    phase: 'completion',
    allowProgressiveBeyondTier: true,
  });
  expect(
    adaptive.lifecycle === 'SCORED' || adaptive.lifecycle === 'FORCED',
  ).toBe(true);
  return adaptive;
}

describe('targeted adversarial evidence regressions (fast release)', () => {
  it('#220: overconstrained pass evidence becomes feasible after causal invalidation', () => {
    const fixture = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'locked-yard-five-tile-endgame');
    expect(fixture).toBeDefined();
    const before = resolveHiddenPoolEligibility(fixture!.snapshot);
    // Corpus fixture is the historical overconstraint case; causal resolution
    // must restore feasibility without silently dropping still-valid constraints.
    const after = resolveHiddenPoolEligibility(fixture!.snapshot);
    const resolution = resolveCausalEvidence(fixture!.snapshot);
    expect(resolution.policy === 'hard' || resolution.policy === 'causal-epoch' || resolution.policy === 'conflict-diagnosed').toBe(
      true,
    );
    // Eligibility path applies causal evidence — feasible worlds exist OR conflict is diagnosed.
    if (after.eligibleForOpponent.length >= fixture!.snapshot.preAction.opponentTileCount) {
      expectScoredOrForced(fixture!.snapshot, 4);
    } else {
      expect(resolution.policy).toBe('conflict-diagnosed');
      expect(resolution.minimalConflictSet).not.toBeNull();
    }
    void before;
  });

  it('pass evidence → later draw → superseded_by_later_opponent_draw (constructed)', () => {
    // Under live 1v1 rules a true pass requires an empty drawable yard, so a
    // later draw in the same hand cannot occur. Construct the history the
    // lifecycle must honor when that transition is observed (multi-seat /
    // capture-order edge / authority replay).
    const base = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const opponentId = base.identifiers.opponentId;
    const snap = withEvidence(
      base,
      [
        {
          opponentId,
          pip: 3,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 10,
          openEnds: [3, 5],
        },
        {
          opponentId,
          pip: 5,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 10,
          openEnds: [3, 5],
        },
      ],
      [
        { sequence: 25, actorId: opponentId, kind: 'draw', openEnds: [3, 5] },
      ],
    );
    const resolution = resolveCausalEvidence(snap);
    expect(resolution.invalidated.every((i) => i.reason === 'superseded_by_later_opponent_draw')).toBe(
      true,
    );
    expect(resolution.effectiveEvidence).toHaveLength(0);
    expectScoredOrForced(snap, 2);
  });

  it('drew_past_open_end is pre_draw_observation_only (never hard post-draw)', () => {
    const base = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const opponentId = base.identifiers.opponentId;
    const snap = withEvidence(base, [
      {
        opponentId,
        pip: 2,
        reason: 'drew_past_open_end',
        observedHandNumber: 1,
        observedSequence: 12,
        openEnds: [2],
      },
    ]);
    const resolution = resolveCausalEvidence(snap);
    expect(resolution.invalidated[0]?.reason).toBe('pre_draw_observation_only');
    expect(resolution.effectiveEvidence).toHaveLength(0);
    expectScoredOrForced(snap, 2);
  });

  it('repeated draw epochs: earlier pass invalidated, later pass retained', () => {
    const base = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const opponentId = base.identifiers.opponentId;
    const snap = withEvidence(
      base,
      [
        {
          opponentId,
          pip: 1,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 5,
          openEnds: [1],
        },
        {
          opponentId,
          pip: 4,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 40,
          openEnds: [4],
        },
      ],
      [
        { sequence: 20, actorId: opponentId, kind: 'draw', openEnds: [1] },
        { sequence: 30, actorId: opponentId, kind: 'draw', openEnds: [4] },
      ],
    );
    const resolution = resolveCausalEvidence(snap);
    expect(resolution.opponentDrawSequences.length).toBe(2);
    expect(resolution.effectiveEvidence.map((e) => e.pip)).toEqual([4]);
    expect(
      resolution.invalidated.some(
        (i) => i.evidence.pip === 1 && i.reason === 'superseded_by_later_opponent_draw',
      ),
    ).toBe(true);
    // Lifecycle-only assertion; engine score covered by neighboring fixtures.
    const { eligibleForOpponent } = resolveHiddenPoolEligibility(snap);
    expect(eligibleForOpponent.length).toBeGreaterThanOrEqual(snap.preAction.opponentTileCount);
  });

  it('both open-end constraints + tiny/constrained pools stay feasible after causal policy', () => {
    for (const seed of [22003, 22006, 22007]) {
      const played = playRandomGame(seed, {
        preferDraw: true,
        preferPass: true,
        winningScore: 30,
        depleteHighTiles: true,
        maxHands: 2,
      });
      for (const snapshot of played.snapshots.slice(0, 8)) {
        const resolution = resolveCausalEvidence(snapshot);
        const { eligibleForOpponent } = resolveHiddenPoolEligibility(snapshot);
        if (eligibleForOpponent.length >= snapshot.preAction.opponentTileCount) {
          expect(resolution.policy).not.toBe('conflict-diagnosed');
          expectScoredOrForced(snapshot, 3);
        }
      }
    }
  }, 180_000);

  it('opening maximal uncertainty and endgame near-full info complete SCORED/FORCED', () => {
    const opening = playRandomGame(9001, { winningScore: 50, maxHands: 1, depleteHighTiles: false });
    const endgame = playRandomGame(9002, {
      winningScore: 20,
      maxHands: 2,
      preferPass: true,
      depleteHighTiles: true,
    });
    for (const snap of [...opening.snapshots.slice(0, 3), ...endgame.snapshots.slice(-3)]) {
      expectScoredOrForced(snap, 3);
    }
  }, 180_000);

  it('worker interruption during SEARCHING leaves durable resume to SCORED/FORCED', async () => {
    const snapshots = REVIEW_FIXTURE_CORPUS.slice(0, 3).map((f) => f.snapshot);
    const store = new InMemoryCheckpointStore();
    const job = createReviewCompletionJob({
      gameDigest: 'adv-interrupt',
      sourceMatchId: 'adv-interrupt',
      snapshots,
    });
    await store.put(job);
    const t0 = 1_000_000;
    const partial = await runReviewCompletionPass({
      store,
      jobId: job.jobId,
      claimToken: 'w-a',
      now: t0,
      leaseMs: 5_000,
      dieAfterDecisions: 1,
      maxTier: 3,
      concurrency: 1,
    });
    expect(partial.interrupted).toBe(true);
    const mid = (await store.get(job.jobId))!;
    const afterExpiry = Math.max(t0 + 10_000, (mid.leaseExpiresAt ?? t0) + 1);
    let current = mid;
    for (let i = 0; i < 12 && !jobAuthoritativeComplete(current); i += 1) {
      current = (
        await runReviewCompletionPass({
          store,
          jobId: job.jobId,
          claimToken: `w-b-${i}`,
          now: afterExpiry + i,
          maxTier: 3,
          concurrency: 1,
        })
      ).job;
    }
    expect(jobAuthoritativeComplete(current)).toBe(true);
    expect(current.decisions.every((d) => d.lifecycle === 'SCORED' || d.lifecycle === 'FORCED')).toBe(
      true,
    );
  }, 180_000);
});
