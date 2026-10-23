import { analyzeJourneyAuthoredMove, type JourneyAuthoredScenario, type JourneyScenarioEvaluation, type JourneyScenarioResponse } from '../../journeyAuthoredLessonBundle.ts';
import { actionKey } from './greedyHandsFacts.ts';
import type { GreedyHandsScenario } from './greedyHandsScenarios.ts';

/**
 * Grades one chosen first play. The play is graded as a whole TURN: the board the feedback shows, and the ends it
 * reports, are the ones left when the turn is over (what the opponent faces), not just after the first tile.
 */
export function evaluateGreedyHandsResponse(scenarioInput: JourneyAuthoredScenario, response: JourneyScenarioResponse): JourneyScenarioEvaluation {
  const scenario = scenarioInput as GreedyHandsScenario;
  if (response.kind !== 'move') throw new Error(`Greedy Hands expects move responses, received ${response.kind}.`);
  const consequence = analyzeJourneyAuthoredMove(scenario, response.action);
  const before = [scenario.board.leftEnd, scenario.board.rightEnd];
  const key = actionKey(response.action);
  const line = scenario.greedy.lines[key];
  if (!consequence.legal || !line) {
    return { kind: 'illegal', feedbackOutcomeKey: 'illegal_action', decisionSummary: { total: 1, correct: 0, incorrect: 1 }, mistakeCategoryIds: ['mistake:illegal-action'], nextBoard: null, openEndsBefore: before, openEndsAfter: before, consequence };
  }
  const accepted = key === scenario.greedy.acceptedKey;
  const acceptedResult = scenario.kind === 'proof' ? 'passed' : 'completed';
  const mistake = key === scenario.greedy.temptingKey
    ? (scenario.greedy.type === 'cost' ? 'mistake:took-points-into-a-reply' : 'mistake:gave-up-points-for-safety')
    : 'mistake:misjudged-the-turn';
  return {
    kind: 'evaluated',
    result: accepted ? acceptedResult : 'failed',
    feedbackOutcomeKey: scenario.feedbackByAction[key],
    decisionSummary: { total: 1, correct: accepted ? 1 : 0, incorrect: accepted ? 0 : 1 },
    mistakeCategoryIds: accepted ? [] : [mistake],
    nextBoard: line.finalBoard,
    openEndsBefore: before,
    openEndsAfter: [line.finalEnds[0], line.finalEnds[1]],
    consequence,
  };
}
