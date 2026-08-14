import {
  getLegalMoves,
  passTurn,
  type BotActionResult,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';

export function isDailyFritzLockedBoneyardNoMove(match: BotMatchState): boolean {
  const boneyardLocked = match.boneyard.length <= match.deadTiles.length;
  const botAlsoStuck =
    boneyardLocked
    && asPlayMoves(getLegalMoves({ ...match, currentPlayer: 'bot' }, 'bot')).length === 0;
  return boneyardLocked && botAlsoStuck;
}

export type DailyFritzBlockedHandPassStep = {
  player: BotPlayerId;
  before: BotMatchState;
};

export type DailyFritzBlockedHandResolution = {
  result: BotActionResult;
  passes: DailyFritzBlockedHandPassStep[];
};

/**
 * Resolve a locked, mutually stuck Daily Fritz position on the player's turn.
 *
 * Both official passes must be applied in engine order. Inventing a prior
 * Fritz pass makes the local hand look blocked while the verifier still sees
 * an incomplete transcript.
 */
export function resolveDailyFritzBlockedHandPass(
  match: BotMatchState,
): DailyFritzBlockedHandResolution {
  const playerPass = passTurn(match, 'you');
  if (playerPass.error) {
    return { result: playerPass, passes: [] };
  }

  const passes: DailyFritzBlockedHandPassStep[] = [{ player: 'you', before: match }];
  if (playerPass.state.handOver) {
    return { result: playerPass, passes };
  }

  const fritzPass = passTurn(playerPass.state, 'bot');
  if (!fritzPass.error) {
    passes.push({ player: 'bot', before: playerPass.state });
  }
  return { result: fritzPass, passes };
}
