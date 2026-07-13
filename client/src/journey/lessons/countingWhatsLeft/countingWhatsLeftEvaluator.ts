import { getLegalMoves, previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { getAccountedTilesForPip, getCoreJourneyTileSet, getUnseenTileCountForPip } from '../../journeyCounting.ts';
import { createJourneyScenarioState, type JourneyAuthoredMoveAction, type JourneyAuthoredScenario, type JourneyScenarioEvaluation, type JourneyScenarioResponse } from '../../journeyAuthoredLessonBundle.ts';

function actionKey(action: JourneyAuthoredMoveAction): string { return `${action.tile.low}-${action.tile.high}@${action.position}`; }
function sameAction(a: JourneyAuthoredMoveAction, b: JourneyAuthoredMoveAction): boolean { return actionKey(a) === actionKey(b); }

export function evaluateCountingWhatsLeftResponse(scenario: JourneyAuthoredScenario, response: JourneyScenarioResponse): JourneyScenarioEvaluation {
  if (scenario.interaction.kind === 'move') throw new Error('Counting lesson scenarios require a counting interaction.');
  const expected = getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: scenario.interaction.targetPip });
  const accounted = getAccountedTilesForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: scenario.interaction.targetPip });
  const before = [scenario.board.leftEnd, scenario.board.rightEnd];
  if (response.kind === 'pip_count') {
    const correct = response.predictedUnseenCount === expected;
    return { kind: 'evaluated', result: correct ? 'completed' : 'failed', feedbackOutcomeKey: correct ? 'correct_accounting' : countFeedback(scenario, scenario.interaction.targetPip, response.predictedUnseenCount, expected), decisionSummary: { total: 1, correct: correct ? 1 : 0, incorrect: correct ? 0 : 1 }, mistakeCategoryIds: correct ? [] : [response.predictedUnseenCount === expected - 1 ? 'mistake:counted-double-twice' : 'mistake:missed-known-tile'], nextBoard: null, openEndsBefore: before, openEndsAfter: before, accountedTiles: accounted, expectedUnseenCount: expected, predictedUnseenCount: response.predictedUnseenCount };
  }
  if (response.kind !== 'pip_count_then_move') throw new Error(`Unexpected response ${response.kind}.`);
  const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you').some((move) => move.type === 'play' && move.tile && move.position && sameAction({ tile: move.tile, position: move.position }, response.action));
  if (!legal) return { kind: 'illegal', feedbackOutcomeKey: 'illegal_action', decisionSummary: { total: 2, correct: 0, incorrect: 2 }, mistakeCategoryIds: ['mistake:illegal-action'], nextBoard: null, openEndsBefore: before, openEndsAfter: before, accountedTiles: accounted, expectedUnseenCount: expected, predictedUnseenCount: response.predictedUnseenCount };
  const preview = previewPlayMove(createJourneyScenarioState(scenario), 'you', { type: 'play', tile: response.action.tile, position: response.action.position })!;
  const countCorrect = response.predictedUnseenCount === expected;
  const moveAccepted = scenario.acceptedActions.some((action) => sameAction(action, response.action));
  const result = countCorrect && moveAccepted ? (scenario.kind === 'proof' ? 'passed' : 'completed') : 'failed';
  const key = countCorrect && moveAccepted ? (scenario.kind === 'proof' ? 'recognized_proof_exception' : 'used_count_with_continuation') : !countCorrect && moveAccepted ? 'wrong_count_defensible_move' : countCorrect ? 'correct_count_weak_move' : 'both_wrong';
  return { kind: 'evaluated', result, feedbackOutcomeKey: key, decisionSummary: { total: 2, correct: Number(countCorrect) + Number(moveAccepted), incorrect: 2 - Number(countCorrect) - Number(moveAccepted) }, mistakeCategoryIds: countCorrect && moveAccepted ? [] : [!countCorrect ? 'mistake:missed-known-tile' : 'mistake:ignored-own-follow-up', !moveAccepted ? 'mistake:chased-low-unseen-count-blindly' : ''].filter(Boolean), nextBoard: preview.nextBoard, openEndsBefore: before, openEndsAfter: preview.openEnds, accountedTiles: accounted, expectedUnseenCount: expected, predictedUnseenCount: response.predictedUnseenCount };
}

function countFeedback(scenario: JourneyAuthoredScenario, targetPip: number, predicted: number, expected: number): string {
  if (predicted === expected - 1 && scenario.board.mainLine.some((placed) => placed.tile.low === targetPip && placed.tile.high === targetPip)) return 'counted_double_twice';
  return 'missed_known_tile';
}
