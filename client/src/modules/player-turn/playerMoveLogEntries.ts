import type { MoveEntry } from '../../game/moveLogger.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { PlayerMoveSnapshot } from './playerMoveSnapshot.ts';
import type { Tile } from '../../types.ts';
import { toTileTuple } from '../../game/moveLogger.ts';

type BaseMoveLogFields = Pick<
  MoveEntry,
  | 'boardEnds'
  | 'handBefore'
  | 'validMoves'
  | 'pipDelta'
  | 'pointsScored'
  | 'boardState'
  | 'boardRenderState'
  | 'handSnapshot'
  | 'engineBestMove'
>;

function baseMoveLogFields(
  _match: BotMatchState,
  snapshot: PlayerMoveSnapshot,
  _fritzDifficulty: BotDifficulty,
  overrides: Partial<BaseMoveLogFields> = {},
): BaseMoveLogFields {
  return {
    boardEnds: snapshot.boardEnds,
    handBefore: snapshot.handBefore,
    validMoves: snapshot.validMoves,
    pipDelta: 0,
    pointsScored: 0,
    boardState: snapshot.boardState,
    boardRenderState: snapshot.boardRenderState,
    handSnapshot: snapshot.handBefore,
    engineBestMove: null,
    ...overrides,
  };
}

export function buildPlacementMoveLogEntry(
  match: BotMatchState,
  snapshot: PlayerMoveSnapshot,
  selectedTile: Tile,
  position: import('../../types.ts').PlacementPosition,
  afterPips: number,
  pointsScored: number,
  fritzDifficulty: BotDifficulty,
): Omit<MoveEntry, 'moveNumber' | 'handNumber'> {
  return {
    player: 'you',
    action: 'place',
    tile: toTileTuple(selectedTile),
    position,
    ...baseMoveLogFields(match, snapshot, fritzDifficulty, {
      pipDelta: snapshot.beforePips - afterPips,
      pointsScored,
    }),
  };
}

export function buildDrawMoveLogEntry(
  match: BotMatchState,
  snapshot: PlayerMoveSnapshot,
  fritzDifficulty: BotDifficulty,
): Omit<MoveEntry, 'moveNumber' | 'handNumber'> {
  return {
    player: 'you',
    action: 'draw',
    ...baseMoveLogFields(match, snapshot, fritzDifficulty, {
      validMoves: [],
    }),
  };
}

export function buildPassMoveLogEntry(
  match: BotMatchState,
  snapshot: PlayerMoveSnapshot,
  fritzDifficulty: BotDifficulty,
): Omit<MoveEntry, 'moveNumber' | 'handNumber'> {
  return {
    player: 'you',
    action: 'pass',
    ...baseMoveLogFields(match, snapshot, fritzDifficulty, {
      validMoves: [],
    }),
  };
}
