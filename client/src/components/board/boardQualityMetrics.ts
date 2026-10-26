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
import { clearScaleForReserved, type ReservedRect } from './boardCameraReserve';
import { cameraOf, createCameraSpring, isCameraSettled, stepCameraSpring, type CameraTarget } from './cameraSpring';
import { advanceWorldOrigin, boundsCenter, type WorldOrigin } from './boardWorldFrame';
import { resolveVerticalArmExtent } from './boardRouting';
import { SHORT_BOARD_EXACT_BOUNDS_MARGIN_UNITS, SHORT_BOARD_MAX_VERTICAL_ARM_TILES } from './useBoardRenderLayout';

/** The product's readability floor: the smallest a tile's short edge may be on screen (decided 2026-10-26). */
export const READABLE_FLOOR_PX = 18;

/** LiveMatchScreen's `tileSize` for the live board (px per layout unit at camera scale 1). */
export const BOARD_UNIT_PX = 84;

export interface ViewportProfile {
  name: string;
  containerWidth: number;
  containerHeight: number;
  /** Short, wide landscape viewport: tile-count routing and the lower camera floor. */
  phoneLandscape: boolean;
  /** Overlays on the container (controls tray, corner pills), container-local px, as measured in the browser. */
  reserved: readonly ReservedRect[];
}

const rect = (left: number, top: number, right: number, bottom: number): ReservedRect => ({ left, top, right, bottom });

export const VIEWPORT_PROFILES: readonly ViewportProfile[] = [
  { name: 'desktop-1512x982', containerWidth: 1456, containerHeight: 756, phoneLandscape: false, reserved: [] },
  { name: 'laptop-1280x720', containerWidth: 1224, containerHeight: 508, phoneLandscape: false, reserved: [] },
  {
    name: 'phone-932x430',
    containerWidth: 876,
    containerHeight: 244,
    phoneLandscape: true,
    reserved: [rect(668, 194, 864, 232), rect(769, 66, 862, 110), rect(770, 14, 862, 58)],
  },
  {
    name: 'phone-844x390',
    containerWidth: 824,
    containerHeight: 204,
    phoneLandscape: true,
    reserved: [rect(616, 154, 812, 192), rect(718, 66, 810, 110), rect(718, 14, 810, 58)],
  },
];

/** Mirrors useBoardRenderLayout: phones bend by tile count, everything else by measured reach. */
export function layoutOptionsFor(profile: ViewportProfile): BoardLayoutOptions {
  if (profile.phoneLandscape) {
    return {
      maxVerticalArmTiles: SHORT_BOARD_MAX_VERTICAL_ARM_TILES,
      exactBoundsMarginUnits: SHORT_BOARD_EXACT_BOUNDS_MARGIN_UNITS,
    };
  }
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
  /** The fit's target fill (share of the container the board should occupy). */
  targetFill: number;
}

/** The live (non-static, default-fit-mode) camera fit for a layout in a profile's container. */
export function modelCameraFit(layout: BoardLayout, tileCount: number, profile: ViewportProfile): CameraFit {
  const layoutSpanUnits = Math.max(layout.maxX - layout.minX, layout.maxY - layout.minY);
  const { targetFill, maxFitScale } = resolveBoardFitTargets({
    containFullBoard: false,
    resolvedFitMode: 'default',
    layoutSpanUnits,
    boardTileCount: tileCount,
    tightFit: profile.phoneLandscape,
  });
  const floor = cameraFloorFor(profile);
  const common = {
    layout,
    tileSize: BOARD_UNIT_PX,
    viewportWidth: profile.containerWidth,
    viewportHeight: profile.containerHeight,
    targetFill,
  };
  const unclamped = calculateBoardFitScale({ ...common, minScale: 0, maxScale: maxFitScale });
  const clear = (fitScale: number, minScale: number) =>
    profile.phoneLandscape
      ? clearScaleForReserved({
          layout,
          unitPx: BOARD_UNIT_PX,
          containerWidth: profile.containerWidth,
          containerHeight: profile.containerHeight,
          cameraX: 0,
          cameraY: 0,
          fitScale,
          minScale,
          reserved: profile.reserved,
        })
      : fitScale;
  const rawScale = clear(unclamped, 0);
  const scale = clear(calculateBoardFitScale({ ...common, minScale: floor, maxScale: maxFitScale }), floor);
  return { scale, rawScale, overflowed: rawScale < floor - 1e-9, targetFill };
}

const FRAME_S = 1 / 60;
const MAX_SIM_FRAMES = 240;

/**
 * Plays the spring camera from one placement's camera to the next at 60 fps and reports the largest
 * per-frame screen move of any tile that exists in both layouts (peak speed, the thing that reads as
 * "jerky"), plus how long the camera takes to settle. Tiles are positioned in the stable world frame,
 * so the camera alone moves them: screen = camera.xy + scale * world.
 */
export function simulateSpring(
  from: CameraTarget,
  to: CameraTarget,
  worldOfSurvivors: ReadonlyArray<{ x: number; y: number }>,
): { peakFramePx: number; settleMs: number } {
  let state = createCameraSpring(from);
  const at = (camera: CameraTarget) => worldOfSurvivors.map((w) => ({ x: camera.x + camera.scale * w.x, y: camera.y + camera.scale * w.y }));
  let previous = at(cameraOf(state));
  let peak = 0;
  let frames = 0;
  while (frames < MAX_SIM_FRAMES) {
    state = stepCameraSpring(state, to, FRAME_S);
    frames += 1;
    const current = at(cameraOf(state));
    for (let i = 0; i < current.length; i += 1) {
      peak = Math.max(peak, Math.hypot(current[i].x - previous[i].x, current[i].y - previous[i].y));
    }
    previous = current;
    if (isCameraSettled(state, to)) break;
  }
  return { peakFramePx: peak, settleMs: Math.round(frames * FRAME_S * 1000) };
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
  /** Short edge the fit WANTED before the camera floor clamped it. Below the readable floor = cannot be whole and readable. */
  rawTileEdgePx: number;
  /**
   * How much bigger the board is than the container would hold at the readable floor, per axis
   * (1.0 = exactly fits at the floor; above 1 = would have to shrink below it).
   */
  widthNeedAtFloor: number;
  heightNeedAtFloor: number;
  overflowed: boolean;
  /** Board extent over container extent along the worse axis, at the fitted scale (1.0 = exactly fills it). */
  fillRatio: number;
  /** Largest screen-space move of an already-placed tile caused by this placement. 0 for the first tile. */
  maxTileJumpPx: number;
  reflowedTiles: number;
  scaleStepPct: number;
  bends: number;
  /** Largest per-frame (60 fps) screen move of any already-placed tile while the spring camera travels. */
  peakFramePx: number;
  /** Time for the spring camera to settle after this placement. */
  settleMs: number;
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
export function measureHand(
  boards: readonly BoardState[],
  profile: ViewportProfile,
  options: BoardLayoutOptions = layoutOptionsFor(profile),
): PlacementSample[] {
  const samples: PlacementSample[] = [];
  let prev: { layout: BoardLayout; scale: number; count: number; origin: WorldOrigin } | null = null;
  for (const board of boards) {
    const count = countBoardTiles(board);
    if (count === 0) continue;
    if (prev && count <= prev.count) continue;
    const layout = computeBoardLayout(board, [], options);
    const fit = modelCameraFit(layout, count, profile);
    const origin: WorldOrigin = prev ? advanceWorldOrigin(prev.layout, prev.origin, layout) : boundsCenter(layout);
    const centre = boundsCenter(layout);
    const camera: CameraTarget = {
      x: -fit.scale * (centre.x - origin.x) * BOARD_UNIT_PX,
      y: -fit.scale * (centre.y - origin.y) * BOARD_UNIT_PX,
      scale: fit.scale,
    };
    let maxTileJumpPx = 0;
    let reflowedTiles = 0;
    let motion = { peakFramePx: 0, settleMs: 0 };
    if (prev) {
      const before = screenPositions(prev.layout, prev.scale);
      const after = screenPositions(layout, fit.scale);
      const prevTiles = new Map(prev.layout.tiles.map((t) => [t.key, t]));
      reflowedTiles = countReflowed(prev.layout, layout);
      const survivors: Array<{ x: number; y: number }> = [];
      for (const t of layout.tiles) {
        if (!prevTiles.has(t.key)) continue;
        survivors.push({ x: (t.x - origin.x) * BOARD_UNIT_PX, y: (t.y - origin.y) * BOARD_UNIT_PX });
        const a = before.get(t.key);
        const b = after.get(t.key);
        if (a && b) maxTileJumpPx = Math.max(maxTileJumpPx, Math.hypot(a.x - b.x, a.y - b.y));
      }
      const prevCentre = boundsCenter(prev.layout);
      motion = simulateSpring(
        {
          x: -prev.scale * (prevCentre.x - prev.origin.x) * BOARD_UNIT_PX,
          y: -prev.scale * (prevCentre.y - prev.origin.y) * BOARD_UNIT_PX,
          scale: prev.scale,
        },
        camera,
        survivors,
      );
    }
    const widthPx = (layout.maxX - layout.minX) * BOARD_UNIT_PX * fit.scale;
    const heightPx = (layout.maxY - layout.minY) * BOARD_UNIT_PX * fit.scale;
    const floorScale = READABLE_FLOOR_PX / BOARD_UNIT_PX;
    samples.push({
      tileCount: count,
      scale: fit.scale,
      tileShortEdgePx: fit.scale * BOARD_UNIT_PX,
      rawTileEdgePx: fit.rawScale * BOARD_UNIT_PX,
      widthNeedAtFloor: ((layout.maxX - layout.minX) * BOARD_UNIT_PX * floorScale) / (profile.containerWidth * fit.targetFill),
      heightNeedAtFloor: ((layout.maxY - layout.minY) * BOARD_UNIT_PX * floorScale) / (profile.containerHeight * fit.targetFill),
      overflowed: fit.overflowed,
      fillRatio: Math.max(widthPx / profile.containerWidth, heightPx / profile.containerHeight),
      maxTileJumpPx,
      reflowedTiles,
      scaleStepPct: prev ? (Math.abs(fit.scale - prev.scale) / prev.scale) * 100 : 0,
      bends: layout.bends.length,
      peakFramePx: motion.peakFramePx,
      settleMs: motion.settleMs,
    });
    prev = { layout, scale: fit.scale, count, origin };
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
  /** Share of placements where the whole board cannot be shown at >= READABLE_FLOOR_PX. */
  unreadableShare: number;
  /** Among those, which axis is the binding one. */
  unreadableByHeight: number;
  unreadableByWidth: number;
  jumpP50: number;
  jumpP95: number;
  jumpMax: number;
  /** Share of placements in which any already-placed tile moved by > 40 screen px. */
  bigJumpShare: number;
  reflowShare: number;
  scaleStepP95: number;
  scaleStepMax: number;
  /** Spring camera: per-frame tile move at 60 fps. A snap moves the whole jump in one frame (jumpP50/P95/Max). */
  peakFrameP50: number;
  peakFrameP95: number;
  peakFrameMax: number;
  /** Share of placements whose peak per-frame move exceeds ABRUPT_FRAME_PX. */
  abruptShare: number;
  settleP50Ms: number;
  settleP95Ms: number;
}

export const READABILITY_CANDIDATES_PX = [12, 16, 18, 20, 24] as const;
const BIG_JUMP_PX = 40;
/** A tile moving more than this per 60 fps frame (480 px/s) reads as a jump, not as motion. */
export const ABRUPT_FRAME_PX = 8;

export function summarize(samples: readonly PlacementSample[]): QualitySummary {
  const n = samples.length;
  const share = (count: number) => (n === 0 ? 0 : count / n);
  const edges = samples.map((s) => s.tileShortEdgePx).sort((a, b) => a - b);
  const jumps = samples.map((s) => s.maxTileJumpPx).sort((a, b) => a - b);
  const steps = samples.map((s) => s.scaleStepPct).sort((a, b) => a - b);
  const frames = samples.map((s) => s.peakFramePx).sort((a, b) => a - b);
  const settles = samples.map((s) => s.settleMs).sort((a, b) => a - b);
  return {
    placements: n,
    tileEdgeP5: percentile(edges, 5),
    tileEdgeP50: percentile(edges, 50),
    tileEdgeMin: edges[0] ?? 0,
    underPx: Object.fromEntries(
      READABILITY_CANDIDATES_PX.map((px) => [px, share(samples.filter((s) => s.tileShortEdgePx < px).length)]),
    ),
    overflowShare: share(samples.filter((s) => s.overflowed).length),
    unreadableShare: share(samples.filter((s) => s.rawTileEdgePx < READABLE_FLOOR_PX).length),
    unreadableByHeight: share(
      samples.filter((s) => s.rawTileEdgePx < READABLE_FLOOR_PX && s.heightNeedAtFloor >= s.widthNeedAtFloor).length,
    ),
    unreadableByWidth: share(
      samples.filter((s) => s.rawTileEdgePx < READABLE_FLOOR_PX && s.widthNeedAtFloor > s.heightNeedAtFloor).length,
    ),
    jumpP50: percentile(jumps, 50),
    jumpP95: percentile(jumps, 95),
    jumpMax: jumps[jumps.length - 1] ?? 0,
    bigJumpShare: share(samples.filter((s) => s.maxTileJumpPx > BIG_JUMP_PX).length),
    reflowShare: share(samples.filter((s) => s.reflowedTiles > 0).length),
    scaleStepP95: percentile(steps, 95),
    scaleStepMax: steps[steps.length - 1] ?? 0,
    peakFrameP50: percentile(frames, 50),
    peakFrameP95: percentile(frames, 95),
    peakFrameMax: frames[frames.length - 1] ?? 0,
    abruptShare: share(samples.filter((s) => s.peakFramePx > ABRUPT_FRAME_PX).length),
    settleP50Ms: percentile(settles, 50),
    settleP95Ms: percentile(settles, 95),
  };
}
