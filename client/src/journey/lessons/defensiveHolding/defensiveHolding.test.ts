// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getCoreJourneyTileSet, getUnseenTileCountForPip } from '../../journeyCounting.ts';
import { DEFENSIVE_HOLDING_LESSON_DEFINITION } from './defensiveHoldingLesson.ts';
import { DEFENSIVE_HOLDING_SCENARIOS } from './defensiveHoldingScenarios.ts';
import { evaluateDefensiveHoldingResponse } from './defensiveHoldingEvaluator.ts';
import { validateDefensiveHoldingContent } from './defensiveHoldingValidation.ts';

function otherPip(tile: { low: number; high: number }, matched: number): number {
  return tile.low === matched ? tile.high : tile.low;
}

describe('Defensive Holding', () => {
  it('validates every authored scenario and the practice/proof variant minimums', () => {
    expect(validateDefensiveHoldingContent(DEFENSIVE_HOLDING_LESSON_DEFINITION)).toEqual([]);
    expect(DEFENSIVE_HOLDING_SCENARIOS.filter((s) => s.variantSetId === 'variants:defensive-holding-practice')).toHaveLength(3);
    expect(DEFENSIVE_HOLDING_SCENARIOS.filter((s) => s.variantSetId === 'variants:defensive-holding-proof')).toHaveLength(2);
  });

  it('exposes a strictly safer (lower unseen-count) pip for the accepted action than the tempting one, for every scenario', () => {
    for (const scenario of DEFENSIVE_HOLDING_SCENARIOS) {
      const accepted = scenario.acceptedActions[0];
      const tempting = scenario.temptingActions[0];
      const acceptedMatchedEnd = accepted.position === 'left' ? scenario.board.leftEnd : scenario.board.rightEnd;
      const temptingMatchedEnd = tempting.position === 'left' ? scenario.board.leftEnd : scenario.board.rightEnd;
      const acceptedUnseen = getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: otherPip(accepted.tile, acceptedMatchedEnd) });
      const temptingUnseen = getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: otherPip(tempting.tile, temptingMatchedEnd) });
      expect(acceptedUnseen).toBeLessThan(temptingUnseen);
    }
  });

  it('passes a proof scenario when the accepted (safer) action is chosen', () => {
    const scenario = DEFENSIVE_HOLDING_SCENARIOS.find((entry) => entry.id === 'scenario:holding-proof-1')!;
    const result = evaluateDefensiveHoldingResponse(scenario, { kind: 'move', action: scenario.acceptedActions[0] });
    expect(result.result).toBe('passed');
  });

  it('fails a proof scenario when the tempting (dangerous) action is chosen', () => {
    const scenario = DEFENSIVE_HOLDING_SCENARIOS.find((entry) => entry.id === 'scenario:holding-proof-1')!;
    const result = evaluateDefensiveHoldingResponse(scenario, { kind: 'move', action: scenario.temptingActions[0] });
    expect(result.result).toBe('failed');
    expect(result.feedbackOutcomeKey).toBe('ignored_the_count');
  });

  it('rejects an illegal authored response before controller submission', () => {
    const scenario = DEFENSIVE_HOLDING_SCENARIOS.find((entry) => entry.id === 'scenario:holding-guided')!;
    const result = evaluateDefensiveHoldingResponse(scenario, { kind: 'move', action: { tile: { low: 6, high: 6 }, position: 'left' } });
    expect(result.kind).toBe('illegal');
    expect(result.result).toBeUndefined();
  });

  it('keeps demonstration steps discrete', () => {
    const demo = DEFENSIVE_HOLDING_SCENARIOS.find((entry) => entry.id === 'scenario:holding-demo')!;
    expect(demo.demonstrationSteps?.map((step) => step.id)).toEqual(['holding-demo-position', 'holding-demo-tempting', 'holding-demo-accepted']);
  });
});
