// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getAccountedTilesForPip, getCoreJourneyTileSet, getTilesContainingPip, getUnseenTileCountForPip, validateKnownTiles } from '../../journeyCounting.ts';
import { COUNTING_WHATS_LEFT_LESSON_DEFINITION } from './countingWhatsLeftLesson.ts';
import { COUNTING_WHATS_LEFT_SCENARIOS } from './countingWhatsLeftScenarios.ts';
import { evaluateCountingWhatsLeftResponse } from './countingWhatsLeftEvaluator.ts';

describe('Counting What’s Left', () => {
  it('derives a double-six tile set and counts doubles once as physical tiles', () => {
    const set = getCoreJourneyTileSet();
    expect(set).toHaveLength(28);
    expect(getTilesContainingPip(set, 4)).toHaveLength(7);
    const scenario = COUNTING_WHATS_LEFT_SCENARIOS[1];
    expect(getAccountedTilesForPip({ tileSet: set, board: scenario.board, playerHand: scenario.playerHand, pip: 4 })).toHaveLength(4);
    expect(getUnseenTileCountForPip({ tileSet: set, board: scenario.board, playerHand: scenario.playerHand, pip: 4 })).toBe(3);
  });

  it('evaluates guided counts and combined count-plus-move responses honestly', () => {
    const guided = COUNTING_WHATS_LEFT_SCENARIOS.find((scenario) => scenario.kind === 'guided')!;
    expect(evaluateCountingWhatsLeftResponse(guided, { kind: 'pip_count', predictedUnseenCount: 3 }).result).toBe('completed');
    expect(evaluateCountingWhatsLeftResponse(guided, { kind: 'pip_count', predictedUnseenCount: 2 }).feedbackOutcomeKey).toBe('counted_double_twice');
    const practice = COUNTING_WHATS_LEFT_SCENARIOS.find((scenario) => scenario.id === 'scenario:counting-practice-1')!;
    const success = evaluateCountingWhatsLeftResponse(practice, { kind: 'pip_count_then_move', predictedUnseenCount: 3, action: practice.acceptedActions[0] });
    expect(success.result).toBe('completed');
    expect(success.decisionSummary).toEqual({ total: 2, correct: 2, incorrect: 0 });
    expect(evaluateCountingWhatsLeftResponse(practice, { kind: 'pip_count_then_move', predictedUnseenCount: 3, action: practice.temptingActions[0] }).result).toBe('failed');
  });

  it('requires a correct count and accepted move to pass proof', () => {
    const proof = COUNTING_WHATS_LEFT_SCENARIOS.find((scenario) => scenario.id === 'scenario:counting-proof-1')!;
    expect(evaluateCountingWhatsLeftResponse(proof, { kind: 'pip_count_then_move', predictedUnseenCount: 3, action: proof.temptingActions[0] }).result).toBe('failed');
    expect(evaluateCountingWhatsLeftResponse(proof, { kind: 'pip_count_then_move', predictedUnseenCount: 3, action: proof.acceptedActions[0] }).result).toBe('passed');
  });

  it('keeps the premium definition tied to the Open-End prerequisite', () => {
    expect(COUNTING_WHATS_LEFT_LESSON_DEFINITION.prerequisites).toEqual(['journey:ch1:open-end-discipline']);
    expect(COUNTING_WHATS_LEFT_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:counting-practice')).toHaveLength(3);
    expect(COUNTING_WHATS_LEFT_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:counting-proof')).toHaveLength(2);
  });

  it('rejects invalid pips and duplicate or out-of-set known tiles without mutating fixtures', () => {
    const scenario = COUNTING_WHATS_LEFT_SCENARIOS[1];
    const before = JSON.stringify(scenario);
    expect(() => getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: 9 })).toThrow('Invalid pip');
    expect(() => validateKnownTiles(getCoreJourneyTileSet(), scenario.board, [...scenario.playerHand, scenario.playerHand[0]])).toThrow('Duplicate physical tile');
    expect(() => validateKnownTiles(getCoreJourneyTileSet(), scenario.board, [{ low: 7, high: 7 }])).toThrow('outside the active ruleset');
    expect(JSON.stringify(scenario)).toBe(before);
  });

  it('keeps uncertainty separate from move quality and never promotes proof from a move alone', () => {
    const proof = COUNTING_WHATS_LEFT_SCENARIOS.find((scenario) => scenario.id === 'scenario:counting-proof-1')!;
    const wrongCount = evaluateCountingWhatsLeftResponse(proof, { kind: 'pip_count_then_move', predictedUnseenCount: 2, action: proof.acceptedActions[0] });
    expect(wrongCount.result).toBe('failed');
    expect(wrongCount.decisionSummary).toEqual({ total: 2, correct: 1, incorrect: 1 });
    expect(wrongCount.feedbackOutcomeKey).toBe('wrong_count_defensible_move');
  });
});
