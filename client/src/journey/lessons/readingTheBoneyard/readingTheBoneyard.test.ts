// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getCoreJourneyTileSet, getUnseenTileCountForPip } from '../../journeyCounting.ts';
import { READING_THE_BONEYARD_LESSON_DEFINITION } from './readingTheBoneyardLesson.ts';
import { READING_THE_BONEYARD_SCENARIOS } from './readingTheBoneyardScenarios.ts';
import type { ReadingTheBoneyardScenario } from './readingTheBoneyardScenarios.ts';
import { evaluateReadingTheBoneyardResponse } from './readingTheBoneyardEvaluator.ts';
import { validateReadingTheBoneyardContent } from './readingTheBoneyardValidation.ts';

// Asserts against the same real computation the evaluator itself uses,
// rather than a hand-maintained duplicate number.
function expectedCount(scenario: ReadingTheBoneyardScenario): number {
  if (scenario.interaction.kind === 'move') throw new Error('expected a counting interaction');
  return getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: scenario.interaction.targetPip });
}

describe('Reading the Boneyard', () => {
  it('validates every authored scenario and the practice/proof variant minimums', () => {
    expect(validateReadingTheBoneyardContent(READING_THE_BONEYARD_LESSON_DEFINITION)).toEqual([]);
    expect(READING_THE_BONEYARD_SCENARIOS.filter((s) => s.variantSetId === 'variants:reading-the-boneyard-practice')).toHaveLength(3);
    expect(READING_THE_BONEYARD_SCENARIOS.filter((s) => s.variantSetId === 'variants:reading-the-boneyard-proof')).toHaveLength(2);
  });

  it('scores a correct unseen-count prediction as completed', () => {
    const scenario = READING_THE_BONEYARD_SCENARIOS.find((entry) => entry.id === 'scenario:boneyard-demo')!;
    const result = evaluateReadingTheBoneyardResponse(scenario, { kind: 'pip_count', predictedUnseenCount: expectedCount(scenario) });
    expect(result.result).toBe('completed');
  });

  it('scores an incorrect unseen-count prediction as failed', () => {
    const scenario = READING_THE_BONEYARD_SCENARIOS.find((entry) => entry.id === 'scenario:boneyard-demo')!;
    const result = evaluateReadingTheBoneyardResponse(scenario, { kind: 'pip_count', predictedUnseenCount: expectedCount(scenario) + 1 });
    expect(result.result).toBe('failed');
  });

  it('passes a proof scenario when the count is right and the accepted (safer) move is chosen', () => {
    const scenario = READING_THE_BONEYARD_SCENARIOS.find((entry) => entry.id === 'scenario:boneyard-proof-1')!;
    const result = evaluateReadingTheBoneyardResponse(scenario, {
      kind: 'pip_count_then_move',
      predictedUnseenCount: expectedCount(scenario),
      action: scenario.acceptedActions[0],
    });
    expect(result.result).toBe('passed');
  });

  it('fails a proof scenario when the accepted move is chosen but the count is wrong', () => {
    const scenario = READING_THE_BONEYARD_SCENARIOS.find((entry) => entry.id === 'scenario:boneyard-proof-1')!;
    const result = evaluateReadingTheBoneyardResponse(scenario, {
      kind: 'pip_count_then_move',
      predictedUnseenCount: expectedCount(scenario) + 1,
      action: scenario.acceptedActions[0],
    });
    expect(result.result).toBe('failed');
  });

  it('fails a proof scenario when the count is right but the dangerous (tempting) move is chosen', () => {
    const scenario = READING_THE_BONEYARD_SCENARIOS.find((entry) => entry.id === 'scenario:boneyard-proof-1')!;
    const result = evaluateReadingTheBoneyardResponse(scenario, {
      kind: 'pip_count_then_move',
      predictedUnseenCount: expectedCount(scenario),
      action: scenario.temptingActions[0],
    });
    expect(result.result).toBe('failed');
  });

  it('rejects an illegal authored move before controller submission', () => {
    const scenario = READING_THE_BONEYARD_SCENARIOS.find((entry) => entry.id === 'scenario:boneyard-proof-1')!;
    const result = evaluateReadingTheBoneyardResponse(scenario, {
      kind: 'pip_count_then_move',
      predictedUnseenCount: expectedCount(scenario),
      action: { tile: { low: 6, high: 6 }, position: 'left' },
    });
    expect(result.kind).toBe('illegal');
  });
});
