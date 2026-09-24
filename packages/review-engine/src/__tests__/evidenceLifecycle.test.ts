import { describe, expect, it } from 'vitest';
import { resolveCausalEvidence } from '../evidenceLifecycle';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

function withEvidence(
  base: ReviewPositionSnapshotV2,
  evidence: ReviewPositionSnapshotV2['preAction']['knownMissingPipEvidence'],
  history: NonNullable<ReviewPositionSnapshotV2['publicActionHistory']> = [],
): ReviewPositionSnapshotV2 {
  return {
    ...base,
    publicActionHistory: history,
    preAction: { ...base.preAction, knownMissingPipEvidence: evidence },
  };
}

describe('causal evidence lifecycle', () => {
  it('invalidates pass evidence after a later opponent draw', () => {
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
          openEnds: [3],
        },
        {
          opponentId,
          pip: 5,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 40,
          openEnds: [5],
        },
      ],
      [
        { sequence: 25, actorId: opponentId, kind: 'draw', openEnds: [3] },
      ],
    );
    const resolution = resolveCausalEvidence(snap);
    expect(resolution.effectiveEvidence.map((e) => e.pip)).toEqual([5]);
    expect(resolution.invalidated.some((i) => i.evidence.pip === 3)).toBe(true);
    expect(resolution.invalidated.find((i) => i.evidence.pip === 3)?.reason).toBe(
      'superseded_by_later_opponent_draw',
    );
  });

  it('treats drew_past_open_end as pre-draw-only (never hard on post-draw hand)', () => {
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
    expect(resolution.effectiveEvidence).toHaveLength(0);
    expect(resolution.invalidated[0]?.reason).toBe('pre_draw_observation_only');
  });

  it('does not drop still-valid evidence merely for feasibility', () => {
    const base = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const opponentId = base.identifiers.opponentId;
    // Pass evidence after last draw — retained even if somehow over-constrained.
    const snap = withEvidence(
      base,
      [
        {
          opponentId,
          pip: 0,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 100,
          openEnds: [0],
        },
        {
          opponentId,
          pip: 1,
          reason: 'passed_on_open_end',
          observedHandNumber: 1,
          observedSequence: 101,
          openEnds: [1],
        },
      ],
      [{ sequence: 50, actorId: opponentId, kind: 'draw', openEnds: [0] }],
    );
    const resolution = resolveCausalEvidence(snap);
    expect(resolution.effectiveEvidence).toHaveLength(2);
    // No silent drop-oldest: either hard/causal-epoch or conflict-diagnosed.
    expect(['hard', 'causal-epoch', 'conflict-diagnosed']).toContain(resolution.policy);
  });
});
