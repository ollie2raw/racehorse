// ─── Tile ───────────────────────────────────────────────────

export interface Tile {
  readonly high: number;
  readonly low: number;
}

export function tileEquals(a: Tile, b: Tile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

export function isDouble(tile: Tile): boolean {
  return tile.high === tile.low;
}

export function tileId(tile: Tile): string {
  return `[${tile.low}|${tile.high}]`;
}

export function tileMatchesEnd(tile: Tile, endValue: number): boolean {
  return tile.high === endValue || tile.low === endValue;
}

export function totalTilesInSet(maxPips: number): number {
  return ((maxPips + 1) * (maxPips + 2)) / 2;
}

export function tilePips(tile: Tile): number {
  return tile.high + tile.low;
}

// ─── Config ──────────────────────────────────────────────────

export type BlockedHandRule = 'lowestPips' | 'noScore';
export type EndHandBonus = 'sumOpponentPenalties' | 'none';

export interface Config {
  readonly maxPips: number;
  readonly tilesPerPlayer: number;
  readonly deadTileCount: number;
  readonly scoringMultiple: number; // 5
  readonly blockedHandRule: BlockedHandRule;
  readonly endHandBonus: EndHandBonus;
  readonly winningScore: number; // 60
}

export const DEFAULT_CONFIG: Config = {
  maxPips: 6,
  tilesPerPlayer: 7,
  deadTileCount: 2,
  scoringMultiple: 5,
  blockedHandRule: 'lowestPips',
  endHandBonus: 'sumOpponentPenalties',
  winningScore: 60,
};

// ─── Player State ────────────────────────────────────────────

export interface PlayerState {
  readonly id: string;
  readonly hand: readonly Tile[];
  readonly score: number;
}

// ─── Placement Position ──────────────────────────────────────
// Represents where a tile can be placed on the board.
// - 'left': main line left end
// - 'right': main line right end
// - 'branch-{hubIndex}-{armIndex}': a specific branch arm off a hub double
//   hubIndex: the index of the hub double in the board's hubDoubles array
//   armIndex: 0 or 1 (max 2 branch arms per hub)

export type PlacementPosition = 'left' | 'right' | `branch-${number}-${number}`;

// ─── Moves ───────────────────────────────────────────────────

export interface PlayMove {
  readonly type: 'play';
  readonly tile: Tile;
  readonly position: PlacementPosition;
}

export interface PassMove {
  readonly type: 'pass';
}

export type Move = PlayMove | PassMove;

// ─── Placed Tile (with orientation) ──────────────────────────
// For rendering: tracks which pip faces which direction

export interface PlacedTile {
  readonly tile: Tile;
  readonly orientation: TileOrientation;
}

export type TileOrientation =
  | 'horizontal-normal' // low on left, high on right
  | 'horizontal-flipped' // high on left, low on right
  | 'vertical-normal' // low on top, high on bottom
  | 'vertical-flipped'; // high on top, low on bottom

// ─── Board State ─────────────────────────────────────────────
// The board is modeled as:
// 1. A main line (spine) with left and right ends
// 2. Hub doubles: doubles that have been "crossed" (a tile played through them)
//    - Each hub can spawn up to 2 branch arms
//    - Branches are independent chains extending from the hub

export interface BranchArm {
  readonly tiles: readonly PlacedTile[]; // tiles on this branch with orientation
  readonly openEnd: number; // exposed pip value at the end of this branch
  readonly openEndIsDouble: boolean; // whether the open end tile is a double
}

export interface HubDouble {
  readonly hubId?: number; // stable hub id
  readonly laneType?: 'mainline' | 'branch';
  readonly laneRef?: string;
  readonly branchDepth?: number;
  readonly tileIndex: number; // legacy index in mainLine where this double sits
  readonly mainlineIndex?: number; // preferred index in mainLine where this double sits
  readonly hubValue: number; // the pip value of the double (e.g., 3 for [3|3])
  readonly leftSideFilled?: boolean; // tile exists on the left side of this hub
  readonly rightSideFilled?: boolean; // tile exists on the right side of this hub
  readonly isCrossed: boolean; // true once both sides are filled
  readonly branches: readonly BranchArm[]; // 0-2 branch arms
}

export interface BoardState {
  readonly mainLine: readonly PlacedTile[]; // tiles on the main spine with orientation
  readonly leftEnd: number; // exposed left pip
  readonly rightEnd: number; // exposed right pip
  readonly leftEndIsDouble: boolean; // whether left end tile is a double
  readonly rightEndIsDouble: boolean; // whether right end tile is a double
  readonly hubDoubles: readonly HubDouble[]; // doubles that can/have spawned branches
}

// ─── Game State ──────────────────────────────────────────────

export interface GameState {
  readonly config: Config;
  readonly playerIds: readonly string[];
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly board: BoardState | null;
  readonly boneyard: readonly Tile[];
  readonly deadTiles: readonly Tile[];
  readonly currentPlayerIndex: number;
  readonly handNumber: number;
  readonly handOpen: boolean;
  readonly handOver: boolean;
  readonly gameOver: boolean;
  readonly winnerId: string | null;
  readonly consecutivePasses: number;
  readonly sequence: number;
  readonly __drawSequenceActive?: boolean;
}

// ─── Position Utilities ──────────────────────────────────────

export function parseBranchPosition(
  pos: PlacementPosition,
): { hubIndex: number; armIndex: number } | null {
  if (pos === 'left' || pos === 'right') return null;
  const match = pos.match(/^branch-(\d+)-(\d+)$/);
  if (!match) return null;
  return { hubIndex: parseInt(match[1], 10), armIndex: parseInt(match[2], 10) };
}

export function makeBranchPosition(hubIndex: number, armIndex: number): PlacementPosition {
  return `branch-${hubIndex}-${armIndex}`;
}

// Check if position is a main line position
export function isMainLinePosition(pos: PlacementPosition): pos is 'left' | 'right' {
  return pos === 'left' || pos === 'right';
}
