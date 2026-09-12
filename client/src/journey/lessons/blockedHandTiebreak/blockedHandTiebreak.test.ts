// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { analyzeJourneyAuthoredMove } from '../../journeyAuthoredLessonBundle.ts';
import { BLOCKED_HAND_TIEBREAK_LESSON_DEFINITION } from './blockedHandTiebreakLesson.ts';
import { BLOCKED_HAND_TIEBREAK_SCENARIOS } from './blockedHandTiebreakScenarios.ts';
import { evaluateBlockedHandTiebreakResponse } from './blockedHandTiebreakEvaluator.ts';
import { validateBlockedHandTiebreakContent } from './blockedHandTiebreakValidation.ts';

describe('Reading the Blocked-Hand Tiebreak', () => {
  it('validates every authored scenario and the practice/proof variant minimums', () => {
    expect(validateBlockedHandTiebreakContent(BLOCKED_HAND_TIEBREAK_LESSON_DEFINITION)).toEqual([]);
    expect(BLOCKED_HAND_TIEBREAK_SCENARIOS.filter((s) => s.variantSetId === 'variants:blocked-hand-tiebreak-practice')).toHaveLength(3);
    expect(BLOCKED_HAND_TIEBREAK_SCENARIOS.filter((s) => s.variantSetId === 'variants:blocked-hand-tiebreak-proof')).toHaveLength(2);
  });

  it('derives a strictly lower remaining pip total for the accepted action than the tempting one, for every scenario', () => {
    for (const scenario of BLOCKED_HAND_TIEBREAK_SCENARIOS) {
      const accepted = analyzeJourneyAuthoredMove(scenario, scenario.acceptedActions[0]);
      const tempting = analyzeJourneyAuthoredMove(scenario, scenario.temptingActions[0]);
      const acceptedPips = accepted.remainingHand.reduce((sum, t) => sum + t.low + t.high, 0);
      const temptingPips = tempting.remainingHand.reduce((sum, t) => sum + t.low + t.high, 0);
      expect(acceptedPips).toBeLessThan(temptingPips);
    }
  });

  it('passes a proof scenario when the accepted (lower-pip) action is chosen', () => {
    const scenario = BLOCKED_HAND_TIEBREAK_SCENARIOS.find((entry) => entry.id === 'scenario:tiebreak-proof-1')!;
    const result = evaluateBlockedHandTiebreakResponse(scenario, { kind: 'move', action: scenario.acceptedActions[0] });
    expect(result.result).toBe('passed');
  });

  it('fails a proof scenario when the tempting (higher-pip) action is chosen', () => {
    const scenario = BLOCKED_HAND_TIEBREAK_SCENARIOS.find((entry) => entry.id === 'scenario:tiebreak-proof-1')!;
    const result = evaluateBlockedHandTiebreakResponse(scenario, { kind: 'move', action: scenario.temptingActions[0] });
    expect(result.result).toBe('failed');
    expect(result.feedbackOutcomeKey).toBe('ignored_pip_math');
  });

  it('rejects an illegal authored response before controller submission', () => {
    const scenario = BLOCKED_HAND_TIEBREAK_SCENARIOS.find((entry) => entry.id === 'scenario:tiebreak-guided')!;
    const result = evaluateBlockedHandTiebreakResponse(scenario, { kind: 'move', action: { tile: { low: 6, high: 6 }, position: 'left' } });
    expect(result.kind).toBe('illegal');
    expect(result.result).toBeUndefined();
  });

  it('keeps demonstration steps discrete', () => {
    const demo = BLOCKED_HAND_TIEBREAK_SCENARIOS.find((entry) => entry.id === 'scenario:tiebreak-demo')!;
    expect(demo.demonstrationSteps?.map((step) => step.id)).toEqual(['tiebreak-demo-position', 'tiebreak-demo-tempting', 'tiebreak-demo-accepted']);
  });
});
