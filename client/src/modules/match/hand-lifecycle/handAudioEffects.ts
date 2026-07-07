import type { BotActionResult } from '../runtime/botEngine.ts';
import {
  playBlockedSound,
  playHandLoseSound,
  playHandWinSound,
  playScoreSound,
  queueSound,
} from '../../../utils/sound.ts';

/** Audio cues when a hand ends (blocked, win/lose). */
export function playHandEndAudioEffects(result: BotActionResult, isMuted: boolean): void {
  if (!result.handEnded) return;

  if (result.handEnded.reason === 'blocked') {
    queueSound(() => playBlockedSound(isMuted), 0);
  }
  if (!result.state.gameOver) {
    if (result.handEnded.winner === 'you') {
      queueSound(() => playHandWinSound(isMuted), 320);
    } else {
      queueSound(() => playHandLoseSound(isMuted), 320);
    }
  }
}

/** Audio cue when points are scored mid-hand. */
export function playScoreAudioEffect(result: BotActionResult, isMuted: boolean): void {
  if (!result.scored) return;
  queueSound(() => playScoreSound(result.scored!.points, isMuted), 80);
}