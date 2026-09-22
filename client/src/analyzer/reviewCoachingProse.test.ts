import { describe, expect, it } from 'vitest';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import type { ReviewAction } from '@racehorse/game-core/review';
import type { PlacementPosition } from '@racehorse/game-core/types';
import { buildReviewCoachingProse } from './reviewCoachingProse';

function play(low: number, high: number, position: PlacementPosition = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position };
}

function facts(overrides: Partial<ReviewCoachingFacts>): ReviewCoachingFacts {
  return {
    played: { action: play(0, 1), immediatePoints: 0 },
    best: { action: play(0, 1), immediatePoints: 0 },
    missKind: 'correct',
    deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
    evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' },
    principalVariation: [],
    referenceSource: 'oracle',
    agreement: { oracleVsFritz: 'not-computed', playedMatch: 'oracle', contested: false },
    ...overrides,
  };
}

/** All numbers that appear in the prose, excluding tile-identity digit pairs like "2-6". */
function numbersInProse(prose: { headline: string; detail: string; takeaway: string }): number[] {
  const text = `${prose.headline} ${prose.detail} ${prose.takeaway}`;
  const withoutTilePairs = text.replace(/\b\d+-\d+\b/g, '');
  const matches = withoutTilePairs.match(/\d+(\.\d+)?/g) ?? [];
  return matches.map(Number);
}

function realNumbersOnFacts(f: ReviewCoachingFacts): number[] {
  const values = [
    f.played.immediatePoints,
    f.best.immediatePoints,
    f.deltas.immediatePoints,
    f.deltas.expectedPointDifferential,
    ...(f.deltas.referenceExpectedPointDifferential === undefined ? [] : [f.deltas.referenceExpectedPointDifferential]),
  ];
  if (f.deltas.winProbability !== undefined) values.push(f.deltas.winProbability);
  // Every value is also checked as its rounded-to-1-decimal, abs'd form,
  // matching formatNumber's own rounding in reviewCoachingProse.ts.
  const rounded = values.map((v) => Math.round(Math.abs(v) * 10) / 10);
  return [...values.map(Math.abs), ...rounded];
}

describe('buildReviewCoachingProse -- one distinct case per missKind', () => {
  it('correct: praise-path prose, not silence and not a flat "good job"', () => {
    const f = facts({
      missKind: 'correct',
      played: { action: play(5, 6), immediatePoints: 15 },
      best: { action: play(5, 6), immediatePoints: 15 },
    });
    const prose = buildReviewCoachingProse(f);
    expect(prose.headline.length).toBeGreaterThan(0);
    expect(prose.detail.length).toBeGreaterThan(0);
    expect(prose.takeaway.length).toBeGreaterThan(0);
    expect(prose.detail.toLowerCase()).not.toBe('good job.');
    expect(prose.detail).toMatch(/5-6/);
    expect(prose.detail).toMatch(/15/);
  });

  it('correct: a non-scoring positional pick gets different prose than a scoring one', () => {
    const scoring = buildReviewCoachingProse(
      facts({ missKind: 'correct', played: { action: play(5, 6), immediatePoints: 15 }, best: { action: play(5, 6), immediatePoints: 15 } }),
    );
    const positional = buildReviewCoachingProse(
      facts({ missKind: 'correct', played: { action: play(1, 2), immediatePoints: 0 }, best: { action: play(1, 2), immediatePoints: 0 } }),
    );
    expect(scoring.headline).not.toBe(positional.headline);
  });

  it('same_tile_wrong_end: no tile-blame language', () => {
    const f = facts({
      missKind: 'same_tile_wrong_end',
      played: { action: play(2, 2, 'right'), immediatePoints: 0 },
      best: { action: play(2, 2, 'left'), immediatePoints: 5 },
      deltas: { immediatePoints: 5, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
    });
    const prose = buildReviewCoachingProse(f);
    const combined = `${prose.headline} ${prose.detail} ${prose.takeaway}`.toLowerCase();
    expect(combined).not.toMatch(/should have played/);
    expect(combined).not.toMatch(/wrong tile/);
    expect(combined).toMatch(/2-2/);
    expect(prose.headline).toMatch(/Right tile, wrong end/i);
  });

  it('missed_score: direct, points-focused', () => {
    const f = facts({
      missKind: 'missed_score',
      played: { action: play(0, 1), immediatePoints: 0 },
      best: { action: play(5, 6), immediatePoints: 20 },
      deltas: { immediatePoints: 20, expectedPointDifferential: 20, referenceExpectedPointDifferential: 20 },
    });
    const prose = buildReviewCoachingProse(f);
    expect(prose.headline).toMatch(/20/);
    expect(prose.detail).toMatch(/20/);
    expect(prose.detail).toMatch(/0/);
  });

  it('reply_risk: explains the downstream mechanism using only real deltas', () => {
    const f = facts({
      missKind: 'reply_risk',
      played: { action: play(0, 1), immediatePoints: 10 },
      best: { action: play(5, 6), immediatePoints: 10 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 20, referenceExpectedPointDifferential: 20 },
    });
    const prose = buildReviewCoachingProse(f);
    expect(prose.detail).toMatch(/20/);
    expect(prose.detail.toLowerCase()).toMatch(/rest of the hand|downstream|afterward/);
  });

  it('better_tile: acknowledges a closer/diffuse call, does not overstate certainty', () => {
    const f = facts({
      missKind: 'better_tile',
      played: { action: play(0, 1), immediatePoints: 0 },
      best: { action: play(5, 6), immediatePoints: 10 },
      deltas: { immediatePoints: 10, expectedPointDifferential: 20, referenceExpectedPointDifferential: 20 },
    });
    const prose = buildReviewCoachingProse(f);
    const combined = `${prose.headline} ${prose.detail}`.toLowerCase();
    expect(combined).toMatch(/not by one clear reason|no dominant|not purely/);
  });

  it('forced: reads as neutral/informational, not corrective', () => {
    const f = facts({
      missKind: 'forced',
      played: { action: play(4, 5), immediatePoints: 0 },
      best: { action: play(4, 5), immediatePoints: 0 },
    });
    const prose = buildReviewCoachingProse(f);
    const combined = `${prose.headline} ${prose.detail} ${prose.takeaway}`.toLowerCase();
    expect(combined).not.toMatch(/mistake|should have|wrong|missed/);
    expect(combined).toMatch(/only legal/);
  });

  it('pass_or_draw: explains the legality mismatch plainly', () => {
    const f = facts({
      missKind: 'pass_or_draw',
      played: { action: play(3, 4), immediatePoints: 0 },
      best: { action: { kind: 'draw' }, immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 8, referenceExpectedPointDifferential: 8 },
    });
    const prose = buildReviewCoachingProse(f);
    expect(prose.detail.toLowerCase()).toMatch(/draw/);
    expect(prose.detail).toMatch(/8/);
  });

  it('unknown (precise tier, data-inconsistent): stays honest about the uncertainty, never fabricates a confident explanation', () => {
    const f = facts({ missKind: 'unknown', evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' } });
    const prose = buildReviewCoachingProse(f);
    const combined = `${prose.headline} ${prose.detail} ${prose.takeaway}`.toLowerCase();
    expect(combined).toMatch(/don't add up|review-data gap|not every move/);
    expect(combined).not.toMatch(/clearly|definitely|certainly/);
  });

  it('unknown (heuristic tier): a distinct, honest message, not the same sentence as the precise-tier case', () => {
    const f = facts({ missKind: 'unknown', evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' } });
    const prose = buildReviewCoachingProse(f);
    const combined = `${prose.headline} ${prose.detail} ${prose.takeaway}`.toLowerCase();
    expect(combined).toMatch(/too early|resolved detail|not every move/);
    expect(combined).not.toMatch(/clearly|definitely|certainly/);

    const preciseTierProse = buildReviewCoachingProse(
      facts({ missKind: 'unknown', evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' } }),
    );
    expect(prose.headline).not.toBe(preciseTierProse.headline);
    expect(prose.detail).not.toBe(preciseTierProse.detail);
  });
});

describe('buildReviewCoachingProse -- truth test: every number in prose traces back to a real structured field', () => {
  const cases: Array<[string, ReviewCoachingFacts]> = [
    [
      'correct (scoring)',
      facts({ missKind: 'correct', played: { action: play(5, 6), immediatePoints: 15 }, best: { action: play(5, 6), immediatePoints: 15 } }),
    ],
    [
      'correct (positional)',
      facts({ missKind: 'correct', played: { action: play(1, 2), immediatePoints: 0 }, best: { action: play(1, 2), immediatePoints: 0 } }),
    ],
    [
      'correct (non-play)',
      facts({ missKind: 'correct', played: { action: { kind: 'pass' }, immediatePoints: 0 }, best: { action: { kind: 'pass' }, immediatePoints: 0 } }),
    ],
    ['forced', facts({ missKind: 'forced', played: { action: play(4, 5), immediatePoints: 0 }, best: { action: play(4, 5), immediatePoints: 0 } })],
    [
      'same_tile_wrong_end',
      facts({
        missKind: 'same_tile_wrong_end',
        played: { action: play(2, 2, 'right'), immediatePoints: 0 },
        best: { action: play(2, 2, 'left'), immediatePoints: 5 },
        deltas: { immediatePoints: 5, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      }),
    ],
    [
      'missed_score',
      facts({
        missKind: 'missed_score',
        played: { action: play(0, 1), immediatePoints: 0 },
        best: { action: play(5, 6), immediatePoints: 20 },
        deltas: { immediatePoints: 20, expectedPointDifferential: 20, referenceExpectedPointDifferential: 20 },
      }),
    ],
    [
      'reply_risk',
      facts({
        missKind: 'reply_risk',
        played: { action: play(0, 1), immediatePoints: 10 },
        best: { action: play(5, 6), immediatePoints: 10 },
        deltas: { immediatePoints: 0, expectedPointDifferential: 20, referenceExpectedPointDifferential: 20 },
      }),
    ],
    [
      'better_tile',
      facts({
        missKind: 'better_tile',
        played: { action: play(0, 1), immediatePoints: 0 },
        best: { action: play(5, 6), immediatePoints: 10 },
        deltas: { immediatePoints: 10, expectedPointDifferential: 20, referenceExpectedPointDifferential: 20 },
      }),
    ],
    [
      'pass_or_draw',
      facts({
        missKind: 'pass_or_draw',
        played: { action: play(3, 4), immediatePoints: 0 },
        best: { action: { kind: 'draw' }, immediatePoints: 0 },
        deltas: { immediatePoints: 0, expectedPointDifferential: 8, referenceExpectedPointDifferential: 8 },
      }),
    ],
    ['unknown (precise tier)', facts({ missKind: 'unknown', evidence: { source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' } })],
    ['unknown (heuristic tier)', facts({ missKind: 'unknown', evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' } })],
  ];

  it.each(cases)('%s: no fabricated numbers', (_label, f) => {
    const prose = buildReviewCoachingProse(f);
    const proseNumbers = numbersInProse(prose);
    const realNumbers = realNumbersOnFacts(f);
    for (const n of proseNumbers) {
      expect(realNumbers.some((real) => Math.abs(real - n) < 0.05)).toBe(true);
    }
  });
});

describe('buildReviewCoachingProse -- refuses unsupported certainty without a numeric delta', () => {
  const unavailableFritzFacts = (missKind: ReviewCoachingFacts['missKind']): ReviewCoachingFacts => facts({
    missKind,
    referenceSource: 'fritz',
    evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
    played: { action: play(0, 1), immediatePoints: 0 },
    best: { action: play(5, 6), immediatePoints: 0 },
    deltas: { immediatePoints: 0, expectedPointDifferential: 7 },
  });

  it.each(['reply_risk', 'better_tile'] as const)('%s preserves unavailable reference value instead of rendering zero', missKind => {
    const prose = buildReviewCoachingProse(unavailableFritzFacts(missKind));
    const text = `${prose.headline} ${prose.detail} ${prose.takeaway}`;
    expect(text).not.toMatch(/0 points|worth about 0|even overall/i);
    expect(text).not.toContain("Fritz's read is worth");
    expect(text).toContain('Too early in the review to say for sure.');
  });

  it('does not treat unavailable Fritz value as zero, equality, or a sub-material gap', () => {
    const prose = buildReviewCoachingProse(unavailableFritzFacts('reply_risk'));
    expect(prose.headline).not.toContain('No meaningful positional difference');
    expect(`${prose.headline} ${prose.detail}`).not.toMatch(/0 points|equal|even overall|about 0/i);
  });

  it('still allows directly supported immediate-score prose when Fritz value is unavailable', () => {
    const prose = buildReviewCoachingProse({
      ...unavailableFritzFacts('same_tile_wrong_end'),
      deltas: { immediatePoints: 2, expectedPointDifferential: 7 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toContain('scores 2 more points immediately');
  });

  it('still allows feature-backed Fritz prose when Fritz value is unavailable', () => {
    const prose = buildReviewCoachingProse({
      ...unavailableFritzFacts('same_tile_wrong_end'),
      featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 }],
    }, true);
    expect(`${prose.headline} ${prose.detail}`).toMatch(/Fritz|Right tile, wrong end/i);
    expect(`${prose.headline} ${prose.detail}`).toMatch(/follow-up tiles|Play it at/i);
    expect(`${prose.headline} ${prose.detail}`).not.toMatch(/biggest gap|rates better on/i);
  });

  it('does not claim "clearly stronger" style language when best.immediatePoints is 0 (no real gap to point to)', () => {
    const f = facts({
      missKind: 'correct',
      played: { action: play(1, 2), immediatePoints: 0 },
      best: { action: play(1, 2), immediatePoints: 0 },
    });
    const prose = buildReviewCoachingProse(f);
    expect(`${prose.headline} ${prose.detail}`.toLowerCase()).not.toMatch(/clearly stronger/);
  });
});
