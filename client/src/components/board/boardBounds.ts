// client/src/components/board/boardBounds.ts
//
// Exact layout bounds: the envelope of every placed tile and every drop-zone footprint
// the board could show, plus a small margin. The default bounds pad each side by a flat
// 2.5 layout units so the zones stay on screen, which on a short phone viewport spends
// ~5 of ~10 available units of height on air. The envelope keeps the guarantee that
// matters (a drop zone is never clipped by the board container, so it stays tappable)
// and drops the waste.
//
// The envelope is taken over ALL open-end positions and over both pending-tile kinds
// (ordinary / double), so it does not change when the player selects a tile: the camera
// fit stays stable across selection exactly as the flat pad did.
import type { BoardState, PlacementPosition } from '../../types';
import type { BoardLayout, BoardLayoutOptions } from './boardLayoutTypes';

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Every position a tile could be placed at on this board. */
export function allOpenEndPositions(board: BoardState): PlacementPosition[] {
  const positions: PlacementPosition[] = ['left', 'right'];
  for (const hub of board.hubDoubles ?? []) {
    if (typeof hub.hubId !== 'number' || !hub.isCrossed) continue;
    positions.push(`branch-${hub.hubId}-0` as PlacementPosition, `branch-${hub.hubId}-1` as PlacementPosition);
  }
  return positions;
}

/** A tile's footprint in layout units: rotation 0 lies along x for every tile, doubles included. */
function tileHalfExtent(rotation: number): { halfW: number; halfH: number } {
  return rotation === 0 ? { halfW: 1, halfH: 0.5 } : { halfW: 0.5, halfH: 1 };
}

export function envelopeOf(layouts: readonly Pick<BoardLayout, 'tiles' | 'zones'>[], marginUnits: number): LayoutBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const layout of layouts) {
    for (const tile of layout.tiles) {
      const { halfW, halfH } = tileHalfExtent(tile.rotation);
      minX = Math.min(minX, tile.x - halfW);
      maxX = Math.max(maxX, tile.x + halfW);
      minY = Math.min(minY, tile.y - halfH);
      maxY = Math.max(maxY, tile.y + halfH);
    }
    for (const zone of layout.zones) {
      minX = Math.min(minX, zone.x - zone.width / 2);
      maxX = Math.max(maxX, zone.x + zone.width / 2);
      minY = Math.min(minY, zone.y - zone.height / 2);
      maxY = Math.max(maxY, zone.y + zone.height / 2);
    }
  }
  return { minX: minX - marginUnits, maxX: maxX + marginUnits, minY: minY - marginUnits, maxY: maxY + marginUnits };
}

/**
 * computeBoardLayout with `exactBoundsMarginUnits` set: the same tiles and zones, with the bounds
 * replaced by the exact envelope of every tile and every zone the board could show (all open ends,
 * ordinary and double pending tile), so selecting a tile does not move the camera fit.
 * `layoutFn` is computeBoardLayout, passed in so this file never imports boardLayout.ts.
 */
export function computeBoundedLayout(
  board: BoardState,
  validPositions: PlacementPosition[],
  options: BoardLayoutOptions,
  layoutFn: (board: BoardState, validPositions: PlacementPosition[], options: BoardLayoutOptions) => BoardLayout,
): BoardLayout {
  const { exactBoundsMarginUnits = 0, ...routing } = options;
  const layout = layoutFn(board, validPositions, routing);
  const everyZone = allOpenEndPositions(board);
  const passes = [false, true].map((pendingTileIsDouble) =>
    layoutFn(board, everyZone, { ...routing, pendingTileIsDouble }),
  );
  const bounds = envelopeOf(passes, exactBoundsMarginUnits);
  return { ...layout, ...bounds, dropZoneFootprints: passes.flatMap((pass) => pass.zones) };
}
