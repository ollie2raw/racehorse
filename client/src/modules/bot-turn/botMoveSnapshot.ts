import {
  cloneBoardState,
  snapshotBoardState,
  toTileTuple,
} from '../../game/moveLogger.ts';
import { getDisplayOpenEnds, type BotMatchState } from '../match/runtime/botEngine.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import { serializeGhostBoardState } from '../ghost/ghostMoveLogic.ts';

export type BotTurnSnapshot = {
  boardEnds: [number, number];
  ghostBoardStateKey: string;
  ghostHandBefore: string[];
  boardState: ReturnType<typeof snapshotBoardState>;
  boardRenderState: ReturnType<typeof cloneBoardState>;
  handSnapshot: ReturnType<typeof toTileTuple>[];
};

export function collectBotTurnSnapshot(match: BotMatchState): BotTurnSnapshot {
  const beforeEndsRaw = getDisplayOpenEnds(match);
  const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
  return {
    boardEnds,
    ghostBoardStateKey: serializeGhostBoardState(match.board),
    ghostHandBefore: match.players.bot.hand.map(toTileKey),
    boardState: snapshotBoardState(match.board),
    boardRenderState: cloneBoardState(match.board),
    handSnapshot: match.players.you.hand.map(toTileTuple),
  };
}