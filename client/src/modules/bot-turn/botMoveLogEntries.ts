import type { EngineBestMove, MoveEntry } from '../../game/moveLogger.ts';
import { toTileTuple } from '../../game/moveLogger.ts';
import type { Tile } from '../../types.ts';
import type { PlacementPosition } from '../../types.ts';
import type { BotTurnSnapshot } from './botMoveSnapshot.ts';

type OpponentMoveLogEntry = Omit<MoveEntry, 'moveNumber' | 'handNumber'>;

function baseFields(
  snapshot: BotTurnSnapshot,
  engineBestMove: EngineBestMove | null,
): Omit<OpponentMoveLogEntry, 'player' | 'action' | 'tile'> {
  return {
    boardEnds: snapshot.boardEnds,
    handBefore: [],
    validMoves: [],
    pipDelta: 0,
    pointsScored: 0,
    boardState: snapshot.boardState,
    boardRenderState: snapshot.boardRenderState,
    handSnapshot: snapshot.handSnapshot,
    engineBestMove,
  };
}

export function buildBotDrawMoveLogEntry(
  snapshot: BotTurnSnapshot,
  engineBestMove: EngineBestMove | null,
): OpponentMoveLogEntry {
  return {
    player: 'opponent',
    action: 'draw',
    ...baseFields(snapshot, engineBestMove),
  };
}

export function buildBotPassMoveLogEntry(
  snapshot: BotTurnSnapshot,
  engineBestMove: EngineBestMove | null,
): OpponentMoveLogEntry {
  return {
    player: 'opponent',
    action: 'pass',
    ...baseFields(snapshot, engineBestMove),
  };
}

export function buildBotPlaceMoveLogEntry(input: {
  snapshot: BotTurnSnapshot;
  tile: Tile;
  position: PlacementPosition;
  engineBestMove: EngineBestMove | null;
}): OpponentMoveLogEntry {
  return {
    player: 'opponent',
    action: 'place',
    tile: toTileTuple(input.tile),
    position: input.position,
    ...baseFields(input.snapshot, input.engineBestMove),
  };
}
