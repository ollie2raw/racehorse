import { describe, expect, it } from 'vitest';
import {
  buildRiskFlags,
  determinePrimaryReason,
  determineSecondaryReason,
  REASON_TO_CONCEPT,
} from './reasonTagging';
import type { MoveFeatures } from './reasonTagging';

function baseFeatures(overrides: Partial<MoveFeatures> = {}): MoveFeatures {
  return {
    immediateScore: 0,
    turnContinues: false,
    remainingPlayableCount: 2,
    playerNextTurnScoringCount: 0,
    playerConstraintLevel: 'limited',
    playerEndCoverage: 1,
    opponentResponseCount: 2,
    opponentScoringResponseCount: 1,
    opponentConstraintLevel: 'limited',
    opponentForcedDefensiveCount: 0,
    opponentReturnScore: 1,
    opensEndDangerLevel: 'neutral',
    reducesScoringFlexibility: false,
    causesHandBlock: false,
    scorePosition: 'even',
    resultingOpenEnds: [3, 5],
    ...overrides,
  };
}

describe('determinePrimaryReason', () => {
  it('prioritizes immediate scoring', () => {
    expect(determinePrimaryReason(baseFeatures({ immediateScore: 2 }), 'best')).toBe('score_now');
  });

  it('flags self-blocks before generic fallbacks', () => {
    expect(
      determinePrimaryReason(baseFeatures({ causesHandBlock: true }), 'blunder'),
    ).toBe('avoid_self_block');
  });

  it('recognizes opponent restriction', () => {
    expect(
      determinePrimaryReason(
        baseFeatures({ opponentScoringResponseCount: 0, opensEndDangerLevel: 'safe' }),
        'excellent',
      ),
    ).toBe('deny_return_score');
  });
});

describe('determineSecondaryReason', () => {
  it('adds chaining context to scoring moves', () => {
    expect(
      determineSecondaryReason(
        baseFeatures({
          immediateScore: 1,
          remainingPlayableCount: 4,
          reducesScoringFlexibility: false,
        }),
        'score_now',
      ),
    ).toBe('keep_board_flexible');
  });
});

describe('buildRiskFlags', () => {
  it('flags dangerous openings and self-blocks', () => {
    const flags = buildRiskFlags(
      baseFeatures({
        opensEndDangerLevel: 'dangerous',
        causesHandBlock: true,
        opponentReturnScore: 4,
      }),
    );
    expect(flags).toContain('opens_dangerous_end');
    expect(flags).toContain('self_blocks');
    expect(flags).toContain('gives_easy_score_back');
  });

  it('uses a higher threshold when the move already scores', () => {
    const flags = buildRiskFlags(baseFeatures({ immediateScore: 1, opponentReturnScore: 1 }));
    expect(flags).not.toContain('gives_easy_score_back');
  });
});

describe('REASON_TO_CONCEPT', () => {
  it('maps every coaching reason to at least one concept tag', () => {
    for (const concepts of Object.values(REASON_TO_CONCEPT)) {
      expect(concepts.length).toBeGreaterThan(0);
    }
  });
});