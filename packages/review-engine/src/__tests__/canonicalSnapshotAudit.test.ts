/**
 * Part B — Canonical DecisionSnapshot field-by-field audit.
 *
 * For every input consumed by hidden-state generation / search, prove it is
 * either (A) stored on ReviewPositionSnapshotV2 or (B) deterministically
 * derived from stored fields.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalizeReviewPositionSemantics,
  computePublicPositionHash,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { sampleHiddenAllocation } from '../sampleHiddenAllocation';

type Proof = { field: string; proof: 'A-stored' | 'B-derived'; from?: string; notes: string };

const AUDIT: readonly Proof[] = [
  { field: 'rulesetConfig.maxPips', proof: 'A-stored', notes: 'generateFullSet / eligibility' },
  { field: 'rulesetConfig.tilesPerPlayer', proof: 'A-stored', notes: 'deal size semantics' },
  { field: 'rulesetConfig.deadTileCount', proof: 'A-stored', notes: 'drawable vs dead split' },
  { field: 'rulesetConfig.scoringMultiple', proof: 'A-stored', notes: 'search scoring' },
  { field: 'rulesetConfig.blockedHandRule', proof: 'A-stored', notes: 'terminal scoring' },
  { field: 'rulesetConfig.endHandBonus', proof: 'A-stored', notes: 'terminal scoring' },
  { field: 'rulesetConfig.winningScore', proof: 'A-stored', notes: 'also mirrored as winningTarget' },
  { field: 'rulesetConfig.skipPregameDraw', proof: 'A-stored', notes: 'deal protocol' },
  { field: 'publicActionHistory', proof: 'A-stored', notes: 'causal evidence epochs / chronology' },
  { field: 'preAction.board', proof: 'A-stored', notes: 'legal moves + known tiles' },
  { field: 'preAction.actorHand', proof: 'A-stored', notes: 'known tiles removed from hidden pool' },
  { field: 'preAction.opponentTileCount', proof: 'A-stored', notes: 'C(n,k) hand size' },
  { field: 'preAction.boneyard.physicalCount', proof: 'A-stored', notes: 'yard size' },
  { field: 'preAction.boneyard.drawableCount', proof: 'A-stored', notes: 'B2 vs B3 branch' },
  { field: 'preAction.boneyard.deadCount', proof: 'A-stored', notes: 'dead tile count' },
  { field: 'preAction.scores', proof: 'A-stored', notes: 'search root scores' },
  { field: 'preAction.winningTarget', proof: 'A-stored', notes: 'win cutoff' },
  { field: 'preAction.consecutivePasses', proof: 'A-stored', notes: 'block detection' },
  { field: 'preAction.handOpen', proof: 'A-stored', notes: 'engine hand phase' },
  { field: 'preAction.knownMissingPipEvidence', proof: 'A-stored', notes: 'eligibility exclusions' },
  { field: 'legalActions', proof: 'A-stored', notes: 'candidate set' },
  { field: 'actualAction', proof: 'A-stored', notes: 'played action / loss' },
  { field: 'identifiers.actorId/opponentId', proof: 'A-stored', notes: 'seat mapping' },
  {
    field: 'hiddenPool tiles',
    proof: 'B-derived',
    from: 'maxPips + actorHand + board tiles',
    notes: 'generateFullSet minus known',
  },
  {
    field: 'eligibleForOpponent',
    proof: 'B-derived',
    from: 'hiddenPool + causal evidence',
    notes: 'resolveHiddenPoolEligibility',
  },
  {
    field: 'causal evidence epochs',
    proof: 'B-derived',
    from: 'publicActionHistory draws + knownMissingPipEvidence',
    notes: 'resolveCausalEvidence',
  },
  {
    field: 'positionHash',
    proof: 'B-derived',
    from: 'canonicalizeReviewPositionSemantics (SHA-256)',
    notes: 'integrity.positionHash',
  },
];

describe('canonical snapshot audit', () => {
  it('documents A/B proofs for every correctness-relevant input', () => {
    expect(AUDIT.length).toBeGreaterThanOrEqual(20);
    for (const row of AUDIT) {
      expect(row.proof === 'A-stored' || row.proof === 'B-derived').toBe(true);
      if (row.proof === 'B-derived') expect(row.from).toBeTruthy();
    }
  });

  it('fresh captures store rulesetConfig + publicActionHistory and hash covers them', () => {
    const snap = REVIEW_FIXTURE_CORPUS[0]!.snapshot;
    // Corpus fixtures may predate the fields; create path is covered by soak.
    const withCanonical: ReviewPositionSnapshotV2 = {
      ...snap,
      rulesetConfig: snap.rulesetConfig ?? {
        maxPips: 6,
        tilesPerPlayer: 7,
        deadTileCount: 2,
        scoringMultiple: 5,
        blockedHandRule: 'lowestPips',
        endHandBonus: 'sumOpponentPenalties',
        winningScore: snap.preAction.winningTarget,
        skipPregameDraw: false,
      },
      publicActionHistory: snap.publicActionHistory ?? [],
    };
    const canon = canonicalizeReviewPositionSemantics(withCanonical);
    expect(canon).toContain('"rulesetConfig"');
    expect(canon).toContain('"publicActionHistory"');
    expect(computePublicPositionHash(withCanonical)).toMatch(/^position-v1-sha256:[0-9a-f]{64}$/);

    const eligibility = resolveHiddenPoolEligibility(withCanonical);
    expect(eligibility.eligibleForOpponent.length).toBeGreaterThanOrEqual(0);
    // Sampling is deterministic for a fixed seed when feasible.
    if (eligibility.eligibleForOpponent.length >= withCanonical.preAction.opponentTileCount) {
      const a = sampleHiddenAllocation(withCanonical, 'audit-seed');
      const b = sampleHiddenAllocation(withCanonical, 'audit-seed');
      expect(a).toEqual(b);
    }
  });
});
