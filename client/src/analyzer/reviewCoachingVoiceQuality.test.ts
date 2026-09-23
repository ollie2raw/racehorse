import { describe, expect, it } from 'vitest';
import type { ReviewAction } from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import { buildReviewCoachingProse } from './reviewCoachingProse';

function play(low: number, high: number, position: PlacementPosition = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position };
}

function base(overrides: Partial<ReviewCoachingFacts> = {}): ReviewCoachingFacts {
  return {
    played: { action: play(2, 4, 'left'), immediatePoints: 0 },
    best: { action: play(2, 4, 'right'), immediatePoints: 0 },
    referenceSource: 'oracle',
    missKind: 'same_tile_wrong_end',
    deltas: { immediatePoints: 0, expectedPointDifferential: 1.2, referenceExpectedPointDifferential: 1.2 },
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    principalVariation: [],
    agreement: { oracleVsFritz: 'agree', playedMatch: 'neither', contested: false },
    featureDeltas: [],
    ...overrides,
  };
}

function text(prose: { headline: string; detail: string; takeaway: string }): string {
  return `${prose.headline} ${prose.detail} ${prose.takeaway}`;
}

function numbersInProse(prose: { headline: string; detail: string; takeaway: string }): number[] {
  const withoutTiles = text(prose).replace(/\b\d+-\d+\b/g, '');
  return (withoutTiles.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function supportedNumbers(f: ReviewCoachingFacts): number[] {
  const values = [
    f.played.immediatePoints,
    f.best.immediatePoints,
    f.deltas.immediatePoints,
    f.deltas.expectedPointDifferential,
    ...(f.deltas.referenceExpectedPointDifferential === undefined
      ? []
      : [f.deltas.referenceExpectedPointDifferential]),
    ...(f.featureDeltas ?? []).flatMap((d) => [d.playedValue, d.referenceValue, d.delta]),
  ];
  const rounded = values.map((v) => Math.round(Math.abs(v) * 10) / 10);
  return [...values.map(Math.abs), ...rounded];
}

describe('coaching voice quality — truth-preserving regressions', () => {
  it('1. played === reference → affirmative copy', () => {
    const f = base({
      missKind: 'correct',
      played: { action: play(5, 5, 'left'), immediatePoints: 3 },
      best: { action: play(5, 5, 'left'), immediatePoints: 3 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    });
    const prose = buildReviewCoachingProse(f, true);
    expect(prose.headline).toMatch(/Best move/i);
    expect(text(prose)).toMatch(/5-5/);
    expect(text(prose)).toMatch(/3/);
    expect(text(prose)).not.toMatch(/wrong end|wrong branch/i);
  });

  it('2. true equality + same_tile_wrong_end → equality wins; no “wrong”', () => {
    const prose = buildReviewCoachingProse(base({
      missKind: 'same_tile_wrong_end',
      played: { action: play(2, 4, 'branch-2-1' as PlacementPosition), immediatePoints: 0 },
      best: { action: play(2, 4, 'branch-0-1' as PlacementPosition), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      // Features that would otherwise tempt "wrong end" copy:
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 2, referenceValue: 1, delta: -1 },
      ],
    }), true);
    expect(prose.headline).toBe('The review rates these two moves even overall.');
    expect(text(prose)).not.toMatch(/\bwrong\b/i);
    expect(text(prose)).not.toMatch(/Play it at/i);
  });

  it('3. positive value gap + no feature reason → value-gap copy', () => {
    const prose = buildReviewCoachingProse(base({
      missKind: 'better_tile',
      played: { action: play(2, 3, 'right'), immediatePoints: 0 },
      best: { action: play(4, 4, 'left'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2.8, referenceExpectedPointDifferential: 2.8 },
      featureDeltas: [],
    }), true);
    expect(prose.headline).toMatch(/Review Engine prefers 4-4 .* 2\.8 points overall/);
    expect(text(prose)).not.toMatch(/even overall|equal/i);
    expect(text(prose)).toMatch(/reliable single positional reason/i);
  });

  it('4. search contested → Review Engine primary', () => {
    const prose = buildReviewCoachingProse(base({
      referenceSource: 'oracle',
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      fritzMove: { action: play(5, 6, 'left'), immediatePoints: 0, isMinimaxEndgame: false },
      featureDeltas: [
        { feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 },
      ],
    }), true);
    expect(text(prose)).toMatch(/Review Engine prefers/);
    expect(text(prose)).toMatch(/Fritz prefers/);
    expect(prose.headline).not.toContain("Fritz's read");
  });

  it('5. heuristic contested → Fritz primary without unsupported objective imperative', () => {
    const prose = buildReviewCoachingProse(base({
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      best: { action: play(3, 6, 'right'), immediatePoints: 3 },
      played: { action: play(3, 6, 'left'), immediatePoints: 3 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      oracleMove: { action: play(3, 6, 'left'), immediatePoints: 3 },
      featureDeltas: [],
    }), true);
    expect(prose.headline).toBe('The engines disagree here.');
    expect(text(prose)).toMatch(/Fritz prefers/);
    expect(text(prose)).toMatch(/Review Engine's heuristic prefers/);
    expect(text(prose)).not.toMatch(/Play it at/i);
    expect(text(prose)).not.toMatch(/\bclose\b|\bnearly equal\b|\bbasically even\b/i);
    expect(text(prose)).not.toMatch(/\bobjectively\b/i);
  });

  it('6. feature facts opposing heuristic primary cannot be presented as support for it', () => {
    // Played/right wins outs (lower outs); Fritz displays left. Opposing features
    // must not be narrated as Fritz's rationale.
    const prose = buildReviewCoachingProse(base({
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      played: { action: play(0, 2, 'right'), immediatePoints: 0 },
      best: { action: play(0, 2, 'left'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      oracleMove: { action: play(0, 2, 'right'), immediatePoints: 0 },
      featureDeltas: [
        // delta > 0 with higherIsBetter:false → reference (Fritz/left) is WORSE on outs
        { feature: 'opponentOutsLeft', playedValue: 1, referenceValue: 3, delta: 2 },
      ],
    }), true);
    expect(prose.headline).toBe('The engines disagree here.');
    expect(text(prose)).toMatch(/Fritz prefers/);
    expect(text(prose)).toMatch(/measured positional features favor the right end/i);
    expect(text(prose)).toMatch(/Fritz prefers the left end/i);
    expect(text(prose)).not.toMatch(/displayed reference/i);
    expect(text(prose)).not.toMatch(/Fritz's placement leaves your opponent only/i);
    expect(text(prose)).not.toMatch(/Play it at/i);
    expect(text(prose)).not.toMatch(/\bclose\b|\bnearly equal\b|\bbasically even\b/i);
  });

  it('7. candidate-specific feature WHY identifies the candidate unambiguously', () => {
    const prose = buildReviewCoachingProse(base({
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      played: { action: play(3, 6, 'branch-1-0' as PlacementPosition), immediatePoints: 0 },
      best: { action: play(3, 6, 'right'), immediatePoints: 0 },
      fritzMove: { action: play(2, 3, 'right'), immediatePoints: 0, isMinimaxEndgame: false },
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 5, referenceValue: 3, delta: -2 },
      ],
    }), true);
    expect(text(prose)).toMatch(/Review Engine prefers 3-6/);
    expect(text(prose)).toMatch(/Fritz prefers 2-3/);
    expect(text(prose)).toMatch(/The (?:3-6 line|right-end placement) leaves your opponent only 3 matching replies instead of 5/);
    expect(text(prose)).not.toMatch(/That line /);
  });

  it('8. branch-vs-branch prose does not pretend generic “a branch end” distinguishes them', () => {
    const prose = buildReviewCoachingProse(base({
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      played: { action: play(3, 4, 'branch-0-0' as PlacementPosition), immediatePoints: 0 },
      best: { action: play(3, 4, 'branch-1-0' as PlacementPosition), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 0.6, referenceExpectedPointDifferential: 0.6 },
      fritzMove: { action: play(3, 4, 'left'), immediatePoints: 0, isMinimaxEndgame: false },
      featureDeltas: [],
    }), true);
    expect(prose.headline).toMatch(/Right tile, wrong branch/i);
    expect(text(prose)).toMatch(/other branch/i);
    expect(text(prose)).not.toMatch(/prefers 3-4 at a branch end/i);
    expect(text(prose)).not.toMatch(/branch-0-0|branch-1-0/);
  });

  it('9. same-tile different-placement value headline identifies placement, not merely tile', () => {
    const prose = buildReviewCoachingProse(base({
      missKind: 'same_tile_wrong_end',
      played: { action: play(1, 5, 'branch-1-0' as PlacementPosition), immediatePoints: 0 },
      best: { action: play(1, 5, 'right'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 1.4, referenceExpectedPointDifferential: 1.4 },
      featureDeltas: [],
    }), true);
    expect(prose.headline).toMatch(/prefers the right end by about 1\.4 points overall/);
    expect(prose.headline).not.toMatch(/prefers 1-5 here/);
    expect(text(prose)).toMatch(/reliable single positional reason/i);
  });

  it('10. no arbitrary feature score leakage', () => {
    const prose = buildReviewCoachingProse(base({
      featureDeltas: [
        { feature: 'endControlScore', playedValue: -36, referenceValue: -24, delta: 12 },
        { feature: 'endDangerPenalty', playedValue: 32, referenceValue: 20, delta: -12 },
      ],
    }), true);
    const combined = text(prose);
    expect(combined).not.toMatch(/end control|by 12|exposure to an immediate reply|rates better on|biggest gap/i);
    expect(combined).not.toContain('-36');
    expect(combined).toMatch(/control of the open ends|fewer easy replies/i);
  });

  it('11. every number in rendered prose exists in structured facts', () => {
    const cases: ReviewCoachingFacts[] = [
      base({
        missKind: 'correct',
        played: { action: play(5, 5), immediatePoints: 3 },
        best: { action: play(5, 5), immediatePoints: 3 },
        deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      }),
      base({
        featureDeltas: [{ feature: 'opponentOutsLeft', playedValue: 2, referenceValue: 1, delta: -1 }],
      }),
      base({
        deltas: { immediatePoints: 0, expectedPointDifferential: 2.8, referenceExpectedPointDifferential: 2.8 },
        featureDeltas: [],
      }),
      base({
        agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
        fritzMove: { action: play(0, 1), immediatePoints: 0, isMinimaxEndgame: false },
        featureDeltas: [{ feature: 'endControlScore', playedValue: 1, referenceValue: 13, delta: 12 }],
      }),
    ];
    for (const f of cases) {
      const prose = buildReviewCoachingProse(f, true);
      const real = supportedNumbers(f);
      for (const n of numbersInProse(prose)) {
        expect(real.some((r) => Math.abs(r - n) < 0.05)).toBe(true);
      }
    }
  });

  it('12. no Fritz numeric rating appears in coaching prose', () => {
    const prose = buildReviewCoachingProse(base({
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'fritz', contested: true },
      oracleMove: { action: play(1, 2), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 }],
    }), true);
    expect(text(prose)).not.toMatch(/Fritz.*\b(rating|Elo|Glicko|2200|2400)\b/i);
    expect(text(prose)).not.toMatch(/\brated\b/i);
  });

  it('outs + danger does not emit redundant “easy replies” after outs counts', () => {
    const prose = buildReviewCoachingProse(base({
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 2, referenceValue: 1, delta: -1 },
        { feature: 'endDangerPenalty', playedValue: 5, referenceValue: 4, delta: -1 },
      ],
    }), true);
    expect(prose.detail).toMatch(/only 1 matching reply instead of 2/);
    expect(prose.detail).not.toMatch(/matching reply.*fewer easy replies/i);
  });
});
