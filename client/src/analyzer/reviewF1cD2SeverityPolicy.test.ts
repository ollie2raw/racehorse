import { describe, expect, it } from 'vitest';
import type { ReviewAction } from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import {
  F1C_D2_CONTESTED_SEVERITY_POLICY,
  capSeverityForContestedDecision,
  type ReviewAgreement,
  type ReviewCoachingFacts,
} from './reviewCoachingFacts';
import { buildReviewCoachingProse } from './reviewCoachingProse';

function play(low: number, high: number, position: PlacementPosition = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position };
}

const contestedDisagree: ReviewAgreement = {
  oracleVsFritz: 'disagree',
  playedMatch: 'neither',
  contested: true,
};

const agree: ReviewAgreement = {
  oracleVsFritz: 'agree',
  playedMatch: 'both',
  contested: false,
};

describe('F1c D2 contested severity policy', () => {
  it('encodes null severity caps for every D2-resolved tier (no automatic Inaccuracy)', () => {
    expect(F1C_D2_CONTESTED_SEVERITY_POLICY.exact.severityCap).toBeNull();
    expect(F1C_D2_CONTESTED_SEVERITY_POLICY.search.severityCap).toBeNull();
    expect(F1C_D2_CONTESTED_SEVERITY_POLICY.heuristic.severityCap).toBeNull();
  });

  // A + regression: search disagreement + Blunder survives (would have been Inaccuracy pre-F1c)
  it('A/regression: search contested Blunder stays Blunder (no Inaccuracy cap)', () => {
    expect(capSeverityForContestedDecision('Blunder', contestedDisagree, 'search', true)).toBe('Blunder');
    expect(contestedDisagree.contested).toBe(true);
  });

  // B
  it('B: search contested Mistake stays Mistake', () => {
    expect(capSeverityForContestedDecision('Mistake', contestedDisagree, 'search', true)).toBe('Mistake');
  });

  // C
  it('C: heuristic contested Blunder stays Blunder', () => {
    expect(capSeverityForContestedDecision('Blunder', contestedDisagree, 'heuristic', true)).toBe('Blunder');
    expect(contestedDisagree.contested).toBe(true);
  });

  // D
  it('D: heuristic contested Mistake stays Mistake', () => {
    expect(capSeverityForContestedDecision('Mistake', contestedDisagree, 'heuristic', true)).toBe('Mistake');
  });

  // E
  it('E: agreement leaves severity unchanged', () => {
    expect(capSeverityForContestedDecision('Blunder', agree, 'search', true)).toBe('Blunder');
    expect(capSeverityForContestedDecision('Mistake', agree, 'heuristic', true)).toBe('Mistake');
  });

  // F
  it('F: exact remains authoritative with no disagreement cap', () => {
    expect(capSeverityForContestedDecision('Blunder', contestedDisagree, 'exact', true)).toBe('Blunder');
    expect(capSeverityForContestedDecision('Mistake', contestedDisagree, 'exact', true)).toBe('Mistake');
  });

  // G — contested metadata/copy still discloses disagreement
  it('G: contested prose still discloses engine disagreement', () => {
    const searchFacts: ReviewCoachingFacts = {
      played: { action: play(2, 4, 'left'), immediatePoints: 5 },
      best: { action: play(2, 4, 'right'), immediatePoints: 0 },
      referenceSource: 'oracle',
      missKind: 'same_tile_wrong_end',
      deltas: { immediatePoints: -5, expectedPointDifferential: 3, referenceExpectedPointDifferential: 3 },
      evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
      principalVariation: [],
      agreement: contestedDisagree,
      fritzMove: {
        action: play(5, 6, 'left'),
        immediatePoints: 0,
        isMinimaxEndgame: false,
      },
      oracleMove: { action: play(2, 4, 'right'), immediatePoints: 0 },
      featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 }],
    };
    const prose = buildReviewCoachingProse(searchFacts, true);
    expect(prose.headline.startsWith('Contested:')).toBe(true);
    expect(prose.detail).toContain('so this read is contested');
    expect(prose.takeaway).toContain('engines disagree');
  });

  // H — reference/source labels
  it("H: search primary uses Review Engine terminology; heuristic primary is Fritz's read", () => {
    const searchFacts: ReviewCoachingFacts = {
      played: { action: play(0, 1), immediatePoints: 0 },
      best: { action: play(2, 3, 'right'), immediatePoints: 0 },
      referenceSource: 'oracle',
      missKind: 'same_tile_wrong_end',
      deltas: { immediatePoints: 0, expectedPointDifferential: 2, referenceExpectedPointDifferential: 2 },
      evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
      principalVariation: [],
      agreement: contestedDisagree,
      fritzMove: { action: play(5, 6), immediatePoints: 0, isMinimaxEndgame: false },
      oracleMove: { action: play(2, 3, 'right'), immediatePoints: 0 },
      featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 }],
    };
    const heuristicFacts: ReviewCoachingFacts = {
      ...searchFacts,
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      best: { action: play(5, 6), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
    };
    const searchProse = buildReviewCoachingProse(searchFacts, true);
    const heuristicProse = buildReviewCoachingProse(heuristicFacts, true);
    expect(searchFacts.evidence.displayLabel).toBe('Review Engine search');
    expect(searchProse.headline).not.toContain("Fritz's read");
    expect(heuristicProse.headline).toContain("Fritz's read");
    expect(heuristicProse.headline).not.toMatch(/\bbest\b/i);
  });

  // I — second opinions for both D2-resolved tiers
  it('I: search shows Fritz second opinion; heuristic shows Review Engine alternative', () => {
    const searchFacts: ReviewCoachingFacts = {
      played: { action: play(0, 1), immediatePoints: 0 },
      best: { action: play(2, 3, 'right'), immediatePoints: 0 },
      referenceSource: 'oracle',
      missKind: 'same_tile_wrong_end',
      deltas: { immediatePoints: 0, expectedPointDifferential: 2, referenceExpectedPointDifferential: 2 },
      evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
      principalVariation: [],
      agreement: contestedDisagree,
      fritzMove: { action: play(5, 6, 'left'), immediatePoints: 0, isMinimaxEndgame: false },
      oracleMove: { action: play(2, 3, 'right'), immediatePoints: 0 },
      featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 }],
    };
    const heuristicFacts: ReviewCoachingFacts = {
      ...searchFacts,
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      best: { action: play(5, 6, 'left'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
    };
    const searchProse = buildReviewCoachingProse(searchFacts, true);
    const heuristicProse = buildReviewCoachingProse(heuristicFacts, true);
    expect(searchProse.detail).toContain('Fritz would have played');
    expect(searchProse.detail).toContain('5-6');
    expect(heuristicProse.detail).toContain("The Review Engine's heuristic would have played");
    expect(heuristicProse.detail).toContain('2-3');
  });

  // J
  it('J: no Fritz rating appears in contested second-opinion copy', () => {
    const heuristicFacts: ReviewCoachingFacts = {
      played: { action: play(0, 1), immediatePoints: 0 },
      best: { action: play(5, 6), immediatePoints: 0 },
      referenceSource: 'fritz',
      missKind: 'same_tile_wrong_end',
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      principalVariation: [],
      agreement: contestedDisagree,
      fritzMove: { action: play(5, 6), immediatePoints: 0, isMinimaxEndgame: false },
      oracleMove: { action: play(2, 3, 'right'), immediatePoints: 0 },
      featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 }],
    };
    const text = Object.values(buildReviewCoachingProse(heuristicFacts, true)).join(' ');
    expect(text).not.toMatch(/Fritz.*\b(rating|Elo|Glicko|2200|2400)\b/i);
    expect(text).not.toMatch(/\brated\b/i);
  });
});
