/**
 * Deterministic scatter layout for the 28-tile pre-game draw.
 *
 * Positions are stable for a given ordered tile-id list (shuffle order from draw state).
 */

const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));
const CENTER_PCT = 50;
/** Keep tile centers inside the board; leaves room for tile size + rotation. */
const EDGE_INSET_PCT = 11;
const MAX_RADIUS_PCT = 38;
const JITTER_PCT = 3;

export interface PreGameDrawScatterPosition {
  tileId: string;
  /** Tile center, percent of board width. */
  leftPct: number;
  /** Tile center, percent of board height. */
  topPct: number;
  rotationDeg: number;
  zIndex: number;
}

function hashTileId(tileId: string): number {
  let hash = 0;
  for (let i = 0; i < tileId.length; i++) {
    hash = (hash * 31 + tileId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function clampPct(value: number): number {
  return Math.min(100 - EDGE_INSET_PCT, Math.max(EDGE_INSET_PCT, value));
}

/**
 * Vogel / golden-angle spiral from board center, plus per-tile deterministic jitter
 * and rotation from tile id hash. Earlier indices sit nearer center; later indices
 * ring outward — reads as “thrown on the table” without overlapping stacks.
 */
export function computePreGameDrawScatterPositions(
  tileIds: readonly string[],
): PreGameDrawScatterPosition[] {
  const count = tileIds.length;
  if (count === 0) return [];

  return tileIds.map((tileId, index) => {
    const angle = index * GOLDEN_ANGLE_RAD;
    const radiusNorm = Math.sqrt((index + 0.5) / count);
    const radius = radiusNorm * MAX_RADIUS_PCT;

    const hash = hashTileId(tileId);
    const jitterX = ((hash % 1000) / 1000 - 0.5) * 2 * JITTER_PCT;
    const jitterY = (((hash >> 10) % 1000) / 1000 - 0.5) * 2 * JITTER_PCT;
    const rotationDeg = (hash % 57) - 28;

    const leftPct = clampPct(CENTER_PCT + Math.cos(angle) * radius + jitterX);
    const topPct = clampPct(CENTER_PCT + Math.sin(angle) * radius + jitterY);

    return {
      tileId,
      leftPct,
      topPct,
      rotationDeg,
      zIndex: 10 + index,
    };
  });
}
