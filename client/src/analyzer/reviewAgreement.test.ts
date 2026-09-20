import { describe, expect, it } from 'vitest';
import type { ReviewAction } from '@racehorse/game-core/review';
import { resolveAgreement } from './reviewCoachingFacts';

const oracle: ReviewAction = { kind: 'play', tile: { low: 2, high: 5 }, position: 'left' };
const fritz: ReviewAction = { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' };
const other: ReviewAction = { kind: 'play', tile: { low: 2, high: 3 }, position: 'left' };
const opinion = (action: ReviewAction) => ({ action, immediatePoints: 0, isMinimaxEndgame: false });

describe('F2 oracle/Fritz agreement cases', () => {
  it.each([
    { name: 'engines agree and player matches both', played: oracle, recommended: oracle,
      agreement: 'agree', playedMatch: 'both', contested: false },
    { name: 'engines agree and player matches neither', played: other, recommended: oracle,
      agreement: 'agree', playedMatch: 'neither', contested: false },
    { name: 'engines disagree and player matches oracle', played: oracle, recommended: fritz,
      agreement: 'disagree', playedMatch: 'oracle', contested: true },
    { name: 'engines disagree and player matches Fritz', played: fritz, recommended: fritz,
      agreement: 'disagree', playedMatch: 'fritz', contested: true },
    { name: 'engines disagree and player matches neither', played: other, recommended: fritz,
      agreement: 'disagree', playedMatch: 'neither', contested: true },
  ])('$name', ({ played, recommended, agreement, playedMatch, contested }) => {
    expect(resolveAgreement(played, oracle, opinion(recommended))).toEqual({
      oracleVsFritz: agreement, playedMatch, contested,
    });
  });

  it('does not collapse same-tile/different-end choices into agreement', () => {
    expect(resolveAgreement(fritz, oracle, opinion(fritz))).toMatchObject({
      oracleVsFritz: 'disagree', playedMatch: 'fritz', contested: true,
    });
  });

  it('records missing Fritz evidence without fabricating agreement', () => {
    expect(resolveAgreement(oracle, oracle, null)).toEqual({
      oracleVsFritz: 'not-computed', playedMatch: 'oracle', contested: false,
    });
  });
});
