import { describe, expect, it } from 'vitest';
import type { ReviewCoachingFacts } from './reviewCoachingFacts';
import { capSeverityForContestedDecision } from './reviewCoachingFacts';
import { buildReviewCoachingProse, REVIEW_POSITIONAL_EXPLANATIONS_ENABLED } from './reviewCoachingProse';

function facts(): ReviewCoachingFacts {
  return { played: { action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'left' }, immediatePoints: 5 },
    best: { action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'right' }, immediatePoints: 0 },
    referenceSource: 'oracle', missKind: 'same_tile_wrong_end',
    deltas: { immediatePoints: -5, expectedPointDifferential: 0 },
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

  it('reports no meaningful measured difference when there are no supported deltas', () => {
    expect(buildReviewCoachingProse({ ...facts(), featureDeltas: [] }, true).headline).toContain('No meaningful positional difference');
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
