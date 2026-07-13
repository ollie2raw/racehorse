import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { analyzeJourneyAuthoredMove, createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { DOUBLES_ARENT_FREE_CONTENT_ID, DOUBLES_PRACTICE_VARIANT_SET_ID, DOUBLES_PROOF_VARIANT_SET_ID } from './doublesArentFreeLesson.ts';
import { DOUBLES_ARENT_FREE_FEEDBACK } from './doublesArentFreeFeedback.ts';
import type { DoublesScenario } from './doublesArentFreeScenarios.ts';
import { DOUBLES_ARENT_FREE_SCENARIOS } from './doublesArentFreeScenarios.ts';

export function validateDoublesArentFreeContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of DOUBLES_ARENT_FREE_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.playerHand.some((tile) => tile.low === tile.high)) errors.push(`${scenario.id}: hand needs a double`);
    const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
    const legalAction = (action: DoublesScenario['acceptedActions'][number]) => legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high);
    for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
      if (!legalAction(action)) errors.push(`${scenario.id}: illegal authored action ${action.tile.low}-${action.tile.high}@${action.position}`);
      const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
      if (!scenario.feedbackByAction[key] || !DOUBLES_ARENT_FREE_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
    }
    for (const accepted of scenario.acceptedActions) for (const tempting of scenario.temptingActions) if (accepted.tile.low === tempting.tile.low && accepted.tile.high === tempting.tile.high && accepted.position === tempting.position) errors.push(`${scenario.id}: accepted and tempting actions overlap`);
    for (const step of scenario.demonstrationSteps ?? []) {
      if (!step.caption.trim() || !step.boardDescription.trim()) errors.push(`${scenario.id}: demonstration copy is empty`);
      if (step.kind === 'preview_move' && !legalAction(step.action)) errors.push(`${scenario.id}: illegal demonstration preview ${step.id}`);
    }
    for (const action of scenario.acceptedActions) {
      const consequence = analyzeJourneyAuthoredMove(scenario, action);
      if (consequence.playedDouble !== scenario.doublesFacts.acceptedPlayedDouble) errors.push(`${scenario.id}: accepted double classification drift`);
    }
    for (const action of scenario.temptingActions) {
      const consequence = analyzeJourneyAuthoredMove(scenario, action);
      if (consequence.playedDouble !== scenario.doublesFacts.temptingPlayedDouble) errors.push(`${scenario.id}: tempting double classification drift`);
    }
  }
  const practice = DOUBLES_ARENT_FREE_SCENARIOS.filter((s) => s.variantSetId === DOUBLES_PRACTICE_VARIANT_SET_ID);
  const proof = DOUBLES_ARENT_FREE_SCENARIOS.filter((s) => s.variantSetId === DOUBLES_PROOF_VARIANT_SET_ID);
  if (practice.length < 4 || !practice.some((s) => s.doublesFacts.acceptedPlayedDouble) || !practice.some((s) => !s.doublesFacts.acceptedPlayedDouble)) errors.push('doubles practice requires four variants with play and hold patterns');
  if (proof.length < 4 || !proof.some((s) => s.doublesFacts.acceptedPlayedDouble) || !proof.some((s) => !s.doublesFacts.acceptedPlayedDouble)) errors.push('doubles proof requires four variants with play and hold patterns');
  if (definition.id !== DOUBLES_ARENT_FREE_CONTENT_ID || definition.nodeId !== 'ch1-n09') errors.push('doubles definition identity mismatch');
  return errors.sort();
}
