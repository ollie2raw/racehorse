import type { BotActionResult } from '../runtime/botEngine.ts';
import {
  playBlockedSound,
  playHandLoseSound,
  playHandWinSound,
  playScoreSound,
  queueSound,
} from '../../../utils/sound.ts';
import { playHaptic, scoreCue } from '../../../utils/haptics.ts';
import { afterTileImpact } from '../../../utils/tileImpact.ts';

/** Audio cues when a hand ends (blocked, win/lose). */
export function playHandEndAudioEffects(result: BotActionResult, isMuted: boolean): void {
  if (!result.handEnded) return;

  if (result.handEnded.reason === 'blocked') {
    queueSound(() => {
      playBlockedSound(isMuted);
      playHaptic('blocked');
    }, 0);
  }
  if (!result.state.gameOver) {
    if (result.handEnded.winner === 'you') {
      queueSound(() => {
        playHandWinSound(isMuted);
        playHaptic('handWon');
      }, 320);
    } else {
      queueSound(() => {
        playHandLoseSound(isMuted);
        playHaptic('handLost');
      }, 320);
    }
  }
}

/** Audio cue when points are scored mid-hand. */
export function playScoreAudioEffect(result: BotActionResult, isMuted: boolean): void {
  if (!result.scored) return;
  // The ping belongs after the clack, and the clack waits for the tile to land.
  const { player, points } = result.scored;
  afterTileImpact(() => {
    queueSound(() => playScoreSound(points, isMuted), 80);
    // Only a score of YOURS is felt; the opponent's is heard.
    if (player === 'you') playHaptic(scoreCue(points));
  });
}