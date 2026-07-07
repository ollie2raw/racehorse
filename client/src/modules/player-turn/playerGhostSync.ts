import type { GhostMoveLogEntry, GhostResolvedMove } from '../ghost/ghostContracts.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import { isSameResolvedMove } from '../ghost/ghostMoveLogic.ts';
import type { Move, PlacementPosition, Tile } from '../../types.ts';
import type { PlayerMoveSnapshot } from './playerMoveSnapshot.ts';

export type GhostAgreementFeedback =
  | { kind: 'agreement'; type: 'agrees' | 'heuristic' }
  | { kind: 'disagreement' };

export function resolveGhostAgreementFeedback(
  move: Move,
  _position: PlacementPosition,
  suggested: GhostResolvedMove,
): GhostAgreementFeedback {
  const actualMove =
    move.tile && move.position ? { tile: move.tile, position: move.position } : null;
  const agrees = isSameResolvedMove(actualMove, suggested);
  if (!agrees) return { kind: 'disagreement' };
  return {
    kind: 'agreement',
    type: suggested.source === 'composite' ? 'agrees' : 'heuristic',
  };
}

export function buildGhostPlacementMoveLogEntry(input: {
  moveCounter: number;
  handNumber: number;
  snapshot: PlayerMoveSnapshot;
  selectedTile: Tile;
  position: PlacementPosition;
  pointsScored: number;
  forcedDraw: boolean;
}): GhostMoveLogEntry {
  return {
    turn: input.moveCounter,
    hand_number: input.handNumber,
    actor: 'you',
    board_state: input.snapshot.boardStateKey,
    tile_played: toTileKey(input.selectedTile),
    branch: typeof input.position === 'string' ? input.position : null,
    hand_before: input.snapshot.ghostHandBefore,
    score_delta: input.pointsScored,
    forced_draw: input.forcedDraw,
  };
}

function ghostHandBeforeForSnapshot(snapshot: PlayerMoveSnapshot, useTupleFormat: boolean): string[] {
  if (!useTupleFormat) return snapshot.ghostHandBefore;
  return snapshot.handBefore.map(([low, high]) => `${low}|${high}`);
}

export function buildGhostDrawMoveLogEntry(input: {
  moveCounter: number;
  handNumber: number;
  snapshot: PlayerMoveSnapshot;
  useTupleHandFormat?: boolean;
}): GhostMoveLogEntry {
  return {
    turn: input.moveCounter,
    hand_number: input.handNumber,
    actor: 'you',
    board_state: input.snapshot.boardStateKey,
    tile_played: null,
    branch: 'draw',
    hand_before: ghostHandBeforeForSnapshot(input.snapshot, Boolean(input.useTupleHandFormat)),
    score_delta: 0,
    forced_draw: false,
  };
}

export function buildGhostPassMoveLogEntry(input: {
  moveCounter: number;
  handNumber: number;
  snapshot: PlayerMoveSnapshot;
  useTupleHandFormat?: boolean;
}): GhostMoveLogEntry {
  return {
    turn: input.moveCounter,
    hand_number: input.handNumber,
    actor: 'you',
    board_state: input.snapshot.boardStateKey,
    tile_played: null,
    branch: 'pass',
    hand_before: ghostHandBeforeForSnapshot(input.snapshot, Boolean(input.useTupleHandFormat)),
    score_delta: 0,
    forced_draw: false,
  };
}