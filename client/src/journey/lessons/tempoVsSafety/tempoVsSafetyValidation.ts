import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { TEMPO_VS_SAFETY_CONTENT_ID, TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID, TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID } from './tempoVsSafetyLesson.ts';
import { TEMPO_VS_SAFETY_FEEDBACK } from './tempoVsSafetyFeedback.ts';
import { TEMPO_VS_SAFETY_SCENARIOS } from './tempoVsSafetyScenarios.ts';

export function validateTempoVsSafetyContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of TEMPO_VS_SAFETY_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
    const legalAction = (action: { tile: { low: number; high: number }; position: string }) =>
      legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high);
    for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
      if (!legalAction(action)) errors.push(`${scenario.id}: illegal authored action ${action.tile.low}-${action.tile.high}@${action.position}`);
      const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
      if (!scenario.feedbackByAction[key] || !TEMPO_VS_SAFETY_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
    }
    if (scenario.tradeoffFacts.temptingScore < scenario.tradeoffFacts.acceptedScore) {
      errors.push(`${scenario.id}: tempting action must score at least as much as the accepted action`);
    }
    if (scenario.tradeoffFacts.acceptedRemainingLegal <= scenario.tradeoffFacts.temptingRemainingLegal) {
      errors.push(`${scenario.id}: accepted action must leave strictly more remaining legal actions`);
    }
    for (const step of scenario.demonstrationSteps ?? []) {
      if (!step.caption.trim() || !step.boardDescription.trim()) errors.push(`${scenario.id}: demonstration copy is empty`);
      if (step.kind === 'preview_move' && !legalAction(step.action)) errors.push(`${scenario.id}: illegal demonstration preview ${step.id}`);
    }
  }
  const practice = TEMPO_VS_SAFETY_SCENARIOS.filter((s) => s.variantSetId === TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID);
  const proof = TEMPO_VS_SAFETY_SCENARIOS.filter((s) => s.variantSetId === TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID);
  if (practice.length < 3) errors.push('tempo-vs-safety practice needs at least three variants');
  if (proof.length < 2) errors.push('tempo-vs-safety proof needs at least two variants');
  if (definition.id !== TEMPO_VS_SAFETY_CONTENT_ID || definition.nodeId !== 'ch6-n07') errors.push('tempo-vs-safety definition identity mismatch');
  return errors.sort();
}
