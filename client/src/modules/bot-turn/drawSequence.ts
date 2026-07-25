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
  drawStepMsOverride?: number,
) => Promise<BotActionResult>;

export type CreateRunDrawSequenceDeps = {
  /** Player tray needs committed tiles mid-draw; Fritz rack uses overlay counts instead. */
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  /** Step-local Fritz rack + boneyard without committing match identity each tile. */
  onDrawVisualStep?: (player: BotPlayerId, state: BotMatchState) => void;
  isMuted: boolean;
  isLocalRunCurrent: (token: LocalRunToken) => boolean;
  triggerDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
  drawStepMs: number;
};

export function createRunDrawSequence(deps: CreateRunDrawSequenceDeps): RunDrawSequence {
  const {
    setMatch,
    onDrawVisualStep,
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
    drawStepMsOverride,
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
      // Tick rack/boneyard via overlay for Fritz; only commit match for the player's
      // face-up tray. Avoids mid-draw bot-turn effect remounts from setMatch churn.
      onDrawVisualStep?.(player, current);
      if (player === 'you') {
        setMatch(current);
      }
      queueSound(() => playDrawSound(isMuted), 0);
      triggerDrawStepAnimation(player, current);
      // The player's final draw is already committed to the face-up tray. Once
      // it creates a legal move, release input immediately while the 1.6s fly
      // animation finishes independently.
      if (player === 'you' && asPlayMoves(getLegalMoves(current, player)).length > 0) {
        continue;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, drawStepMsOverride ?? drawStepMs));
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
