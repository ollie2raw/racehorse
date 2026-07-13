import { getLegalMoves, type BotMatchState } from '../../../modules/match/runtime/botEngine.ts';
import type { JourneyLessonDefinition } from '../../journeyContentContract.ts';
import { OPEN_END_DISCIPLINE_FEEDBACK, OPEN_END_DISCIPLINE_FEEDBACK_ID } from './openEndDisciplineFeedback.ts';
import { actionKey, getScenarioLegalActions, scenarioState, OPEN_END_DISCIPLINE_SCENARIOS, type OpenEndDisciplineAction, type OpenEndDisciplineScenario } from './openEndDisciplineScenarios.ts';

function sameAction(a: OpenEndDisciplineAction, b: OpenEndDisciplineAction): boolean {
  return actionKey(a) === actionKey(b);
}

export function validateOpenEndDisciplineContent(definition: JourneyLessonDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of OPEN_END_DISCIPLINE_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ID ${scenario.id}`);
    ids.add(scenario.id);
    if (scenario.ruleset.kind !== 'core_journey') errors.push(`${scenario.id}: scenario must use Core Journey ruleset`);
    if (scenario.board.mainLine.length === 0) errors.push(`${scenario.id}: board must contain a main line`);
    const legal = getScenarioLegalActions(scenario);
    const legalKeys = new Set(legal.map(actionKey));
    if (scenario.kind === 'guided' && legal.length < 2) errors.push(`${scenario.id}: guided scenario needs at least two legal choices`);
    if (scenario.acceptedActions.length === 0 && scenario.kind !== 'demo') errors.push(`${scenario.id}: scenario needs an accepted action`);
    for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
      const key = actionKey(action);
      if (!legalKeys.has(key)) errors.push(`${scenario.id}: authored action ${key} is not legal`);
      if (!scenario.feedbackByAction[key]) errors.push(`${scenario.id}: missing feedback for ${key}`);
    }
    for (const accepted of scenario.acceptedActions) {
      if (scenario.temptingActions.some((tempting) => sameAction(accepted, tempting))) errors.push(`${scenario.id}: action cannot be both accepted and tempting`);
    }
    for (const feedbackKey of Object.values(scenario.feedbackByAction)) {
      if (!OPEN_END_DISCIPLINE_FEEDBACK[feedbackKey]) errors.push(`${scenario.id}: unknown feedback outcome ${feedbackKey}`);
    }
  }
  const scenarioIds = new Set(OPEN_END_DISCIPLINE_SCENARIOS.map((scenario) => scenario.id));
  for (const stage of definition.stages) {
    if ('scenarioRef' in stage && !scenarioIds.has(stage.scenarioRef)) errors.push(`${stage.id}: unknown authored scenario ${stage.scenarioRef}`);
  }
  const variants = OPEN_END_DISCIPLINE_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:open-end-practice');
  if (new Set(variants.map((scenario) => scenario.id)).size < 3) errors.push('practice variant set needs at least three unique scenarios');
  for (const stage of definition.stages) {
    if (stage.kind === 'board_demo' || stage.kind === 'frame') continue;
    if (stage.feedbackRef.kind !== 'outcome_bundle' || stage.feedbackRef.id !== OPEN_END_DISCIPLINE_FEEDBACK_ID) errors.push(`${stage.id}: unexpected feedback bundle`);
    if (!OPEN_END_DISCIPLINE_FEEDBACK.controlled_one_end || !OPEN_END_DISCIPLINE_FEEDBACK.opened_both_ends_without_compensation || !OPEN_END_DISCIPLINE_FEEDBACK.gave_opponent_flexible_reply || !OPEN_END_DISCIPLINE_FEEDBACK.preserved_pressure || !OPEN_END_DISCIPLINE_FEEDBACK.recognized_exception || !OPEN_END_DISCIPLINE_FEEDBACK.illegal_action) errors.push(`${stage.id}: feedback registry is incomplete`);
  }
  if (definition.id !== 'journey:ch1:open-end-discipline' || definition.nodeId !== 'ch1-n07') errors.push('definition identity does not target Open-End Discipline');
  return errors.sort();
}

export function validateOpenEndDisciplineScenarioRuntime(scenario: OpenEndDisciplineScenario): string[] {
  const state: BotMatchState = scenarioState(scenario);
  return getLegalMoves(state, 'you').length > 0 ? [] : [`${scenario.id}: scenario has no legal player move`];
}
