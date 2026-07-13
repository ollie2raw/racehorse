import { getLegalMoves } from '../../../modules/match/runtime/botEngine.ts';
import { getCoreJourneyTileSet, getUnseenTileCountForPip, validateKnownTiles } from '../../journeyCounting.ts';
import type { JourneyLessonDefinition } from '../../journeyContentContract.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { COUNTING_WHATS_LEFT_FEEDBACK } from './countingWhatsLeftFeedback.ts';
import { COUNTING_WHATS_LEFT_SCENARIOS } from './countingWhatsLeftScenarios.ts';

export function validateCountingWhatsLeftContent(definition: JourneyLessonDefinition): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const scenario of COUNTING_WHATS_LEFT_SCENARIOS) {
    if (ids.has(scenario.id)) errors.push(`duplicate scenario ${scenario.id}`);
    ids.add(scenario.id);
    try { validateKnownTiles(getCoreJourneyTileSet(), scenario.board, scenario.playerHand); } catch (error) { errors.push(`${scenario.id}: ${error instanceof Error ? error.message : 'invalid known tiles'}`); }
    if (scenario.interaction.kind === 'move') errors.push(`${scenario.id}: counting lesson requires counting interaction`);
    else {
      try {
        const count = getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board: scenario.board, playerHand: scenario.playerHand, pip: scenario.interaction.targetPip });
        if (count < 0 || !scenario.interaction.options.includes(count)) errors.push(`${scenario.id}: derived unseen count is not represented by options`);
      } catch (error) { errors.push(`${scenario.id}: ${error instanceof Error ? error.message : 'invalid count'}`); }
    }
    if (scenario.interaction.kind !== 'pip_count') {
      const legal = getLegalMoves(createJourneyScenarioState(scenario), 'you');
      for (const action of [...scenario.acceptedActions, ...scenario.temptingActions]) {
        const key = `${action.tile.low}-${action.tile.high}@${action.position}`;
        if (!legal.some((move) => move.type === 'play' && move.tile && move.position === action.position && move.tile.low === action.tile.low && move.tile.high === action.tile.high)) errors.push(`${scenario.id}: illegal authored move ${key}`);
        if (!scenario.feedbackByAction[key] || !COUNTING_WHATS_LEFT_FEEDBACK[scenario.feedbackByAction[key]]) errors.push(`${scenario.id}: missing feedback for ${key}`);
      }
    }
  }
  if (COUNTING_WHATS_LEFT_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:counting-practice').length < 3) errors.push('counting practice needs three variants');
  if (COUNTING_WHATS_LEFT_SCENARIOS.filter((scenario) => scenario.variantSetId === 'variants:counting-proof').length < 2) errors.push('counting proof needs two variants');
  if (definition.id !== 'journey:ch1:counting-whats-left' || definition.nodeId !== 'ch1-n08') errors.push('counting definition identity mismatch');
  return errors.sort();
}
