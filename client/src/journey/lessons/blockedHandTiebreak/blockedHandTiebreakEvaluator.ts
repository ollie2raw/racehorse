import { analyzeJourneyAuthoredMove, type JourneyAuthoredScenario, type JourneyScenarioEvaluation, type JourneyScenarioResponse } from '../../journeyAuthoredLessonBundle.ts';
import type { BlockedHandTiebreakScenario } from './blockedHandTiebreakScenarios.ts';

function actionKey(action: { tile: { low: number; high: number }; position: string }): string { return `${action.tile.low}-${action.tile.high}@${action.position}`; }
function sameAction(a: { tile: { low: number; high: number }; position: string }, b: { tile: { low: number; high: number }; position: string }): boolean { return actionKey(a) === actionKey(b); }

export function evaluateBlockedHandTiebreakResponse(scenarioInput: JourneyAuthoredScenario, response: JourneyScenarioResponse): JourneyScenarioEvaluation {
  const scenario = scenarioInput as BlockedHandTiebreakScenario;
  if (response.kind !== 'move') throw new Error(`Reading the Blocked-Hand Tiebreak expects move responses, received ${response.kind}.`);
  const consequence = analyzeJourneyAuthoredMove(scenario, response.action);
  const before = [scenario.board.leftEnd, scenario.board.rightEnd];
  if (!consequence.legal) {
    return { kind: 'illegal', feedbackOutcomeKey: 'illegal_action', decisionSummary: { total: 1, correct: 0, incorrect: 1 }, mistakeCategoryIds: ['mistake:illegal-action'], nextBoard: null, openEndsBefore: before, openEndsAfter: before, consequence };
  }
  const accepted = scenario.acceptedActions.some((action) => sameAction(action, response.action));
  const acceptedResult = scenario.kind === 'proof' ? 'passed' : 'completed';
  const feedbackOutcomeKey = scenario.feedbackByAction[actionKey(response.action)] ?? (accepted ? 'valid_alternative' : 'ignored_pip_math');
  return {
    kind: 'evaluated',
    result: accepted ? acceptedResult : 'failed',
    feedbackOutcomeKey,
    decisionSummary: { total: 1, correct: accepted ? 1 : 0, incorrect: accepted ? 0 : 1 },
    mistakeCategoryIds: accepted ? [] : ['mistake:ignored-pip-total'],
    nextBoard: consequence.resultingBoard,
    openEndsBefore: before,
    openEndsAfter: consequence.resultingOpenEnds,
    consequence,
  };
}
