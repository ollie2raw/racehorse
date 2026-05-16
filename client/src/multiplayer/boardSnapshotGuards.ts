import type { BoardState, GameState } from '../types';

/** Non-null boards must expose mainLine/hubDoubles and every branch arm must own a tiles array (Racehorse projection contract). */
export function isRenderableNonNullBoard(board: unknown): board is BoardState {
  if (!board || typeof board !== 'object') return false;
  const b = board as Partial<BoardState>;
  if (!Array.isArray(b.mainLine)) return false;
  if (!Array.isArray(b.hubDoubles)) return false;

  for (const hub of b.hubDoubles) {
    if (!hub || typeof hub !== 'object') return false;
    if (!Array.isArray(hub.branches)) return false;
    for (const arm of hub.branches) {
      if (arm == null || typeof arm !== 'object') return false;
      if (!Array.isArray((arm as { tiles?: unknown }).tiles)) return false;
    }
  }

  return true;
}

/** Full snapshot shape check before applying authoritative multiplayer payloads. */
export function isRenderableMultiplayerSnapshot(state: GameState): boolean {
  if (!state || typeof state !== 'object') return false;
  if (!Array.isArray(state.playerIds)) return false;
  if (typeof state.players !== 'object' || state.players === null) return false;

  const raw = state as unknown as Record<string, unknown>;

  const boardVal = Object.prototype.hasOwnProperty.call(raw, 'board')
    ? raw.board
    : undefined;
  if (boardVal === undefined) return false;

  return boardVal === null || isRenderableNonNullBoard(boardVal);
}
