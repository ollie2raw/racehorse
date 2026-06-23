export type TrailPoint = { x: number; y: number };

export type Chapter1TrailLayout = {
  positions: TrailPoint[];
  pathD: string;
  viewBox: string;
  rowCount: number;
};

/**
 * Chapter 1 — premium 3-lane campaign ladder (viewBox 0–100).
 * Tile-center coordinates on fixed horizontal lanes with rounded serpentine turns.
 *
 * Row 1:  1 →  2 →  3 →  4
 * Turn ↓ at node 4
 * Row 2:  5 ←  6 ←  7 ←  8
 * Turn ↓ at node 8
 * Row 3:  9 → 10 → 11 → 12 boss
 *
 * Path y values track tile centers inside the 4×3 grid rows.
 */
export const CHAPTER_1_NODE_CENTERS: TrailPoint[] = [
  { x: 14, y: 16 },
  { x: 36, y: 16 },
  { x: 58, y: 16 },
  { x: 80, y: 16 },
  { x: 80, y: 50 },
  { x: 58, y: 50 },
  { x: 36, y: 50 },
  { x: 14, y: 50 },
  { x: 14, y: 84 },
  { x: 36, y: 84 },
  { x: 58, y: 84 },
  { x: 80, y: 84 },
];

export const CHAPTER_1_TILE_ANCHOR_PX = 40;
export const CHAPTER_1_BOSS_TILE_ANCHOR_PX = 38;

/**
 * Continuous ladder track through tile centers.
 * Orthogonal segments; round line joins render smooth row turns.
 */
export const CHAPTER_1_TRAIL_PATH = [
  'M 14 16',
  'L 36 16',
  'L 58 16',
  'L 88 16',
  'L 88 50',
  'L 58 50',
  'L 36 50',
  'L 14 50',
  'L 14 84',
  'L 36 84',
  'L 58 84',
  'L 88 84',
].join(' ');

export function buildChapter1TrailLayout(): Chapter1TrailLayout {
  return {
    positions: CHAPTER_1_NODE_CENTERS.map((point) => ({ ...point })),
    pathD: CHAPTER_1_TRAIL_PATH,
    viewBox: '0 0 100 100',
    rowCount: 3,
  };
}

export function getChapter1TileAnchorPx(nodeIndex: number): number {
  return nodeIndex === 11 ? CHAPTER_1_BOSS_TILE_ANCHOR_PX : CHAPTER_1_TILE_ANCHOR_PX;
}

/** Explicit 4×3 grid placement for the campaign ladder (1-indexed). */
export const CHAPTER_1_GRID_PLACEMENTS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 1, row: 1 },
  { col: 2, row: 1 },
  { col: 3, row: 1 },
  { col: 4, row: 1 },
  { col: 4, row: 2 },
  { col: 3, row: 2 },
  { col: 2, row: 2 },
  { col: 1, row: 2 },
  { col: 1, row: 3 },
  { col: 2, row: 3 },
  { col: 3, row: 3 },
  { col: 4, row: 3 },
];

export function getChapter1GridPlacement(nodeIndex: number): { col: number; row: number } {
  return CHAPTER_1_GRID_PLACEMENTS[nodeIndex] ?? { col: 1, row: 1 };
}
