import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { getCoreJourneyTileSet, getUnseenTileCountForPip, validateKnownTiles } from '../../journeyCounting.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { READING_THE_BONEYARD_CONTENT_ID, READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID, READING_THE_BONEYARD_PROOF_VARIANT_SET_ID } from './readingTheBoneyardLesson.ts';
import { READING_THE_BONEYARD_FEEDBACK } from './readingTheBoneyardFeedback.ts';
import { READING_THE_BONEYARD_SCENARIOS } from './readingTheBoneyardScenarios.ts';

export function validateReadingTheBoneyardContent(definition: { id: string; nodeId: string }): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of READING_THE_BONEYARD_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    try { validateKnownTiles(getCoreJourneyTileSet(), scenario.board, scenario.playerHand); } catch (error) { errors.push(`${scenario.id}: ${error instanceof Error ? error.message : 'invalid known tiles'}`); }
    if (scenario.interaction.kind === 'move') { errors.push(`${scenario.id}: reading-the-boneyard requires a counting interaction`); continue; }
    try {
      const count = getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: scenario.interaction.targetPip });
      if (count < 0 || !scenario.interaction.options.includes(count)) errors.push(`${scenario.id}: derived unseen count is not represented by options`);
    } catch (error) { errors.push(`${scenario.id}: ${error instanceof Error ? error.message : 'invalid count'}`); }
    if (scenario.interaction.kind === 'pip_count_then_move') {
      const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
      for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
        const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
        if (!legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high)) errors.push(`${scenario.id}: illegal authored move ${key}`);
        if (!scenario.feedbackByAction[key] || !READING_THE_BONEYARD_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
      }
      if (scenario.denialFacts.acceptedUnseenCount >= scenario.denialFacts.temptingUnseenCount) {
        errors.push(`${scenario.id}: accepted action must expose a strictly safer (lower unseen count) end`);
      }
    }
  }
  const practice = READING_THE_BONEYARD_SCENARIOS.filter((s) => s.variantSetId === READING_THE_BONEYARD_PRACTICE_VARIANT_SET_ID);
  const proof = READING_THE_BONEYARD_SCENARIOS.filter((s) => s.variantSetId === READING_THE_BONEYARD_PROOF_VARIANT_SET_ID);
  if (practice.length < 3) errors.push('reading-the-boneyard practice needs at least three variants');
  if (proof.length < 2) errors.push('reading-the-boneyard proof needs at least two variants');
  if (definition.id !== READING_THE_BONEYARD_CONTENT_ID || definition.nodeId !== 'ch5-n07') errors.push('reading-the-boneyard definition identity mismatch');
  return errors.sort();
}
