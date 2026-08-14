// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { OPEN_END_DISCIPLINE_LESSON_DEFINITION } from './openEndDisciplineLesson.ts';
import { evaluateOpenEndDisciplineDecision } from './openEndDisciplineEvaluator.ts';
import { OPEN_END_DISCIPLINE_SCENARIOS, actionKey, getScenarioLegalActions } from './openEndDisciplineScenarios.ts';
import { validateOpenEndDisciplineContent } from './openEndDisciplineValidation.ts';
import { resolveOpenEndDisciplineVariant } from './openEndDisciplineVariants.ts';

describe('Open-End Discipline authored content', () => {
  it('validates the production definition and every authored scenario against the rules engine', () => {
    expect(validateOpenEndDisciplineContent(OPEN_END_DISCIPLINE_LESSON_DEFINITION)).toEqual([]);
    expect(OPEN_END_DISCIPLINE_SCENARIOS).toHaveLength(6);
    expect(new Set(OPEN_END_DISCIPLINE_SCENARIOS.map((scenario) => scenario.id)).size).toBe(6);
    expect(OPEN_END_DISCIPLINE_SCENARIOS.every((scenario) => getScenarioLegalActions(scenario).length > 0 || scenario.kind === 'demo')).toBe(true);
  });

  it('returns a failed, outcome-specific result for the guided tempting choice', () => {
    const scenario = OPEN_END_DISCIPLINE_SCENARIOS.find((entry) => entry.kind === 'guided')!;
    const action = scenario.temptingActions[0];
    const result = evaluateOpenEndDisciplineDecision({ scenario, action });
    expect(result.kind).toBe('evaluated');
    if (result.kind !== 'evaluated') return;
    expect(result.result).toBe('failed');
    expect(result.feedbackOutcomeKey).toBe('gave_opponent_flexible_reply');
    expect(result.openEndsAfter).not.toEqual(result.openEndsBefore);
  });

  it('accepts the guided action and passes the judgment exception proof', () => {
    const guided = OPEN_END_DISCIPLINE_SCENARIOS.find((entry) => entry.kind === 'guided')!;
    const guidedResult = evaluateOpenEndDisciplineDecision({ scenario: guided, action: guided.acceptedActions[0] });
    expect(guidedResult.kind).toBe('evaluated');
    if (guidedResult.kind === 'evaluated') expect(guidedResult.result).toBe('completed');

    const proof = OPEN_END_DISCIPLINE_SCENARIOS.find((entry) => entry.kind === 'proof')!;
    const proofResult = evaluateOpenEndDisciplineDecision({ scenario: proof, action: proof.acceptedActions[0] });
    expect(proofResult.kind).toBe('evaluated');
    if (proofResult.kind === 'evaluated') {
      expect(proofResult.result).toBe('passed');
      expect(proofResult.feedbackOutcomeKey).toBe('recognized_exception');
    }
    expect(actionKey(proof.acceptedActions[0])).not.toBe(actionKey(proof.temptingActions[0]));
  });

  it('selects unseen variants deterministically and reports exhaustion', () => {
    const first = resolveOpenEndDisciplineVariant({ variantSetId: 'variants:open-end-practice', previouslyUsedScenarioIds: [] });
    expect(first.kind).toBe('resolved');
    if (first.kind !== 'resolved') return;
    const second = resolveOpenEndDisciplineVariant({ variantSetId: 'variants:open-end-practice', previouslyUsedScenarioIds: [first.scenario.id] });
    expect(second.kind).toBe('resolved');
    if (second.kind !== 'resolved') return;
    expect(second.scenario.id).not.toBe(first.scenario.id);
    const all = OPEN_END_DISCIPLINE_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:open-end-practice').map((scenario) => scenario.id);
    expect(resolveOpenEndDisciplineVariant({ variantSetId: 'variants:open-end-practice', previouslyUsedScenarioIds: all })).toEqual({ kind: 'exhausted', variantSetId: 'variants:open-end-practice' });
  });
});
