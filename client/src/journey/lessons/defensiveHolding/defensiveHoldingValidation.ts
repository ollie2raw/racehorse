import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { getCoreJourneyTileSet, validateKnownTiles } from '../../journeyCounting.ts';
import { DEFENSIVE_HOLDING_CONTENT_ID, DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID, DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID } from './defensiveHoldingLesson.ts';
import { DEFENSIVE_HOLDING_FEEDBACK } from './defensiveHoldingFeedback.ts';
import { DEFENSIVE_HOLDING_SCENARIOS } from './defensiveHoldingScenarios.ts';

export function validateDefensiveHoldingContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of DEFENSIVE_HOLDING_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    try { validateKnownTiles(getCoreJourneyTileSet(), scenario.board, scenario.playerHand); } catch (error) { errors.push(`${scenario.id}: ${error instanceof Error ? error.message : 'invalid known tiles'}`); }
    const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
    const legalAction = (action: { tile: { low: number; high: number }; position: string }) =>
      legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high);
    for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
      if (!legalAction(action)) errors.push(`${scenario.id}: illegal authored action ${action.tile.low}-${action.tile.high}@${action.position}`);
      const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
      if (!scenario.feedbackByAction[key] || !DEFENSIVE_HOLDING_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
    }
    if (scenario.denialFacts.acceptedUnseenCount >= scenario.denialFacts.temptingUnseenCount) {
      errors.push(`${scenario.id}: accepted action must expose a strictly safer (lower unseen count) end`);
    }
    for (const step of scenario.demonstrationSteps ?? []) {
      if (!step.caption.trim() || !step.boardDescription.trim()) errors.push(`${scenario.id}: demonstration copy is empty`);
      if (step.kind === 'preview_move' && !legalAction(step.action)) errors.push(`${scenario.id}: illegal demonstration preview ${step.id}`);
    }
  }
  const practice = DEFENSIVE_HOLDING_SCENARIOS.filter((s) => s.variantSetId === DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID);
  const proof = DEFENSIVE_HOLDING_SCENARIOS.filter((s) => s.variantSetId === DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID);
  if (practice.length < 3) errors.push('defensive-holding practice needs at least three variants');
  if (proof.length < 2) errors.push('defensive-holding proof needs at least two variants');
  if (definition.id !== DEFENSIVE_HOLDING_CONTENT_ID || definition.nodeId !== 'ch4-n07') errors.push('defensive-holding definition identity mismatch');
  return errors.sort();
}
