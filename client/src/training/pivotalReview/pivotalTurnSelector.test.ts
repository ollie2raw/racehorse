import { describe, expect, it } from 'vitest';
import { selectPivotalTurns, selectPivotalTurnsFromAnalysis } from './pivotalTurnSelector';
import { matchFixture } from './pivotalReviewTestFixtures';

describe('oracle pivotal ranking', () => {
  it('takes strict top-N loss without an early-game reservation, then displays chronologically', () => {
    const fixture = matchFixture([1, 2, 10, 20, 15]);
    const result = selectPivotalTurnsFromAnalysis(fixture.analysis, fixture.moveLog, { ...fixture, count: 3 });
    expect(result.candidates.map((c) => c.moveNumber)).toEqual([3, 4, 5]);
    expect(result.candidates.map((c) => c.rank)).toEqual([1, 2, 3]);
  });

  it('breaks equal-loss selection ties by earlier move number, independent of input order', () => {
    const fixture = matchFixture([10, 20, 10, 10]);
    fixture.analysis.analyzedMoves.reverse();
    const result = selectPivotalTurns(fixture.moveLog, { ...fixture, count: 2 });
    expect(result.candidates.map((c) => c.moveNumber)).toEqual([1, 2]);
  });

  it('excludes opponents, heuristic, action-forced, and uncorrelated decisions', () => {
    const fixture = matchFixture([100, 90, 80, 70, 6]);
    fixture.moveLog[0].player = 'opponent';
    const heuristic = fixture.evaluationsByDecisionId.get('decision-2')!;
    fixture.evaluationsByDecisionId.set('decision-2', { ...heuristic, evidence: { source: 'heuristic', confidence: 'low', displayLabel: 'Heuristic estimate' } });
    const forced = fixture.evaluationsByDecisionId.get('decision-3')!;
    // True one-action forced (placement-distinct). Same-tile multi-placement is NOT forced.
    fixture.evaluationsByDecisionId.set('decision-3', { ...forced, candidates: [forced.played], best: forced.played });
    fixture.decisionIdByMoveNumber.delete(4);
    const result = selectPivotalTurns(fixture.moveLog, { ...fixture });
    expect(result.candidates.map((c) => c.moveNumber)).toEqual([5]);
    expect(result.candidates[0].evaluation).toBe(fixture.evaluationsByDecisionId.get('decision-5'));
  });

  it('returns no legacy substitutes when oracle results are missing', () => {
    const fixture = matchFixture([10]);
    fixture.evaluationsByDecisionId.clear();
    expect(selectPivotalTurns(fixture.moveLog, fixture).candidates).toEqual([]);
  });
});
