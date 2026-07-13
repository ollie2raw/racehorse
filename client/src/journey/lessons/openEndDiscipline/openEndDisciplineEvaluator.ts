import { getLegalMoves, previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { actionKey, scenarioState, type OpenEndDisciplineAction, type OpenEndDisciplineScenario } from './openEndDisciplineScenarios.ts';

export type OpenEndDisciplineDecisionResult =
  | { kind: 'illegal'; feedbackOutcomeKey: 'illegal_action'; decisionSummary: { total: number; correct: number; incorrect: number }; mistakeCategoryIds: string[]; nextBoard: null; openEndsBefore: number[]; openEndsAfter: number[] }
  | { kind: 'evaluated'; result: 'completed' | 'passed' | 'failed'; feedbackOutcomeKey: string; decisionSummary: { total: number; correct: number; incorrect: number }; mistakeCategoryIds: string[]; nextBoard: import('../../../types.ts').BoardState; openEndsBefore: number[]; openEndsAfter: number[] };

function sameAction(a: OpenEndDisciplineAction, b: OpenEndDisciplineAction): boolean {
  return actionKey(a) === actionKey(b);
}

function legalAction(scenario: OpenEndDisciplineScenario, action: OpenEndDisciplineAction): boolean {
  return getLegalMoves(scenarioState(scenario), 'you').some((move) => {
    if (move.type !== 'play' || !move.tile || !move.position) return false;
    return sameAction({ tile: move.tile, position: move.position }, action);
  });
}

export function evaluateOpenEndDisciplineDecision({ scenario, action }: { scenario: OpenEndDisciplineScenario; action: OpenEndDisciplineAction }): OpenEndDisciplineDecisionResult {
  const before = scenarioOpenEnds(scenario);
  const preview = legalAction(scenario, action) ? previewPlayMove(scenarioState(scenario), 'you', { type: 'play', tile: action.tile, position: action.position }) : null;
  if (!preview) return { kind: 'illegal', feedbackOutcomeKey: 'illegal_action', decisionSummary: { total: 1, correct: 0, incorrect: 0 }, mistakeCategoryIds: ['illegal_action'], nextBoard: null, openEndsBefore: before, openEndsAfter: [] };
  const accepted = scenario.acceptedActions.some((candidate) => sameAction(candidate, action));
  const feedbackOutcomeKey = scenario.feedbackByAction[actionKey(action)] ?? (accepted ? 'valid_alternative' : 'gave_opponent_flexible_reply');
  return {
    kind: 'evaluated',
    result: accepted ? (scenario.kind === 'proof' ? 'passed' : 'completed') : 'failed',
    feedbackOutcomeKey,
    decisionSummary: { total: 1, correct: accepted ? 1 : 0, incorrect: accepted ? 0 : 1 },
    mistakeCategoryIds: accepted ? [] : [feedbackOutcomeKey],
    nextBoard: preview.nextBoard,
    openEndsBefore: before,
    openEndsAfter: preview.openEnds,
  };
}

function scenarioOpenEnds(scenario: OpenEndDisciplineScenario): number[] {
  return [scenario.board.leftEnd, scenario.board.rightEnd];
}
