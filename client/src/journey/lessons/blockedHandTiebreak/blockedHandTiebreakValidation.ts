import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { BLOCKED_HAND_TIEBREAK_CONTENT_ID, BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID, BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID } from './blockedHandTiebreakLesson.ts';
import { BLOCKED_HAND_TIEBREAK_FEEDBACK } from './blockedHandTiebreakFeedback.ts';
import { BLOCKED_HAND_TIEBREAK_SCENARIOS } from './blockedHandTiebreakScenarios.ts';

export function validateBlockedHandTiebreakContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of BLOCKED_HAND_TIEBREAK_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
    const legalAction = (action: { tile: { low: number; high: number }; position: string }) =>
      legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high);
    for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
      if (!legalAction(action)) errors.push(`${scenario.id}: illegal authored action ${action.tile.low}-${action.tile.high}@${action.position}`);
      const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
      if (!scenario.feedbackByAction[key] || !BLOCKED_HAND_TIEBREAK_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
    }
    if (scenario.pipTotalFacts.acceptedRemainingPips >= scenario.pipTotalFacts.temptingRemainingPips) {
      errors.push(`${scenario.id}: accepted action must leave a strictly lower remaining pip total`);
    }
    for (const step of scenario.demonstrationSteps ?? []) {
      if (!step.caption.trim() || !step.boardDescription.trim()) errors.push(`${scenario.id}: demonstration copy is empty`);
      if (step.kind === 'preview_move' && !legalAction(step.action)) errors.push(`${scenario.id}: illegal demonstration preview ${step.id}`);
    }
  }
  const practice = BLOCKED_HAND_TIEBREAK_SCENARIOS.filter((s) => s.variantSetId === BLOCKED_HAND_TIEBREAK_PRACTICE_VARIANT_SET_ID);
  const proof = BLOCKED_HAND_TIEBREAK_SCENARIOS.filter((s) => s.variantSetId === BLOCKED_HAND_TIEBREAK_PROOF_VARIANT_SET_ID);
  if (practice.length < 3) errors.push('blocked-hand-tiebreak practice needs at least three variants');
  if (proof.length < 2) errors.push('blocked-hand-tiebreak proof needs at least two variants');
  if (definition.id !== BLOCKED_HAND_TIEBREAK_CONTENT_ID || definition.nodeId !== 'ch2-n07') errors.push('blocked-hand-tiebreak definition identity mismatch');
  return errors.sort();
}
