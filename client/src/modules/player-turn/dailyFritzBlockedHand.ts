import {
  getLegalMoves,
  passTurn,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';

export function isDailyFritzLockedBoneyardNoMove(match: BotMatchState): boolean {
  const boneyardLocked = match.boneyard.length <= match.deadTiles.length;
  const botAlsoStuck =
    boneyardLocked
    && asPlayMoves(getLegalMoves({ ...match, currentPlayer: 'bot' }, 'bot')).length === 0;
  return boneyardLocked && botAlsoStuck;
}

export function resolveDailyFritzBlockedHandPass(match: BotMatchState): BotActionResult {
  const resolveBase =
    match.consecutivePasses >= 1
      ? match
      : { ...match, consecutivePasses: 1 };
  return passTurn(resolveBase, 'you');
}