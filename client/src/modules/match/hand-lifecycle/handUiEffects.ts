import type { BotActionResult } from '../runtime/botEngine.ts';
import { toastFromResult } from '../runtime/botMatchHelpers.ts';
import type { HandLifecyclePorts } from './types.ts';
import { playScoreAudioEffect } from './handAudioEffects.ts';

/** Toast and score UI side effects for non-hand-end bot action results. */
export function applyBotActionUiEffects(
  result: BotActionResult,
  ports: HandLifecyclePorts,
  opponentLabel: string,
  isMuted: boolean,
): void {
  if (result.scored) {
    // Fritz score ceremony is owned by the bot-turn cadence theater
    // (running turn total + sticky chain toast). Player scores still toast here.
    if (result.scored.player === 'you') {
      ports.showScoreToast(result.scored.player, result.scored.points);
    }
    playScoreAudioEffect(result, isMuted);
  }
  if (result.drew && result.drew.player === 'you') {
    ports.showBoardToast('You drew a tile', 'bot');
  }
  const msg = toastFromResult(result, opponentLabel);
  if (msg) ports.pushToast(msg);
}