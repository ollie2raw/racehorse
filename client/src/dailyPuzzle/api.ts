// Board-state normalization for legacy daily-puzzle payloads. The ladder/
// leaderboard client was removed (CODE_QUALITY_PLAN.md §CQ9.1.6 + D-CQ-5);
// `normalizeBoardState` stays — used by learn/engine/rulesAdapter.ts.
import { hydrateBoardForOpenEnds } from '../game/openEndsGeometry';
import type { BoardState, BranchArm, PlacedTile, Tile, TileOrientation } from '../types';

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== 'object') return false;
  const v = value as { low?: unknown; high?: unknown };
  return Number.isInteger(v.low) && Number.isInteger(v.high);
}

function normalizeTile(value: unknown): Tile | null {
  if (Array.isArray(value) && value.length === 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }

  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const lowRaw = rec.low ?? rec.left;
  const highRaw = rec.high ?? rec.right;
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isInteger(low) || !Number.isInteger(high)) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function normalizeOrientation(
  value: unknown,
  fallback: 'horizontal-normal' | 'vertical-normal',
): TileOrientation {
  if (
    value === 'horizontal-normal' ||
    value === 'horizontal-flipped' ||
    value === 'vertical-normal' ||
    value === 'vertical-flipped'
  ) {
    return value;
  }
  return fallback;
}

function normalizePlacement(
  value: unknown,
  defaultOrientation: 'horizontal-normal' | 'vertical-normal',
): { tile: Tile; orientation: TileOrientation } | null {
  if (!value || typeof value !== 'object') {
    const directTile = normalizeTile(value);
    return directTile
      ? { tile: directTile, orientation: defaultOrientation }
      : null;
  }

  const rec = value as Record<string, unknown>;
  const tile = normalizeTile(rec.tile ?? rec);
  if (!tile) return null;
  return {
    tile,
    orientation: normalizeOrientation(rec.orientation, defaultOrientation),
  };
}

function endpointFromPlacement(placement: { tile: Tile; orientation: TileOrientation }, side: 'left' | 'right'): number {
  const { tile, orientation } = placement;
  if (tile.low === tile.high) return tile.high;
  if (orientation.endsWith('flipped')) {
    return side === 'left' ? tile.high : tile.low;
  }
  return side === 'left' ? tile.low : tile.high;
}

function isBoardState(value: unknown): value is BoardState {
  if (!value || typeof value !== 'object') return false;
  const board = value as BoardState;

  const placementsValid =
    Array.isArray(board.mainLine) &&
    board.mainLine.every(
      (placement) =>
        Boolean(placement) && isTile(placement.tile) && typeof placement.orientation === 'string',
    );
  const hubsValid =
    Array.isArray(board.hubDoubles) &&
    board.hubDoubles.every(
      (hub) =>
        Array.isArray(hub.branches) &&
        hub.branches.every(
          (branch: BranchArm | null) =>
            !branch ||
            (Array.isArray(branch.tiles) &&
              branch.tiles.every(
                (placement: PlacedTile) =>
                  Boolean(placement) &&
                  isTile(placement.tile) &&
                  typeof placement.orientation === 'string',
              )),
        ),
    );

  return (
    placementsValid &&
    typeof board.leftEnd === 'number' &&
    typeof board.rightEnd === 'number' &&
    typeof board.leftEndIsDouble === 'boolean' &&
    typeof board.rightEndIsDouble === 'boolean' &&
    hubsValid
  );
}

export function normalizeBoardState(raw: unknown): BoardState | null {
  if (typeof raw === 'string') {
    try {
      return normalizeBoardState(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const board = raw as Record<string, unknown>;
  const mainLineRaw = Array.isArray(board.mainLine)
    ? board.mainLine
    : Array.isArray(board.main_line)
      ? board.main_line
      : null;

  if (!mainLineRaw) {
    return null;
  }

  const mainLine = mainLineRaw.map((placement) =>
    normalizePlacement(placement, 'horizontal-normal'),
  );
  if (mainLine.some((placement) => !placement) || mainLine.length === 0) return null;

  const hubDoublesRaw = Array.isArray(board.hubDoubles)
    ? board.hubDoubles
    : Array.isArray(board.hub_doubles)
      ? board.hub_doubles
      : [];
  const hubDoubles = hubDoublesRaw.map((hubRaw, hubIdx) => {
    if (!hubRaw || typeof hubRaw !== 'object') return null;
    const hub = hubRaw as Record<string, unknown>;
    const hubValueFallback = mainLine[0]?.tile.high ?? 0;
    const branchesRaw = Array.isArray(hub.branches) ? hub.branches : [];

    const branches = branchesRaw.map((branchRaw) => {
      if (!branchRaw || typeof branchRaw !== 'object') return null;
      const branch = branchRaw as Record<string, unknown>;
      const tilesRaw = Array.isArray(branch.tiles) ? branch.tiles : [];
      const tiles = tilesRaw
        .map((placement) => normalizePlacement(placement, 'vertical-normal'))
        .filter((placement): placement is { tile: Tile; orientation: TileOrientation } =>
          Boolean(placement),
        );
      const last = tiles[tiles.length - 1] ?? null;
      return {
        ...branch,
        openEnd:
          typeof branch.openEnd === 'number'
            ? branch.openEnd
            : last
              ? endpointFromPlacement(last, 'right')
              : typeof hub.hubValue === 'number'
                ? hub.hubValue
                : hubValueFallback,
        openEndIsDouble:
          typeof branch.openEndIsDouble === 'boolean'
            ? branch.openEndIsDouble
            : Boolean(last && last.tile.low === last.tile.high),
        tiles,
      };
    });
    return {
      ...hub,
      tileIndex: Number.isInteger(hub.tileIndex) ? Number(hub.tileIndex) : hubIdx,
      hubValue: typeof hub.hubValue === 'number' ? hub.hubValue : hubValueFallback,
      isCrossed:
        typeof hub.isCrossed === 'boolean'
          ? hub.isCrossed
          : Boolean(hub.leftSideFilled && hub.rightSideFilled),
      branches: branches as BoardState['hubDoubles'][number]['branches'],
    } as BoardState['hubDoubles'][number];
  });

  if (hubDoubles.some((hub) => !hub)) return null;
  const firstPlacement = mainLine[0] as { tile: Tile; orientation: TileOrientation };
  const lastPlacement = mainLine[mainLine.length - 1] as { tile: Tile; orientation: TileOrientation };
  const leftEnd = typeof board.leftEnd === 'number' ? board.leftEnd : endpointFromPlacement(firstPlacement, 'left');
  const rightEnd =
    typeof board.rightEnd === 'number' ? board.rightEnd : endpointFromPlacement(lastPlacement, 'right');
  const leftEndIsDouble =
    typeof board.leftEndIsDouble === 'boolean'
      ? board.leftEndIsDouble
      : firstPlacement.tile.low === firstPlacement.tile.high;
  const rightEndIsDouble =
    typeof board.rightEndIsDouble === 'boolean'
      ? board.rightEndIsDouble
      : lastPlacement.tile.low === lastPlacement.tile.high;

  const normalized: BoardState = {
    mainLine: mainLine as BoardState['mainLine'],
    leftEnd,
    rightEnd,
    leftEndIsDouble,
    rightEndIsDouble,
    hubDoubles: hubDoubles as BoardState['hubDoubles'],
  };

  return isBoardState(normalized) ? hydrateBoardForOpenEnds(normalized) : null;
}

