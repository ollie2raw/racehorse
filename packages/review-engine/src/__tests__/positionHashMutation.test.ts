import { describe, expect, it } from 'vitest';
import {
  canonicalizeReviewPositionSemantics,
  computePublicPositionHash,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';

function mutateOneField(snapshot: ReviewPositionSnapshotV2): Array<{ label: string; snap: ReviewPositionSnapshotV2 }> {
  return [
    {
      label: 'opponentTileCount',
      snap: {
        ...snapshot,
        preAction: { ...snapshot.preAction, opponentTileCount: snapshot.preAction.opponentTileCount + 1 },
      },
    },
    {
      label: 'winningTarget',
      snap: {
        ...snapshot,
        preAction: { ...snapshot.preAction, winningTarget: snapshot.preAction.winningTarget + 5 },
        rulesetConfig: snapshot.rulesetConfig
          ? { ...snapshot.rulesetConfig, winningScore: snapshot.preAction.winningTarget + 5 }
          : undefined,
      },
    },
    {
      label: 'consecutivePasses',
      snap: {
        ...snapshot,
        preAction: { ...snapshot.preAction, consecutivePasses: snapshot.preAction.consecutivePasses + 1 },
      },
    },
    {
      label: 'evidence-pip',
      snap: {
        ...snapshot,
        preAction: {
          ...snapshot.preAction,
          knownMissingPipEvidence: [
            ...snapshot.preAction.knownMissingPipEvidence,
            {
              opponentId: snapshot.identifiers.opponentId,
              pip: 0,
              reason: 'passed_on_open_end',
              observedHandNumber: snapshot.identifiers.handNumber,
              observedSequence: 999,
              openEnds: [0],
            },
          ],
        },
      },
    },
    {
      label: 'publicActionHistory',
      snap: {
        ...snapshot,
        publicActionHistory: [
          ...(snapshot.publicActionHistory ?? []),
          {
            sequence: 1,
            actorId: snapshot.identifiers.opponentId,
            kind: 'pass',
            openEnds: [3],
          },
        ],
      },
    },
    {
      label: 'ruleset-maxPips',
      snap: {
        ...snapshot,
        rulesetConfig: {
          maxPips: 5,
          tilesPerPlayer: 7,
          deadTileCount: 2,
          scoringMultiple: 5,
          blockedHandRule: 'lowestPips',
          endHandBonus: 'sumOpponentPenalties',
          winningScore: snapshot.preAction.winningTarget,
          skipPregameDraw: false,
        },
      },
    },
  ];
}

describe('canonical position hash mutation', () => {
  it('same semantics => same hash; each correctness field change => different serialization/hash', () => {
    const base = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    const h0 = computePublicPositionHash(base);
    expect(h0).toMatch(/^position-v1-sha256:[0-9a-f]{64}$/);
    expect(computePublicPositionHash(base)).toBe(h0);
    expect(canonicalizeReviewPositionSemantics(base)).toBe(canonicalizeReviewPositionSemantics(base));

    for (const { label, snap } of mutateOneField(base)) {
      const canon = canonicalizeReviewPositionSemantics(snap);
      expect(canon, label).not.toBe(canonicalizeReviewPositionSemantics(base));
      expect(computePublicPositionHash(snap), label).not.toBe(h0);
    }
  });
});
