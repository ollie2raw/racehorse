import {
  cloneBoardState,
  snapshotBoardState,
  toTileTuple,
} from '../../game/moveLogger.ts';
import { getDisplayOpenEnds, type BotMatchState } from '../match/runtime/botEngine.ts';
import { sumTilePips } from '../../game/tileUtils.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import { serializeGhostBoardState } from '../ghost/ghostMoveLogic.ts';
import type { Move, Tile } from '../../types.ts';

export type PlayerMoveSnapshot = {
  boardEnds: [number, number];
  handBefore: ReturnType<typeof toTileTuple>[];
  ghostHandBefore: string[];
  validMoves: ReturnType<typeof toTileTuple>[];
  beforePips: number;
  boardStateKey: string;
  boardState: ReturnType<typeof snapshotBoardState>;
  boardRenderState: ReturnType<typeof cloneBoardState>;
};

export function collectPlayerMoveSnapshot(
  match: BotMatchState,
  userPlayMoves: Move[],
): PlayerMoveSnapshot {
  const boardEndsRaw = getDisplayOpenEnds(match);
  const boardEnds: [number, number] = [boardEndsRaw[0] ?? -1, boardEndsRaw[1] ?? -1];
  const handBefore = match.players.you.hand.map(toTileTuple);
  return {
    boardEnds,
    handBefore,
    ghostHandBefore: match.players.you.hand.map(toTileKey),
    validMoves: userPlayMoves
      .filter((m) => m.tile)
      .map((m) => toTileTuple(m.tile as Tile)),
    beforePips: sumTilePips(match.players.you.hand),
    boardStateKey: serializeGhostBoardState(match.board),
    boardState: snapshotBoardState(match.board),
    boardRenderState: cloneBoardState(match.board),
  };
}