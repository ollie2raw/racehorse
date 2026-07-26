import type { BotActionResult } from '../runtime/botEngine.ts';
import type { HandLifecyclePorts } from './types.ts';
import { playScoreAudioEffect } from './handAudioEffects.ts';

/** Toast and score UI side effects for non-hand-end bot action results. */
export function applyBotActionUiEffects(
  result: BotActionResult,
  ports: HandLifecyclePorts,
  _opponentLabel: string,
  isMuted: boolean,
  isDailyFritzMode = false,
): void {
  if (result.scored) {
    // Fritz score ceremony is owned by the bot-turn cadence theater
    // (running turn total + sticky chain toast). Player scores still toast here.
    if (!isDailyFritzMode && result.scored.player === 'you') {
      ports.showScoreToast(result.scored.player, result.scored.points);
    }
    if (!isDailyFritzMode) {
      playScoreAudioEffect(result, isMuted);
    }
  }
}
