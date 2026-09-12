// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { analyzeJourneyAuthoredMove } from '../../journeyAuthoredLessonBundle.ts';
import { ENDGAME_HAND_SHAPE_LESSON_DEFINITION } from './endgameHandShapeLesson.ts';
import { ENDGAME_HAND_SHAPE_SCENARIOS } from './endgameHandShapeScenarios.ts';
import { evaluateEndgameHandShapeResponse } from './endgameHandShapeEvaluator.ts';
import { validateEndgameHandShapeContent } from './endgameHandShapeValidation.ts';

describe('Endgame Hand Shape', () => {
  it('validates every authored scenario and the practice/proof variant minimums', () => {
    expect(validateEndgameHandShapeContent(ENDGAME_HAND_SHAPE_LESSON_DEFINITION)).toEqual([]);
    expect(ENDGAME_HAND_SHAPE_SCENARIOS.filter((s) => s.variantSetId === 'variants:endgame-hand-shape-practice')).toHaveLength(3);
    expect(ENDGAME_HAND_SHAPE_SCENARIOS.filter((s) => s.variantSetId === 'variants:endgame-hand-shape-proof')).toHaveLength(2);
  });

  it('derives strictly more remaining legal actions for the accepted action than the tempting one, for every scenario', () => {
    for (const scenario of ENDGAME_HAND_SHAPE_SCENARIOS) {
      const accepted = analyzeJourneyAuthoredMove(scenario, scenario.acceptedActions[0]);
      const tempting = analyzeJourneyAuthoredMove(scenario, scenario.temptingActions[0]);
      expect(accepted.remainingLegalActionCount).toBeGreaterThan(tempting.remainingLegalActionCount);
    }
  });

  it('passes a proof scenario when the accepted (hand-preserving) action is chosen', () => {
    const scenario = ENDGAME_HAND_SHAPE_SCENARIOS.find((entry) => entry.id === 'scenario:shape-proof-1')!;
    const result = evaluateEndgameHandShapeResponse(scenario, { kind: 'move', action: scenario.acceptedActions[0] });
    expect(result.result).toBe('passed');
  });

  it('fails a proof scenario when the tempting (hand-stranding) action is chosen', () => {
    const scenario = ENDGAME_HAND_SHAPE_SCENARIOS.find((entry) => entry.id === 'scenario:shape-proof-1')!;
    const result = evaluateEndgameHandShapeResponse(scenario, { kind: 'move', action: scenario.temptingActions[0] });
    expect(result.result).toBe('failed');
    expect(result.feedbackOutcomeKey).toBe('ignored_shape_math');
  });

  it('rejects an illegal authored response before controller submission', () => {
    const scenario = ENDGAME_HAND_SHAPE_SCENARIOS.find((entry) => entry.id === 'scenario:shape-guided')!;
    const result = evaluateEndgameHandShapeResponse(scenario, { kind: 'move', action: { tile: { low: 6, high: 6 }, position: 'left' } });
    expect(result.kind).toBe('illegal');
    expect(result.result).toBeUndefined();
  });

  it('keeps demonstration steps discrete', () => {
    const demo = ENDGAME_HAND_SHAPE_SCENARIOS.find((entry) => entry.id === 'scenario:shape-demo')!;
    expect(demo.demonstrationSteps?.map((step) => step.id)).toEqual(['shape-demo-position', 'shape-demo-tempting', 'shape-demo-accepted']);
  });
});
