import type { GameState, Move, Tile } from '../../../types';
import {
  cloneBoardState,
  pickEngineBestMove,
  snapshotBoardState,
  toTileTuple,
} from '../../../game/moveLogger';
import { getBoardEnds } from '../../boardSessionUtils';

/**
 * Shared "before the action" snapshot used by draw/pass/play when building
 * their appendMultiplayerMove payload. Extracted verbatim (same call order
 * and inputs) from useLiveMatchActions so DRAW/PASS/MOVE telemetry is
 * unchanged.
 */
export function buildGameplayMoveTelemetry(params: {
  stateNow: GameState | null;
  legalMovesNow: Move[];
  you: string;
}) {
  const { stateNow, legalMovesNow, you } = params;
  const boardEnds = getBoardEnds(stateNow?.board ?? null);
  const handBefore = (stateNow?.players[you]?.hand ?? []).map(toTileTuple);
  const validMoves = legalMovesNow
    .filter((m) => m.type === 'play' && m.tile)
    .map((m) => toTileTuple(m.tile as Tile));
  const engineBestMove = pickEngineBestMove(
    legalMovesNow
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
    boardEnds,
    handBefore,
  );
  return {
    boardEnds,
    handBefore,
    validMoves,
    boardState: snapshotBoardState(stateNow?.board ?? null),
    boardRenderState: cloneBoardState(stateNow?.board ?? null),
    handSnapshot: handBefore,
    engineBestMove,
  };
}
