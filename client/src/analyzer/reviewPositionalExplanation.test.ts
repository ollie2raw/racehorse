import { describe, expect, it } from 'vitest';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import { capSeverityForContestedDecision } from './reviewCoachingFacts';
import { buildReviewCoachingProse, REVIEW_POSITIONAL_EXPLANATIONS_ENABLED, VALUE_GAP_MIN_POINTS } from './reviewCoachingProse';

function facts(): ReviewCoachingFacts {
  return {
    played: { action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'left' }, immediatePoints: 5 },
    best: { action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'right' }, immediatePoints: 0 },
    referenceSource: 'oracle',
    missKind: 'same_tile_wrong_end',
    // Non-zero displayed-reference gap so feature-backed / wrong-end paths are reachable.
    // True equality (gap === 0) outranks those paths by product contract.
    deltas: { immediatePoints: -5, expectedPointDifferential: 1.2, referenceExpectedPointDifferential: 1.2 },
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' },
    principalVariation: [],
    agreement: { oracleVsFritz: 'agree', playedMatch: 'neither', contested: false },
    featureDeltas: [
      { feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 },
      { feature: 'handShapeOrphanCount', playedValue: 3, referenceValue: 1, delta: -2 },
    ],
  };
}

function proseText(prose: { headline: string; detail: string; takeaway: string }): string {
  return `${prose.headline} ${prose.detail} ${prose.takeaway}`;
}

describe('default-off positional prose truth', () => {
  it('preserves the default-off ship gate', () => {
    expect(REVIEW_POSITIONAL_EXPLANATIONS_ENABLED).toBe(false);
    expect(buildReviewCoachingProse(facts())).not.toEqual(buildReviewCoachingProse(facts(), true));
  });

  it('uses only structured quantities and correctly describes a negative immediate gap', () => {
    const f = facts();
    const prose = buildReviewCoachingProse(f, true);
    expect(prose.detail).toContain('5 fewer points');
    const text = proseText(prose).replace(/\b\d+-\d+\b/g, '');
    const supported = [
      f.played.immediatePoints,
      f.best.immediatePoints,
      f.deltas.immediatePoints,
      f.deltas.expectedPointDifferential,
      f.deltas.referenceExpectedPointDifferential!,
      ...(f.featureDeltas ?? []).flatMap((delta) => [delta.playedValue, delta.referenceValue, delta.delta]),
    ].map(Math.abs);
    for (const number of text.match(/\d+(?:\.\d+)?/g) ?? []) expect(supported).toContain(Number(number));
    expect(prose.headline).toMatch(/Right tile, wrong end/i);
    expect(prose.detail).toMatch(/right end|left end/);
  });

  it('renders a measured value-gap fallback without inventing a positional cause', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: 0, expectedPointDifferential: 2, referenceExpectedPointDifferential: 2 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toMatch(/prefers .* by about 2 points overall/);
    expect(proseText(prose)).not.toMatch(/even overall|equal|no meaningful positional difference/i);
    expect(proseText(prose)).not.toContain('end control');
    expect(proseText(prose)).toMatch(/reliable single positional reason/i);
  });

  it('renders an exact displayed-reference tie, with only a structured immediate-score tradeoff', () => {
    const f = {
      ...facts(),
      played: { action: { kind: 'play' as const, tile: { low: 1, high: 2 }, position: 'left' as const }, immediatePoints: 2 },
      best: { action: { kind: 'play' as const, tile: { low: 3, high: 4 }, position: 'right' as const }, immediatePoints: 1 },
      deltas: { immediatePoints: -1, expectedPointDifferential: 7, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    };
    const prose = buildReviewCoachingProse(f, true);
    expect(prose.headline).toBe('The review rates these two moves even overall, although 3-4 at the right end scores 1 fewer point immediately.');
    expect(prose.headline).not.toContain("Fritz's read");
    expect(prose.headline).toContain(String(Math.abs(f.deltas.immediatePoints)));
  });

  it('does not invent an immediate-score clause for an exact tie with equal scoring', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      played: { action: { kind: 'play', tile: { low: 1, high: 2 }, position: 'left' }, immediatePoints: 0 },
      best: { action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'right' }, immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toBe('The review rates these two moves even overall.');
    expect(prose.headline).not.toMatch(/scores|point/);
  });

  it.each([
    ['unavailable', undefined],
    ['sub-material', VALUE_GAP_MIN_POINTS - 0.01],
  ] as const)('does not call a %s reference gap equal', (_label, referenceExpectedPointDifferential) => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      played: { action: { kind: 'play', tile: { low: 1, high: 2 }, position: 'left' }, immediatePoints: 0 },
      best: { action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'right' }, immediatePoints: 0 },
      deltas: {
        immediatePoints: 0,
        expectedPointDifferential: 0,
        ...(referenceExpectedPointDifferential === undefined ? {} : { referenceExpectedPointDifferential }),
      },
      featureDeltas: [],
    }, true);
    expect(prose.headline).not.toContain('even overall');
    expect(proseText(prose)).not.toMatch(/no feature difference above the reporting threshold/i);
  });

  it('keeps material value and feature-backed explanations ahead of equality prose', () => {
    const material = buildReviewCoachingProse({
      ...facts(),
      played: { action: { kind: 'play', tile: { low: 1, high: 2 }, position: 'left' }, immediatePoints: 0 },
      best: { action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'right' }, immediatePoints: 0 },
      deltas: { immediatePoints: 0, expectedPointDifferential: 1, referenceExpectedPointDifferential: 1 },
      featureDeltas: [],
    }, true);
    expect(material.headline).toMatch(/prefers .* by about 1 point overall/);
    const positional = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: -5, expectedPointDifferential: 1.2, referenceExpectedPointDifferential: 1.2 },
      featureDeltas: [{ feature: 'endControlScore', playedValue: 1, referenceValue: 2, delta: 1 }],
    }, true);
    expect(positional.headline).toMatch(/Right tile, wrong end|control/i);
    expect(positional.headline).not.toContain('even overall');
    expect(proseText(positional)).not.toMatch(/end control \(by|biggest gap/i);
  });

  it('never emits equality prose for identical or forced actions', () => {
    const identical = buildReviewCoachingProse({
      ...facts(),
      best: facts().played,
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }, true);
    const forced = buildReviewCoachingProse({ ...facts(), missKind: 'forced', featureDeltas: [] }, true);
    expect(identical.headline).not.toContain('even overall');
    expect(identical.headline).toMatch(/Best move/i);
    expect(forced.headline).not.toContain('even overall');
  });

  it('never attributes an oracle-loss expected value to Fritz', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).not.toContain("Fritz's read is worth about");
    expect(proseText(prose)).not.toMatch(/even overall/i);
  });

  it('states a directly measured negative immediate tradeoff only with an exact overall tie', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: -1, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toContain('even overall');
    expect(prose.headline).toContain('1 fewer point immediately');
  });

  it.each([0.01, 0.22])('requires a material expected gap (%s)', expectedPointDifferential => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: {
        immediatePoints: 0,
        expectedPointDifferential,
        referenceExpectedPointDifferential: expectedPointDifferential,
      },
      featureDeltas: [],
    }, true);
    expect(prose.headline).not.toMatch(/by about .* overall/);
    expect(proseText(prose)).not.toMatch(/even overall/i);
  });

  it.each([VALUE_GAP_MIN_POINTS, 1.43])('renders a material expected gap (%s)', expectedPointDifferential => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: {
        immediatePoints: 0,
        expectedPointDifferential,
        referenceExpectedPointDifferential: expectedPointDifferential,
      },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toMatch(/by about .+ points? overall/);
    expect(prose.headline).not.toContain('about 0 more');
  });

  it('requires a nonnegative expected gap before citing immediate points', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: 1, expectedPointDifferential: -1, referenceExpectedPointDifferential: -1 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).not.toMatch(/scores 1 more/);
    expect(proseText(prose)).not.toMatch(/even overall/i);
  });

  it('treats expected value as total value including a mixed immediate score', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: -2, expectedPointDifferential: 7, referenceExpectedPointDifferential: 7 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toMatch(/prefers .* by about 7 points overall/);
  });

  it('renders the equality fallback for a genuine displayed-reference zero value gap', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toBe('The review rates these two moves even overall.');
  });

  it('only cites feature values that favor the recommended move', () => {
    const f = {
      ...facts(),
      deltas: { immediatePoints: -5, expectedPointDifferential: 1.2, referenceExpectedPointDifferential: 1.2 },
      featureDeltas: [
        { feature: 'endControlScore' as const, playedValue: 2, referenceValue: 8, delta: 6 },
        { feature: 'endDangerPenalty' as const, playedValue: 9, referenceValue: 3, delta: -6 },
        // This is a large gap, but it favors the played move and must not
        // be used to explain the recommendation.
        { feature: 'handShapeMobilityScore' as const, playedValue: 9, referenceValue: 1, delta: -8 },
      ],
    };
    const prose = buildReviewCoachingProse(f, true);
    expect(proseText(prose)).toMatch(/control of the open ends|fewer easy replies/i);
    expect(proseText(prose)).not.toMatch(/hand mobility|rates better on|biggest gap/i);
    expect(proseText(prose)).not.toContain('by 8');
  });

  it.each(['search', 'heuristic'] as const)(
    'F1c D2: %s disagreement no longer auto-caps Mistake/Blunder at Inaccuracy',
    tier => {
      const agreement = { oracleVsFritz: 'disagree' as const, playedMatch: 'fritz' as const, contested: true };
      expect(capSeverityForContestedDecision('Blunder', agreement, tier, true)).toBe('Blunder');
      expect(capSeverityForContestedDecision('Mistake', agreement, tier, true)).toBe('Mistake');
      expect(capSeverityForContestedDecision('Best', agreement, tier, true)).toBe('Best');
      expect(capSeverityForContestedDecision('Inaccuracy', agreement, tier, true)).toBe('Inaccuracy');
      expect(capSeverityForContestedDecision('Blunder', agreement, 'exact', true)).toBe('Blunder');
      expect(capSeverityForContestedDecision('Blunder', agreement, tier)).toBe('Blunder');
    },
  );
});
