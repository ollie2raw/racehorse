import type { BoardState, BranchArm, GameState, HubDouble, PlacedTile } from '../types';

function isPlacedTile(value: unknown): value is PlacedTile {
  if (!value || typeof value !== 'object') return false;
  const placed = value as Partial<PlacedTile>;
  const tile = placed.tile;
  return (
    tile != null &&
    typeof tile === 'object' &&
    typeof tile.low === 'number' &&
    typeof tile.high === 'number' &&
    typeof placed.orientation === 'string'
  );
}

function coerceBranchArm(raw: unknown, hubValue: number): BranchArm {
  if (raw && typeof raw === 'object') {
    const arm = raw as Partial<BranchArm>;
    const tiles = Array.isArray(arm.tiles) ? arm.tiles.filter(isPlacedTile) : [];
    return {
      openEnd: typeof arm.openEnd === 'number' ? arm.openEnd : hubValue,
      openEndIsDouble: typeof arm.openEndIsDouble === 'boolean' ? arm.openEndIsDouble : false,
      tiles,
    };
  }
  return { tiles: [], openEnd: hubValue, openEndIsDouble: false };
}

/** Canonical Racehorse board projection — always yields two branch arms with tile arrays. */
export function projectRenderableBoard(board: unknown): BoardState | null {
  if (!board || typeof board !== 'object') return null;
  const b = board as Partial<BoardState>;
  if (!Array.isArray(b.mainLine) || !b.mainLine.every(isPlacedTile)) return null;
  if (!Array.isArray(b.hubDoubles)) return null;

  const hubDoubles: HubDouble[] = b.hubDoubles
    .filter((hub): hub is HubDouble => hub != null && typeof hub === 'object')
    .map((hub) => {
      const hubValue = typeof hub.hubValue === 'number' ? hub.hubValue : 0;
      const branchesRaw = Array.isArray(hub.branches) ? hub.branches : [];
      const branches: BranchArm[] = [0, 1].map((armIdx) =>
        coerceBranchArm(branchesRaw[armIdx], hubValue),
      );
      return { ...hub, branches };
    });

  return {
    mainLine: b.mainLine,
    leftEnd: typeof b.leftEnd === 'number' ? b.leftEnd : 0,
    rightEnd: typeof b.rightEnd === 'number' ? b.rightEnd : 0,
    leftEndIsDouble: Boolean(b.leftEndIsDouble),
    rightEndIsDouble: Boolean(b.rightEndIsDouble),
    hubDoubles,
  };
}

/** Non-null boards must expose mainLine/hubDoubles and every branch arm must own a tiles array (Racehorse projection contract). */
export function isRenderableNonNullBoard(board: unknown): board is BoardState {
  const projected = projectRenderableBoard(board);
  return projected !== null && isRenderableNonNullBoardShape(projected);
}

function isRenderableNonNullBoardShape(board: BoardState): boolean {
  if (!Array.isArray(board.mainLine)) return false;
  if (!Array.isArray(board.hubDoubles)) return false;

  for (const hub of board.hubDoubles) {
    if (!hub || typeof hub !== 'object') return false;
    if (!Array.isArray(hub.branches) || hub.branches.length < 2) return false;
    for (let armIdx = 0; armIdx < 2; armIdx += 1) {
      const arm = hub.branches[armIdx];
      if (arm == null || typeof arm !== 'object') return false;
      if (!Array.isArray(arm.tiles)) return false;
    }
  }

  return true;
}

/** Hydrate authoritative multiplayer snapshots to the render contract before React state. */
export function projectMultiplayerGameState(state: GameState): GameState | null {
  if (!state || typeof state !== 'object') return null;
  if (!Array.isArray(state.playerIds)) return null;
  if (typeof state.players !== 'object' || state.players === null) return null;

  const raw = state as unknown as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(raw, 'board')) return null;

  const boardVal = raw.board;
  if (boardVal === null) return state;
  if (boardVal === undefined) return null;

  const projectedBoard = projectRenderableBoard(boardVal);
  if (!projectedBoard || !isRenderableNonNullBoardShape(projectedBoard)) return null;

  return { ...state, board: projectedBoard };
}

/** Full snapshot shape check before applying authoritative multiplayer payloads. */
export function isRenderableMultiplayerSnapshot(state: GameState): boolean {
  return projectMultiplayerGameState(state) !== null;
}
