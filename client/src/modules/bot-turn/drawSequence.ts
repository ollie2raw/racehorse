import type { LocalRunToken } from '../match/types.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import {
  drawOne,
  getLegalMoves,
  passTurn,
  type BotActionResult,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import { playDrawSound, queueSound } from '../../utils/sound.ts';

export type RunDrawSequence = (
  initialState: BotMatchState,
  player: BotPlayerId,
  token?: LocalRunToken,
  onStep?: (step: {
    actionKind: 'draw' | 'pass';
    beforeState: BotMatchState;
    result: BotActionResult;
  }) => void,
) => Promise<BotActionResult>;

export type CreateRunDrawSequenceDeps = {
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  isMuted: boolean;
  isLocalRunCurrent: (token: LocalRunToken) => boolean;
  triggerDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
  drawStepMs: number;
};

export function createRunDrawSequence(deps: CreateRunDrawSequenceDeps): RunDrawSequence {
  const {
    setMatch,
    isMuted,
    isLocalRunCurrent,
    triggerDrawStepAnimation,
    drawStepMs,
  } = deps;

  return async (
    initialState,
    player,
    token,
    onStep,
  ): Promise<BotActionResult> => {
    let current = initialState;
    let drewAny = false;

    while (asPlayMoves(getLegalMoves(current, player)).length === 0) {
      if (token && !isLocalRunCurrent(token)) break;
      const beforeDraw = current;
      const step = drawOne(beforeDraw, player);
      if (!step.drew) break;
      onStep?.({ actionKind: 'draw', beforeState: beforeDraw, result: step });
      drewAny = true;
      current = step.state;
      if (token && !isLocalRunCurrent(token)) break;
      setMatch(current);
      queueSound(() => playDrawSound(isMuted), 0);
      triggerDrawStepAnimation(player, current);
      await new Promise<void>((resolve) => setTimeout(resolve, drawStepMs));
      if (token && !isLocalRunCurrent(token)) break;
    }

    if (asPlayMoves(getLegalMoves(current, player)).length === 0) {
      const beforePass = current;
      const passResult = passTurn(beforePass, player);
      onStep?.({ actionKind: 'pass', beforeState: beforePass, result: passResult });
      return {
        ...passResult,
        drew: drewAny ? { player, tile: current.players[player].hand[current.players[player].hand.length - 1] } : undefined,
      };
    }

    return {
      state: current,
      drew: drewAny ? { player, tile: current.players[player].hand[current.players[player].hand.length - 1] } : undefined,
    };
  };
}