import { describe, expect, it } from 'vitest';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import { capSeverityForContestedDecision } from './reviewCoachingFacts';
import { buildReviewCoachingProse, REVIEW_POSITIONAL_EXPLANATIONS_ENABLED, VALUE_GAP_MIN_POINTS } from './reviewCoachingProse';

function facts(): ReviewCoachingFacts {
  return { played: { action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'left' }, immediatePoints: 5 },
    best: { action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'right' }, immediatePoints: 0 },
    referenceSource: 'oracle', missKind: 'same_tile_wrong_end',
    deltas: { immediatePoints: -5, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
    evidence: { source: 'search', confidence: 'medium', displayLabel: 'Review Engine search' }, principalVariation: [],
    agreement: { oracleVsFritz: 'agree', playedMatch: 'neither', contested: false },
    featureDeltas: [{ feature: 'handShapePlayableNext', playedValue: 1, referenceValue: 3, delta: 2 },
      { feature: 'handShapeOrphanCount', playedValue: 3, referenceValue: 1, delta: -2 }] };
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
    const text = Object.values(prose).join(' ').replace(/\b\d+-\d+\b/g, '');
    const supported = [f.played.immediatePoints, f.best.immediatePoints, f.deltas.immediatePoints,
      ...(f.featureDeltas ?? []).flatMap(delta => [delta.playedValue, delta.referenceValue, delta.delta])].map(Math.abs);
    for (const number of text.match(/\d+(?:\.\d+)?/g) ?? []) expect(supported).toContain(Number(number));
    expect(prose.headline).toContain('right');
    expect(prose.headline).toContain('left');
  });

  it('renders a measured value-gap fallback without inventing a positional cause', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: 0, expectedPointDifferential: 2, referenceExpectedPointDifferential: 2 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toContain('2 more points overall, including the immediate score');
    expect(prose.headline).not.toContain('No meaningful positional difference');
    expect(`${prose.detail} ${prose.takeaway}`).not.toContain('end control');
  });

  it('never attributes an oracle-loss expected value to Fritz', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      referenceSource: 'fritz',
      evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' },
      deltas: { immediatePoints: 0, expectedPointDifferential: 2 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toBe('No meaningful positional difference in the measured features.');
    expect(prose.headline).not.toContain("Fritz's read is worth about");
  });

  it('does not cite a negative immediate gap as support for the reference move', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: -1, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }, true);
    expect(prose.headline).toBe('No meaningful positional difference in the measured features.');
    expect(prose.headline).not.toContain('fewer point');
  });

  it.each([0.01, 0.22])('requires a material expected gap (%s)', expectedPointDifferential => {
    const prose = buildReviewCoachingProse({ ...facts(), deltas: { immediatePoints: 0, expectedPointDifferential, referenceExpectedPointDifferential: expectedPointDifferential }, featureDeltas: [] }, true);
    expect(prose.headline).toBe('No meaningful positional difference in the measured features.');
  });

  it.each([VALUE_GAP_MIN_POINTS, 1.43])('renders a material expected gap (%s)', expectedPointDifferential => {
    const prose = buildReviewCoachingProse({ ...facts(), deltas: { immediatePoints: 0, expectedPointDifferential, referenceExpectedPointDifferential: expectedPointDifferential }, featureDeltas: [] }, true);
    expect(prose.headline).toContain('more point');
    expect(prose.headline).not.toContain('about 0 more');
  });

  it('requires a nonnegative expected gap before citing immediate points', () => {
    const prose = buildReviewCoachingProse({ ...facts(), deltas: { immediatePoints: 1, expectedPointDifferential: -1, referenceExpectedPointDifferential: -1 }, featureDeltas: [] }, true);
    expect(prose.headline).toBe('No meaningful positional difference in the measured features.');
  });

  it('treats expected value as total value including a mixed immediate score', () => {
    const prose = buildReviewCoachingProse({ ...facts(), deltas: { immediatePoints: -2, expectedPointDifferential: 7, referenceExpectedPointDifferential: 7 }, featureDeltas: [] }, true);
    expect(prose.headline).toContain('7 more points overall, including the immediate score');
  });

  it('keeps the no-meaningful-difference prose for a genuine zero value gap', () => {
    const prose = buildReviewCoachingProse({
      ...facts(),
      deltas: { immediatePoints: 0, expectedPointDifferential: 0, referenceExpectedPointDifferential: 0 },
      featureDeltas: [],
    }, true);
    expect(prose).toEqual({
      headline: 'No meaningful positional difference in the measured features.',
      detail: '2-4 at the left end and 2-4 at the right end have no feature difference above the reporting threshold.',
      takeaway: 'The measured features do not explain a preference between these moves.',
    });
  });

  it('only cites feature values that favor the recommended move', () => {
    const f = {
      ...facts(),
      featureDeltas: [
        { feature: 'endControlScore' as const, playedValue: 2, referenceValue: 8, delta: 6 },
        { feature: 'endDangerPenalty' as const, playedValue: 9, referenceValue: 3, delta: -6 },
        // This is a large gap, but it favors the played move and must not
        // be used to explain the recommendation.
        { feature: 'handShapeMobilityScore' as const, playedValue: 9, referenceValue: 1, delta: -8 },
      ],
    };
    const prose = buildReviewCoachingProse(f, true);
    expect(prose.detail).toContain('2-4 at the right end rates better on end control');
    expect(prose.detail).toContain('2-4 at the right end rates better on exposure to an immediate reply');
    expect(prose.detail).not.toContain('2-4 at the left end rates better');
    expect(prose.detail).not.toContain('hand mobility');
  });

  it.each(['search', 'heuristic'] as const)('caps unresolved %s disagreements at Inaccuracy', tier => {
    const agreement = { oracleVsFritz: 'disagree' as const, playedMatch: 'fritz' as const, contested: true };
    expect(capSeverityForContestedDecision('Blunder', agreement, tier)).toBe('Blunder');
    expect(capSeverityForContestedDecision('Blunder', agreement, tier, true)).toBe('Inaccuracy');
    expect(capSeverityForContestedDecision('Mistake', agreement, tier, true)).toBe('Inaccuracy');
    expect(capSeverityForContestedDecision('Best', agreement, tier, true)).toBe('Best');
    expect(capSeverityForContestedDecision('Blunder', agreement, 'exact', true)).toBe('Blunder');
  });
});
