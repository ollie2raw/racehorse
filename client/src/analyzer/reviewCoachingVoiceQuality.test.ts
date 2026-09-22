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
  it('1. played === reference never compares the move to itself', () => {
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
    expect(text(prose)).not.toMatch(/and 5-5 at the left end have no feature/i);
    expect(text(prose)).not.toMatch(/no feature difference above the reporting threshold/i);
  });

  it('2. true equality uses concise equality copy', () => {
    const prose = buildReviewCoachingProse(base({
      missKind: 'better_tile',
      played: { action: play(2, 4, 'left'), immediatePoints: 0 },
      best: { action: play(3, 4, 'right'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }), true);
    expect(prose.headline).toBe('The review rates these two moves even overall.');
    expect(prose.detail).toBe('');
    expect(prose.takeaway).toBe('');
  });

  it('3. evaluated gap + no feature delta does NOT claim overall equality', () => {
    const prose = buildReviewCoachingProse(base({
      missKind: 'better_tile',
      played: { action: play(2, 3, 'right'), immediatePoints: 0 },
      best: { action: play(4, 4, 'left'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2.8, referenceExpectedPointDifferential: 2.8 },
      featureDeltas: [],
    }), true);
    expect(prose.headline).toMatch(/Review Engine prefers 4-4 .* 2\.8 points overall/);
    expect(text(prose)).not.toMatch(/even overall|no meaningful positional difference|equal/i);
    expect(text(prose)).toMatch(/don't isolate a reliable single reason/i);
  });

  it('4. same tile / wrong end leads with human-readable placement coaching', () => {
    const prose = buildReviewCoachingProse(base({
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 2, referenceValue: 1, delta: -1 },
      ],
    }), true);
    expect(prose.headline).toBe('Right tile, wrong end.');
    expect(prose.detail).toMatch(/right end|left end|branch/);
    expect(text(prose)).not.toMatch(/rates better on|biggest gap|unseen tiles matching/i);
  });

  it('5. opponent-outs translation uses understandable literal counts', () => {
    const prose = buildReviewCoachingProse(base({
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 2, referenceValue: 1, delta: -1 },
      ],
    }), true);
    expect(prose.detail).toMatch(/only 1 matching reply instead of 2/);
  });

  it('6. raw arbitrary feature scores such as end-control units never leak', () => {
    const prose = buildReviewCoachingProse(base({
      featureDeltas: [
        { feature: 'endControlScore', playedValue: -36, referenceValue: -24, delta: 12 },
        { feature: 'endDangerPenalty', playedValue: 32, referenceValue: 20, delta: -12 },
      ],
    }), true);
    const combined = text(prose);
    expect(combined).not.toMatch(/end control|by 12|exposure to an immediate reply|rates better on|biggest gap/i);
    expect(combined).not.toContain('-36');
    expect(combined).not.toContain('-24');
    expect(combined).toMatch(/control of the open ends|fewer easy replies/i);
  });

  it('7. contested disagreement is disclosed once, not redundantly', () => {
    const prose = buildReviewCoachingProse(base({
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      fritzMove: { action: play(5, 6, 'left'), immediatePoints: 0, isMinimaxEndgame: false },
      featureDeltas: [
        { feature: 'opponentOutsLeft', playedValue: 5, referenceValue: 3, delta: -2 },
      ],
    }), true);
    const combined = text(prose);
    const disagreeHits = combined.match(/engines disagree|Fritz prefers|Review Engine prefers/gi) ?? [];
    expect(combined).toMatch(/engines disagree|Right tile, wrong end/i);
    expect(combined).not.toMatch(/The engines disagree on the reference move/i);
    expect(combined.match(/so this read is contested/gi) ?? []).toHaveLength(0);
    expect(disagreeHits.length).toBeGreaterThan(0);
  });

  it('8. search contested uses Review Engine primary', () => {
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

  it('9. heuristic contested uses Fritz primary', () => {
    const prose = buildReviewCoachingProse(base({
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      best: { action: play(2, 4, 'right'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      agreement: { oracleVsFritz: 'disagree', playedMatch: 'neither', contested: true },
      oracleMove: { action: play(2, 4, 'left'), immediatePoints: 0 },
      featureDeltas: [
        { feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 },
      ],
    }), true);
    expect(prose.headline).toBe('This one is close.');
    expect(text(prose)).toMatch(/Fritz prefers/);
    expect(text(prose)).toMatch(/Review Engine's heuristic prefers/);
    expect(text(prose)).not.toMatch(/\bobjectively best\b|\bbest move\b/i);
  });

  it('10. unsupported WHY is omitted rather than invented', () => {
    const prose = buildReviewCoachingProse(base({
      missKind: 'better_tile',
      played: { action: play(1, 2, 'left'), immediatePoints: 0 },
      best: { action: play(3, 4, 'right'), immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 1.4, referenceExpectedPointDifferential: 1.4 },
      featureDeltas: [],
    }), true);
    expect(text(prose)).not.toMatch(/because|due to|trap|hub geometry|principal variation/i);
    expect(text(prose)).toMatch(/don't isolate a reliable single reason/i);
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
});
