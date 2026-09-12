import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { ENDGAME_HAND_SHAPE_CONTENT_ID, ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID, ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID } from './endgameHandShapeLesson.ts';
import { ENDGAME_HAND_SHAPE_FEEDBACK } from './endgameHandShapeFeedback.ts';
import { ENDGAME_HAND_SHAPE_SCENARIOS } from './endgameHandShapeScenarios.ts';

export function validateEndgameHandShapeContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of ENDGAME_HAND_SHAPE_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
    const legalAction = (action: { tile: { low: number; high: number }; position: string }) =>
      legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high);
    for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
      if (!legalAction(action)) errors.push(`${scenario.id}: illegal authored action ${action.tile.low}-${action.tile.high}@${action.position}`);
      const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
      if (!scenario.feedbackByAction[key] || !ENDGAME_HAND_SHAPE_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
    }
    if (scenario.shapeFacts.acceptedRemainingLegal <= scenario.shapeFacts.temptingRemainingLegal) {
      errors.push(`${scenario.id}: accepted action must leave strictly more remaining legal actions`);
    }
    for (const step of scenario.demonstrationSteps ?? []) {
      if (!step.caption.trim() || !step.boardDescription.trim()) errors.push(`${scenario.id}: demonstration copy is empty`);
      if (step.kind === 'preview_move' && !legalAction(step.action)) errors.push(`${scenario.id}: illegal demonstration preview ${step.id}`);
    }
  }
  const practice = ENDGAME_HAND_SHAPE_SCENARIOS.filter((s) => s.variantSetId === ENDGAME_HAND_SHAPE_PRACTICE_VARIANT_SET_ID);
  const proof = ENDGAME_HAND_SHAPE_SCENARIOS.filter((s) => s.variantSetId === ENDGAME_HAND_SHAPE_PROOF_VARIANT_SET_ID);
  if (practice.length < 3) errors.push('endgame-hand-shape practice needs at least three variants');
  if (proof.length < 2) errors.push('endgame-hand-shape proof needs at least two variants');
  if (definition.id !== ENDGAME_HAND_SHAPE_CONTENT_ID || definition.nodeId !== 'ch3-n07') errors.push('endgame-hand-shape definition identity mismatch');
  return errors.sort();
}
