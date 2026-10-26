// client/src/components/board/boardQualityMetrics.ts
//
// Pass 0 of the board camera programme: a pure, browser-free way to MEASURE how the
// live board looks and moves, so every later change is judged by numbers rather than
// by eye. It replays a sequence of board states through the real layout engine and
// the real camera fit rules (boardCameraFit.ts) for a viewport profile, and reports,
// per placed tile:
//
//   - tileShortEdgePx   on-screen size of a tile's short edge (readability; pips are
//                       drawn inside it)
//   - overflow          the fit wanted a scale below the camera's floor, so the board
//                       is larger than its container (arms run off screen)
//   - maxTileJumpPx     the largest screen-space move of any already-placed tile when
//                       the next tile arrived (scale change + recentre + re-routing)
//   - reflowedTiles     already-placed tiles whose own layout coordinates changed
//                       (routing moved them; recentring does not count)
//   - scaleStepPct      how much the camera scale changed on that placement
//
// The container sizes are the measured board-container sizes from the browser
// geometry report (e2e/board-routing-geometry.spec.ts); the tile size is the
// `tileSize={84}` LiveMatchScreen passes to Board. Not imported by the app.
import type { BoardState } from '../../types';
import { resolveBoardFitTargets } from './boardCameraFit';
import { calculateBoardFitScale, computeBoardLayout, type BoardLayout, type BoardLayoutOptions } from './boardLayout';
import { resolveVerticalArmExtent } from './boardRouting';

/** LiveMatchScreen's `tileSize` for the live board (px per layout unit at camera scale 1). */
export const BOARD_UNIT_PX = 84;

export interface ViewportProfile {
  name: string;
  containerWidth: number;
  containerHeight: number;
  /** Short, wide landscape viewport: tile-count routing and the lower camera floor. */
  phoneLandscape: boolean;
}

export const VIEWPORT_PROFILES: readonly ViewportProfile[] = [
  { name: 'desktop-1512x982', containerWidth: 1456, containerHeight: 756, phoneLandscape: false },
  { name: 'laptop-1280x720', containerWidth: 1224, containerHeight: 508, phoneLandscape: false },
  { name: 'phone-932x430', containerWidth: 876, containerHeight: 244, phoneLandscape: true },
  { name: 'phone-844x390', containerWidth: 824, containerHeight: 204, phoneLandscape: true },
];

/** Mirrors useBoardRenderLayout: phones bend by tile count, everything else by measured reach. */
export function layoutOptionsFor(profile: ViewportProfile): BoardLayoutOptions {
  if (profile.phoneLandscape) return { maxVerticalArmTiles: 2 };
  const maxVerticalArmExtent = resolveVerticalArmExtent(profile.containerHeight);
  return maxVerticalArmExtent === undefined ? {} : { maxVerticalArmExtent };
}

/** Mirrors Board.tsx: `containFullBoard ? 0.08 : shortViewport && !staticView ? 0.14 : 0.22`. */
export function cameraFloorFor(profile: ViewportProfile): number {
  return profile.phoneLandscape ? 0.14 : 0.22;
}

export interface CameraFit {
  scale: number;
  /** The scale the fit asked for before the camera floor was applied. */
  rawScale: number;
  overflowed: boolean;
}

/** The live (non-static, default-fit-mode) camera fit for a layout in a profile's container. */
export function modelCameraFit(layout: BoardLayout, tileCount: number, profile: ViewportProfile): CameraFit {
  const layoutSpanUnits = Math.max(layout.maxX - layout.minX, layout.maxY - layout.minY);
  const { targetFill, maxFitScale } = resolveBoardFitTargets({
    containFullBoard: false,
    resolvedFitMode: 'default',
    layoutSpanUnits,
    boardTileCount: tileCount,
  });
  const floor = cameraFloorFor(profile);
  const common = {
    layout,
    tileSize: BOARD_UNIT_PX,
    viewportWidth: profile.containerWidth,
    viewportHeight: profile.containerHeight,
    targetFill,
  };
  const rawScale = calculateBoardFitScale({ ...common, minScale: 0, maxScale: maxFitScale });
  const scale = calculateBoardFitScale({ ...common, minScale: floor, maxScale: maxFitScale });
  return { scale, rawScale, overflowed: rawScale < floor - 1e-9 };
}

export function countBoardTiles(board: BoardState | null): number {
  if (!board) return 0;
  return (
    board.mainLine.length +
    board.hubDoubles.reduce(
      (sum, hub) => sum + (hub.branches ?? []).reduce((s, branch) => s + (branch?.tiles?.length ?? 0), 0),
      0,
    )
  );
}

export interface PlacementSample {
  tileCount: number;
  scale: number;
  tileShortEdgePx: number;
  overflowed: boolean;
  /** Board extent over container extent along the worse axis, at the fitted scale (1.0 = exactly fills it). */
  fillRatio: number;
  /** Largest screen-space move of an already-placed tile caused by this placement. 0 for the first tile. */
  maxTileJumpPx: number;
  reflowedTiles: number;
  scaleStepPct: number;
  bends: number;
}

const EPS = 1e-6;

function screenPositions(layout: BoardLayout, scale: number): Map<string, { x: number; y: number }> {
  const cx = (layout.minX + layout.maxX) / 2;
  const cy = (layout.minY + layout.maxY) / 2;
  const out = new Map<string, { x: number; y: number }>();
  for (const t of layout.tiles) out.set(t.key, { x: (t.x - cx) * BOARD_UNIT_PX * scale, y: (t.y - cy) * BOARD_UNIT_PX * scale });
  return out;
}

/**
 * How many already-placed tiles the next layout moved RELATIVE to the rest of the board.
 * The layout's coordinate origin can shift as tiles are added; that moves every tile by
 * the same vector and is not re-routing, so the most common displacement is treated as
 * that shift and only tiles that differ from it (or changed rotation) are counted.
 */
export function countReflowed(before: BoardLayout, after: BoardLayout): number {
  const prevTiles = new Map(before.tiles.map((t) => [t.key, t]));
  const moves: Array<{ dx: number; dy: number; rotated: boolean }> = [];
  for (const t of after.tiles) {
    const old = prevTiles.get(t.key);
    if (old) moves.push({ dx: t.x - old.x, dy: t.y - old.y, rotated: old.rotation !== t.rotation });
  }
  if (moves.length === 0) return 0;
  const buckets = new Map<string, number>();
  for (const m of moves) {
    const bucket = `${Math.round(m.dx / EPS)}|${Math.round(m.dy / EPS)}`;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
  }
  let common = '';
  let commonCount = 0;
  for (const [bucket, count] of buckets) {
    if (count > commonCount) {
      common = bucket;
      commonCount = count;
    }
  }
  return moves.filter((m) => m.rotated || `${Math.round(m.dx / EPS)}|${Math.round(m.dy / EPS)}` !== common).length;
}

/**
 * Measures one hand's worth of consecutive board states. Only states where the tile
 * count grew are placements (draws and passes leave the board alone).
 */
export function measureHand(boards: readonly BoardState[], profile: ViewportProfile): PlacementSample[] {
  const options = layoutOptionsFor(profile);
  const samples: PlacementSample[] = [];
  let prev: { layout: BoardLayout; scale: number; count: number } | null = null;
  for (const board of boards) {
    const count = countBoardTiles(board);
    if (count === 0) continue;
    if (prev && count <= prev.count) continue;
    const layout = computeBoardLayout(board, [], options);
    const fit = modelCameraFit(layout, count, profile);
    let maxTileJumpPx = 0;
    let reflowedTiles = 0;
    if (prev) {
      const before = screenPositions(prev.layout, prev.scale);
      const after = screenPositions(layout, fit.scale);
      const prevTiles = new Map(prev.layout.tiles.map((t) => [t.key, t]));
      reflowedTiles = countReflowed(prev.layout, layout);
      for (const t of layout.tiles) {
        if (!prevTiles.has(t.key)) continue;
        const a = before.get(t.key);
        const b = after.get(t.key);
        if (a && b) maxTileJumpPx = Math.max(maxTileJumpPx, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    const widthPx = (layout.maxX - layout.minX) * BOARD_UNIT_PX * fit.scale;
    const heightPx = (layout.maxY - layout.minY) * BOARD_UNIT_PX * fit.scale;
    samples.push({
      tileCount: count,
      scale: fit.scale,
      tileShortEdgePx: fit.scale * BOARD_UNIT_PX,
      overflowed: fit.overflowed,
      fillRatio: Math.max(widthPx / profile.containerWidth, heightPx / profile.containerHeight),
      maxTileJumpPx,
      reflowedTiles,
      scaleStepPct: prev ? (Math.abs(fit.scale - prev.scale) / prev.scale) * 100 : 0,
      bends: layout.bends.length,
    });
    prev = { layout, scale: fit.scale, count };
  }
  return samples;
}

// ─── aggregation ─────────────────────────────────────────────

export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.round((p / 100) * (sortedAscending.length - 1))));
  return sortedAscending[index];
}

export interface QualitySummary {
  placements: number;
  /** Short-edge px of tiles across all placements. */
  tileEdgeP5: number;
  tileEdgeP50: number;
  tileEdgeMin: number;
  /** Share of placements whose short edge is under each readability candidate (px). */
  underPx: Record<number, number>;
  overflowShare: number;
  jumpP50: number;
  jumpP95: number;
  jumpMax: number;
  /** Share of placements in which any already-placed tile moved by > 40 screen px. */
  bigJumpShare: number;
  reflowShare: number;
  scaleStepP95: number;
  scaleStepMax: number;
}

export const READABILITY_CANDIDATES_PX = [12, 16, 20, 24] as const;
const BIG_JUMP_PX = 40;

export function summarize(samples: readonly PlacementSample[]): QualitySummary {
  const n = samples.length;
  const share = (count: number) => (n === 0 ? 0 : count / n);
  const edges = samples.map((s) => s.tileShortEdgePx).sort((a, b) => a - b);
  const jumps = samples.map((s) => s.maxTileJumpPx).sort((a, b) => a - b);
  const steps = samples.map((s) => s.scaleStepPct).sort((a, b) => a - b);
  return {
    placements: n,
    tileEdgeP5: percentile(edges, 5),
    tileEdgeP50: percentile(edges, 50),
    tileEdgeMin: edges[0] ?? 0,
    underPx: Object.fromEntries(
      READABILITY_CANDIDATES_PX.map((px) => [px, share(samples.filter((s) => s.tileShortEdgePx < px).length)]),
    ),
    overflowShare: share(samples.filter((s) => s.overflowed).length),
    jumpP50: percentile(jumps, 50),
    jumpP95: percentile(jumps, 95),
    jumpMax: jumps[jumps.length - 1] ?? 0,
    bigJumpShare: share(samples.filter((s) => s.maxTileJumpPx > BIG_JUMP_PX).length),
    reflowShare: share(samples.filter((s) => s.reflowedTiles > 0).length),
    scaleStepP95: percentile(steps, 95),
    scaleStepMax: steps[steps.length - 1] ?? 0,
  };
}
