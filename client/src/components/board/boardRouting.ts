// client/src/components/board/boardRouting.ts
//
// The ONE safe-bounds model for responsive board routing. Pure: no DOM, no
// React. It turns the measured board container into the layout-unit limit that
// boardLayout.ts bends vertical branch arms against, so a long arm turns
// sideways into unused width before it crowds the HUD / rack — instead of the
// camera shrinking the whole layout to fit a tall column.
//
// Nothing here can touch legality, exposed ends, scoring or transcripts: it only
// feeds `maxVerticalArmExtent` to the visual layout.
//
// Where the bounds come from
//   * The board container is already the space between the HUD (top), the rack
//     and controls (bottom) and any native safe-area inset: LiveMatchScreen's
//     shell sizes `.board-container` inside those. So "distance to HUD / rack /
//     safe area" is the container edge, and nothing else is hard-coded here.
//   * Breathing room is the layout's own ±2.5-unit padding (boardLayout.ts),
//     which the camera fit already keeps on screen.
//
// The rule
//   A board is comfortable while one layout unit is at least COMFORT_UNIT_PX
//   screen pixels. The camera fits the layout into CAMERA_FILL of the container
//   height, so the tallest layout that stays comfortable is
//       H = containerHeight * CAMERA_FILL / COMFORT_UNIT_PX      (units)
//   and each arm (budgeted independently, so tiles added to one arm never
//   re-route the other) may reach
//       L = (H - 2 * LAYOUT_PAD_UNITS) / 2                       (units from the hub)
//   before it turns. Independent of tile size: it is expressed in screen pixels.

import type { BoardState } from '../../types';
import type { BoardLayout, BoardLayoutBend, BoardLayoutTile } from './boardLayoutTypes';

/** Smallest comfortable on-screen size of one layout unit (a domino is 2 x 1 units). */
export const COMFORT_UNIT_PX = 26;
/** Share of the container height the camera fits a tall layout into (matches useBoardCamera). */
export const CAMERA_FILL = 0.92;
/** Vertical padding boardLayout.ts adds above and below the tiles. */
export const LAYOUT_PAD_UNITS = 2.5;
/** An arm always gets room for at least this reach, so the first tiles never turn at once. */
export const MIN_ARM_EXTENT_UNITS = 3.5;
/**
 * Container heights are bucketed so sub-bucket jitter (scrollbars, sub-pixel
 * layout, HUD width changes) cannot flip a routing decision.
 */
export const HEIGHT_BUCKET_PX = 32;

export function bucketContainerHeight(heightPx: number): number {
  if (!Number.isFinite(heightPx) || heightPx <= 0) return 0;
  return Math.floor(heightPx / HEIGHT_BUCKET_PX) * HEIGHT_BUCKET_PX;
}

/**
 * Maximum reach (layout units from the hub centre) of a vertical arm for a
 * container of this (bucketed) height, or undefined when the container has not
 * been measured yet (arms stay straight until it is — never guessed).
 */
export function resolveVerticalArmExtent(containerHeightPx: number): number | undefined {
  const height = bucketContainerHeight(containerHeightPx);
  if (height <= 0) return undefined;
  const tallestComfortableLayout = (height * CAMERA_FILL) / COMFORT_UNIT_PX;
  const reach = (tallestComfortableLayout - 2 * LAYOUT_PAD_UNITS) / 2;
  return Math.max(MIN_ARM_EXTENT_UNITS, reach);
}

// ─── Turn direction and conflict resolution ──────────────────
//
// Both are visual-only and pure. They live here, next to the bounds model, and
// reach boardLayout.ts only through the types and callbacks below.

/** Per-arm routing outcome forced by the conflict resolver; key is `${hubId}:${arm}`. */
export type ArmOverrides = ReadonlyMap<string, 'straight' | -1 | 1>;

/** Everything layoutBranches needs to route one arm. */
export interface RoutingContext {
  /** Phone: bend after this many tiles. */
  maxTiles?: number;
  /** Laptop/desktop: bend once the next tile would reach farther than this (layout units). */
  maxExtent?: number;
  overrides: ArmOverrides;
  /** Topology-stable default turn direction per mainline hub (viewport routing only). */
  hubTurnDir: ReadonlyMap<number, -1 | 1>;
  /** Filled in as arms turn. */
  bends: BoardLayoutBend[];
}

/**
 * Turn direction for viewport-aware bends, from topology rather than from where
 * centring happens to put a hub: appending a main-line tile re-centres the
 * layout, so a sign test on hubX would flip a long run from side to side.
 * Reference = the oldest main-line hub (lowest id); it and every hub right of it
 * turn right, hubs left of it turn left. Order along the main line never
 * changes, so the answer is stable for the life of the hand.
 */
export function computeHubTurnDirections(hubDoubles: BoardState['hubDoubles']): Map<number, -1 | 1> {
  const dirs = new Map<number, -1 | 1>();
  const mainlineHubs = hubDoubles.filter(
    (h): h is typeof h & { hubId: number } =>
      !!h && typeof h.hubId === 'number' && (h.laneType ?? 'mainline') === 'mainline',
  );
  if (mainlineHubs.length === 0) return dirs;
  const reference = mainlineHubs.reduce((a, b) => (b.hubId < a.hubId ? b : a));
  const referenceIndex = reference.mainlineIndex ?? reference.tileIndex;
  for (const h of mainlineHubs) {
    dirs.set(h.hubId, (h.mainlineIndex ?? h.tileIndex) < referenceIndex ? -1 : 1);
  }
  return dirs;
}

/** Footprint of a laid-out tile in layout units (rotation 0 lies along x, doubles included). */
function tileFootprint(t: BoardLayoutTile) {
  const horizontal = t.rotation === 0;
  const halfW = horizontal ? 1 : 0.5;
  const halfH = horizontal ? 0.5 : 1;
  return { l: t.x - halfW, r: t.x + halfW, t: t.y - halfH, b: t.y + halfH };
}

/** Keys of overlapping tile pairs (`a|b`, sorted). Touching edges do not count. */
function overlappingPairs(layout: BoardLayout): Set<string> {
  const EPS = 1e-6;
  const boxes = layout.tiles.map((t) => ({ key: t.key, ...tileFootprint(t) }));
  const pairs = new Set<string>();
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.l < b.r - EPS && a.r > b.l + EPS && a.t < b.b - EPS && a.b > b.t + EPS) {
        pairs.add(a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`);
      }
    }
  }
  return pairs;
}

const MAX_ROUTING_PASSES = 8;

/**
 * A bend must never create a collision the straight layout did not already have
 * (a bent run can cross another hub's column). Lay out, find overlaps that are
 * new relative to the straight layout, and give the newest bent arm another
 * route: first the opposite side, then straight. Deterministic — same board and
 * limit always resolve the same way — and bounded: after MAX_ROUTING_PASSES
 * every remaining bend is straightened. Overlaps the straight layout already has
 * (dense multi-hub boards) are not this function's business.
 *
 * `layoutWith` lays the board out with the given overrides; `layoutStraight`
 * lays it out with no bending at all (the reference for "already overlapping").
 */
export function resolveRoutingConflicts(
  layoutWith: (overrides: ArmOverrides) => BoardLayout,
  layoutStraight: () => BoardLayout,
): BoardLayout {
  const overrides = new Map<string, 'straight' | -1 | 1>();
  let baseline: Set<string> | null = null;
  const baselinePairs = () => (baseline ??= overlappingPairs(layoutStraight()));

  let layout = layoutWith(overrides);
  for (let pass = 0; pass < MAX_ROUTING_PASSES; pass += 1) {
    const bends = layout.bends ?? [];
    if (bends.length === 0) return layout;
    const known = baselinePairs();
    const fresh = [...overlappingPairs(layout)].filter((pair) => !known.has(pair));
    if (fresh.length === 0) return layout;
    // Newest hub first (highest id), then arm: older, already-settled arms keep their route.
    const culprit = bends.reduce((a, b) => (b.hubId > a.hubId || (b.hubId === a.hubId && b.arm > a.arm) ? b : a));
    const key = `${culprit.hubId}:${culprit.arm}`;
    overrides.set(key, overrides.has(key) ? 'straight' : culprit.dir === 1 ? -1 : 1);
    layout = layoutWith(overrides);
  }
  for (const bend of layout.bends ?? []) overrides.set(`${bend.hubId}:${bend.arm}`, 'straight');
  return layoutWith(overrides);
}
