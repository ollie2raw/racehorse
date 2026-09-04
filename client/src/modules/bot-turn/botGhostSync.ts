import type { GhostMoveLogEntry, GhostResolvedMove } from '../ghost/ghostContracts.ts';
import { toTileKey } from '../../game/tileKeys.ts';

export function buildBotGhostDrawEntry(input: {
  turn: number;
  handNumber: number;
  boardStateKey: string;
  handBefore: string[];
  /** See buildGhostDrawMoveLogEntry (player-turn/playerGhostSync.ts) — same
   * per-draw entry discipline, kept symmetric for consistency even though
   * verifyPlayerMoveLog currently skips actor:'ghost' entries entirely, so
   * this side never caused RT-2's verification failures on its own. */
  drawnTile?: { low: number; high: number } | null;
}): GhostMoveLogEntry {
  return {
    turn: input.turn,
    hand_number: input.handNumber,
    actor: 'ghost',
    board_state: input.boardStateKey,
    tile_played: null,
    branch: 'draw',
    hand_before: input.handBefore,
    score_delta: 0,
    forced_draw: false,
    drawn_tile: input.drawnTile ? toTileKey(input.drawnTile) : null,
  };
}

export function buildBotGhostPassEntry(input: {
  turn: number;
  handNumber: number;
  boardStateKey: string;
  handBefore: string[];
}): GhostMoveLogEntry {
  return {
    turn: input.turn,
    hand_number: input.handNumber,
    actor: 'ghost',
    board_state: input.boardStateKey,
    tile_played: null,
    branch: 'pass',
    hand_before: input.handBefore,
    score_delta: 0,
    forced_draw: false,
  };
}

export function buildBotGhostPlayEntry(input: {
  turn: number;
  handNumber: number;
  boardStateKey: string;
  handBefore: string[];
  ghostChosen: GhostResolvedMove;
  scoreDelta: number;
  forcedDraw: boolean;
}): GhostMoveLogEntry {
  return {
    turn: input.turn,
    hand_number: input.handNumber,
    actor: 'ghost',
    board_state: input.boardStateKey,
    tile_played: toTileKey(input.ghostChosen.tile),
    branch: input.ghostChosen.position,
    hand_before: input.handBefore,
    score_delta: input.scoreDelta,
    forced_draw: input.forcedDraw,
  };
}