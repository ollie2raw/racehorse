// client/src/components/board/boardLayoutTypes.ts
//
// Shapes shared by the pure layout engine (boardLayout.ts) and the routing model
// (boardRouting.ts). Types only; boardLayout.ts re-exports them, so existing
// imports from './boardLayout' keep working.

import type { Tile, PlacementPosition } from '../../types';

export interface BoardLayoutTile {
  tile: Tile;
  x: number;
  y: number;
  rotation: number;
  flipped: boolean;
  key: string;
}

export interface LayoutZone {
  position: PlacementPosition;
  x: number;
  y: number;
  width: number;
  height: number;
  // Outward direction from endpoint center in layout lane coordinates.
  dirX: number;
  dirY: number;
  lane: 'horizontal' | 'vertical';
  key: string;
}

/** One visual corner: where an arm left its vertical lane. Routing metadata only. */
export interface BoardLayoutBend {
  hubId: number;
  arm: 0 | 1;
  /** Index within the arm of the first horizontal tile (the corner tile, never a double). */
  tileIndex: number;
  /** -1 = bends left, 1 = bends right. */
  dir: -1 | 1;
}

export interface BoardLayout {
  tiles: BoardLayoutTile[];
  zones: LayoutZone[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Every arm corner the routing produced (empty when all arms are straight). */
  bends: BoardLayoutBend[];
}

export interface BoardLayoutOptions {
  /**
   * Bend vertical branch arms sideways after this many tiles (a "corner", as
   * on a real table). Used where the board viewport is short and wide (phone
   * landscape) so long arms never outgrow it. Omitted = straight arms
   * (unchanged desktop/web layout).
   */
  maxVerticalArmTiles?: number;
  /**
   * Viewport-aware sibling of `maxVerticalArmTiles`: bend an arm once the next
   * ordinary tile would reach farther than this many layout units from the hub
   * centre (see boardRouting.ts for how the viewport produces it). Same corner
   * rules as the tile-count limit: a double never turns, so the turn waits for
   * the next ordinary tile that follows an ordinary tile.
   */
  maxVerticalArmExtent?: number;
  /** The tile being placed is a double: arm-end zones stay straight, since a double never turns the corner. */
  pendingTileIsDouble?: boolean;
}
