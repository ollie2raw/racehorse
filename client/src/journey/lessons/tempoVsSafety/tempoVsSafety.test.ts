// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { analyzeJourneyAuthoredMove } from '../../journeyAuthoredLessonBundle.ts';
import { TEMPO_VS_SAFETY_LESSON_DEFINITION } from './tempoVsSafetyLesson.ts';
import { TEMPO_VS_SAFETY_SCENARIOS } from './tempoVsSafetyScenarios.ts';
import { evaluateTempoVsSafetyResponse } from './tempoVsSafetyEvaluator.ts';
import { validateTempoVsSafetyContent } from './tempoVsSafetyValidation.ts';

describe('Tempo vs. Safety', () => {
  it('validates every authored scenario and the practice/proof variant minimums', () => {
    expect(validateTempoVsSafetyContent(TEMPO_VS_SAFETY_LESSON_DEFINITION)).toEqual([]);
    expect(TEMPO_VS_SAFETY_SCENARIOS.filter((s) => s.variantSetId === 'variants:tempo-vs-safety-practice')).toHaveLength(3);
    expect(TEMPO_VS_SAFETY_SCENARIOS.filter((s) => s.variantSetId === 'variants:tempo-vs-safety-proof')).toHaveLength(2);
  });

  it('confirms the tempting action scores at least as much but leaves fewer remaining legal actions, for every scenario', () => {
    for (const scenario of TEMPO_VS_SAFETY_SCENARIOS) {
      const accepted = analyzeJourneyAuthoredMove(scenario, scenario.acceptedActions[0]);
      const tempting = analyzeJourneyAuthoredMove(scenario, scenario.temptingActions[0]);
      expect(tempting.immediateScoreDelta).toBeGreaterThanOrEqual(accepted.immediateScoreDelta);
      expect(accepted.remainingLegalActionCount).toBeGreaterThan(tempting.remainingLegalActionCount);
    }
  });

  it('passes a proof scenario when the accepted (safer) action is chosen', () => {
    const scenario = TEMPO_VS_SAFETY_SCENARIOS.find((entry) => entry.id === 'scenario:tradeoff-proof-1')!;
    const result = evaluateTempoVsSafetyResponse(scenario, { kind: 'move', action: scenario.acceptedActions[0] });
    expect(result.result).toBe('passed');
  });

  it('fails a proof scenario when the tempting (scoring but stranding) action is chosen', () => {
    const scenario = TEMPO_VS_SAFETY_SCENARIOS.find((entry) => entry.id === 'scenario:tradeoff-proof-1')!;
    const result = evaluateTempoVsSafetyResponse(scenario, { kind: 'move', action: scenario.temptingActions[0] });
    expect(result.result).toBe('failed');
    expect(result.feedbackOutcomeKey).toBe('ignored_the_follow_up');
  });

  it('rejects an illegal authored response before controller submission', () => {
    const scenario = TEMPO_VS_SAFETY_SCENARIOS.find((entry) => entry.id === 'scenario:tradeoff-guided')!;
    const result = evaluateTempoVsSafetyResponse(scenario, { kind: 'move', action: { tile: { low: 6, high: 6 }, position: 'left' } });
    expect(result.kind).toBe('illegal');
    expect(result.result).toBeUndefined();
  });

  it('keeps demonstration steps discrete', () => {
    const demo = TEMPO_VS_SAFETY_SCENARIOS.find((entry) => entry.id === 'scenario:tradeoff-demo')!;
    expect(demo.demonstrationSteps?.map((step) => step.id)).toEqual(['tradeoff-demo-position', 'tradeoff-demo-tempting', 'tradeoff-demo-accepted']);
  });
});
