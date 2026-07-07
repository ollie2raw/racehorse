import {
  applyPlayMove,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import {
  chooseBotMove,
  toBotVisibleState,
  type BotChoice,
  type BotDifficulty,
} from '../fritz/botHeuristics.ts';
import type { GhostProfileSummary, GhostResolvedMove } from '../ghost/ghostContracts.ts';
import { resolveGhostMove } from '../ghost/ghostMoveLogic.ts';
import { playTileSound, queueSound } from '../../utils/sound.ts';
import type { Move, Tile } from '../../types.ts';
import { logFritzFairnessDecision } from './fritzEvaluation.ts';

export type BotMoveResolution = {
  chosen: BotChoice | null;
  ghostChosen: GhostResolvedMove | null;
  move: Move;
  playedTileForHighlight: Tile | null;
};

export function resolveBotMoveChoice(input: {
  state: BotMatchState;
  legalMoves: Move[];
  isGhostMode: boolean;
  ghostProfile: GhostProfileSummary | null;
  fritzDifficulty: BotDifficulty;
}): BotMoveResolution {
  let chosen: BotChoice | null = null;
  let ghostChosen: GhostResolvedMove | null = null;

  if (input.isGhostMode) {
    ghostChosen = resolveGhostMove({
      state: input.state,
      player: 'bot',
      legalMoves: input.legalMoves,
      profile: input.ghostProfile,
    });
  } else {
    chosen = chooseBotMove(toBotVisibleState(input.state), input.fritzDifficulty);
    logFritzFairnessDecision(input.state, chosen);
  }

  const move: Move = ghostChosen
    ? { type: 'play', tile: ghostChosen.tile, position: ghostChosen.position }
    : chosen?.move ?? input.legalMoves[0];

  const playedTileForHighlight =
    ghostChosen?.tile ?? chosen?.move?.tile ?? input.legalMoves[0]?.tile ?? null;

  return { chosen, ghostChosen, move, playedTileForHighlight };
}

export function executeBotPlayMove(input: {
  working: BotMatchState;
  resolution: BotMoveResolution;
  isMuted: boolean;
  captureGuided: (
    beforeState: BotMatchState,
    result: BotActionResult,
    move: Move,
  ) => void;
}): BotActionResult {
  queueSound(() => playTileSound('deal', input.isMuted), 0);
  const result = applyPlayMove(input.working, 'bot', input.resolution.move);
  input.captureGuided(input.working, result, input.resolution.move);
  return result;
}