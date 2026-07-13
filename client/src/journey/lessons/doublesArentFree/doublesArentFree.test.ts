import { describe, expect, it } from 'vitest';
import { analyzeJourneyAuthoredMove } from '../../journeyAuthoredLessonBundle.ts';
import { DOUBLES_ARENT_FREE_LESSON_DEFINITION } from './doublesArentFreeLesson.ts';
import { DOUBLES_ARENT_FREE_SCENARIOS } from './doublesArentFreeScenarios.ts';
import { evaluateDoublesResponse } from './doublesArentFreeEvaluator.ts';
import { validateDoublesArentFreeContent } from './doublesArentFreeValidation.ts';

describe('Doubles Aren’t Free', () => {
  it('validates every authored scenario and both practice/proof answer patterns', () => {
    expect(validateDoublesArentFreeContent(DOUBLES_ARENT_FREE_LESSON_DEFINITION)).toEqual([]);
    expect(DOUBLES_ARENT_FREE_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:doubles-practice')).toHaveLength(4);
    expect(DOUBLES_ARENT_FREE_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:doubles-proof')).toHaveLength(4);
  });

  it('derives legal double and non-double consequences from the gameplay engine', () => {
    const scenario = DOUBLES_ARENT_FREE_SCENARIOS.find((entry) => entry.id === 'scenario:doubles-guided')!;
    const double = analyzeJourneyAuthoredMove(scenario, scenario.temptingActions[0]);
    const nonDouble = analyzeJourneyAuthoredMove(scenario, scenario.acceptedActions[0]);
    expect(double.legal).toBe(true);
    expect(double.playedDouble).toBe(true);
    expect(nonDouble.legal).toBe(true);
    expect(nonDouble.playedDouble).toBe(false);
    expect(nonDouble.remainingPlayableTileCount).toBeGreaterThanOrEqual(double.remainingPlayableTileCount);
  });

  it('requires a passed proof result and does not accept a generic completion', () => {
    const scenario = DOUBLES_ARENT_FREE_SCENARIOS.find((entry) => entry.id === 'scenario:doubles-proof-play-1')!;
    const passed = evaluateDoublesResponse(scenario, { kind: 'move', action: scenario.acceptedActions[0] });
    const failed = evaluateDoublesResponse(scenario, { kind: 'move', action: scenario.temptingActions[0] });
    expect(passed.result).toBe('passed');
    expect(failed.result).toBe('failed');
    expect(passed.consequence?.playedDouble).toBe(true);
    expect(passed.consequence?.handExited).toBe(false);
  });

  it('supports the opposite proof judgment: holding the double', () => {
    const scenario = DOUBLES_ARENT_FREE_SCENARIOS.find((entry) => entry.id === 'scenario:doubles-proof-hold-1')!;
    const result = evaluateDoublesResponse(scenario, { kind: 'move', action: scenario.acceptedActions[0] });
    expect(result.result).toBe('passed');
    expect(result.consequence?.playedDouble).toBe(false);
  });

  it('rejects an illegal authored response before controller submission', () => {
    const scenario = DOUBLES_ARENT_FREE_SCENARIOS.find((entry) => entry.id === 'scenario:doubles-guided')!;
    const result = evaluateDoublesResponse(scenario, { kind: 'move', action: { tile: { low: 6, high: 6 }, position: 'left' } });
    expect(result.kind).toBe('illegal');
    expect(result.result).toBeUndefined();
  });

  it('keeps demonstration steps discrete and evidence-free', () => {
    const demo = DOUBLES_ARENT_FREE_SCENARIOS.find((entry) => entry.id === 'scenario:doubles-demo')!;
    expect(demo.demonstrationSteps?.map((step) => step.id)).toEqual(['doubles-demo-position', 'doubles-demo-double', 'doubles-demo-continuation']);
    expect(demo.demonstrationSteps).toHaveLength(3);
  });
});
