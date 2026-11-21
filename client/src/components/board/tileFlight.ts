// client/src/components/board/tileFlight.ts
//
// The motion model for a placed tile travelling from where it came from (the player's hand, the point a
// drag was released, or Fritz's rack) to its place on the board. Pure, so the feel is unit-tested; the DOM
// side is useTileFlight.ts.
//
// Previously a placed tile appeared at its destination and did a 6 px "land". Now it flies: it eases out
// from the source to the destination (which keeps moving while the camera glides, so the end point is read
// live every frame), grows or shrinks from the source tile's size to the board tile's, rotates into the
// lane, and rises on a shallow arc mid-flight so it reads as picked up and put down.

export interface FlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface FlightPoint {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export const FLIGHT_MIN_MS = 200;
export const FLIGHT_MAX_MS = 380;
/** Longer flights take a little longer, but not proportionally: a tile crossing a laptop should not crawl. */
const FLIGHT_BASE_MS = 190;
const FLIGHT_MS_PER_PX = 0.16;
/** Peak lift of the arc, as a share of the flight distance, capped so a long flight does not balloon. */
const ARC_SHARE = 0.07;
const ARC_MAX_PX = 30;

/** A source this old is not the tile that just landed (it belongs to an earlier action). */
export const FLIGHT_SOURCE_MAX_AGE_MS = 1500;

export function centreOf(rect: FlightRect): FlightPoint {
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2, width: rect.width, height: rect.height };
}

export function easeOutCubic(p: number): number {
  const q = 1 - Math.min(1, Math.max(0, p));
  return 1 - q * q * q;
}

export function flightDurationMs(distancePx: number): number {
  return Math.round(Math.min(FLIGHT_MAX_MS, Math.max(FLIGHT_MIN_MS, FLIGHT_BASE_MS + distancePx * FLIGHT_MS_PER_PX)));
}

export interface FlightPlan {
  from: FlightPoint;
  toRotationDeg: number;
  durationMs: number;
  arcPx: number;
}

export function planFlight(from: FlightRect, to: FlightRect, toRotationDeg: number): FlightPlan {
  const a = centreOf(from);
  const b = centreOf(to);
  const distance = Math.hypot(b.cx - a.cx, b.cy - a.cy);
  return {
    from: a,
    toRotationDeg,
    durationMs: flightDurationMs(distance),
    arcPx: Math.min(ARC_MAX_PX, distance * ARC_SHARE),
  };
}

export interface FlightFrame {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotateDeg: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The tile's pose at progress `p` (0..1 of the duration). `liveTo` is the destination as it is RIGHT NOW,
 * not as it was when the flight started: the camera is still gliding, so the target moves, and reading it
 * each frame makes the tile land exactly on the tile it becomes.
 */
export function flightFrame(plan: FlightPlan, liveTo: FlightPoint, p: number): FlightFrame {
  const progress = Math.min(1, Math.max(0, p));
  const e = easeOutCubic(progress);
  return {
    cx: lerp(plan.from.cx, liveTo.cx, e),
    // A shallow arc: lift peaks mid-flight and is zero at both ends, so it never offsets the landing.
    cy: lerp(plan.from.cy, liveTo.cy, e) - plan.arcPx * Math.sin(Math.PI * progress),
    width: lerp(plan.from.width, liveTo.width, e),
    height: lerp(plan.from.height, liveTo.height, e),
    rotateDeg: lerp(0, plan.toRotationDeg, e),
  };
}

// ─── where the tile came from ────────────────────────────────

interface PendingSource {
  rect: FlightRect;
  at: number;
}

let pending: PendingSource | null = null;

/** Remember where the tile the player is about to place is on screen (hand tile, or the held drag tile). */
export function recordFlightSource(rect: FlightRect, now: number = performance.now()): void {
  pending = { rect, at: now };
}

/** True if a source was recorded within `maxAgeMs` (used so a tap's capture never overwrites a drag's). */
export function hasFreshFlightSource(now: number, maxAgeMs: number): boolean {
  return pending !== null && now - pending.at <= maxAgeMs;
}

/** The recorded source if it is recent enough to belong to the tile that just landed; consumed once. */
export function takeFlightSource(now: number = performance.now(), maxAgeMs: number = FLIGHT_SOURCE_MAX_AGE_MS): FlightRect | null {
  const source = pending;
  pending = null;
  if (!source || now - source.at > maxAgeMs) return null;
  return source.rect;
}

export function clearFlightSource(): void {
  pending = null;
}

/** The camera transform useBoardCameraSpring writes: `translate(Xpx, Ypx) scale(S)` on a canvas whose transform-origin is its centre. */
export function parseCameraTransform(transform: string): { x: number; y: number; scale: number } | null {
  const m = /translate\(\s*(-?[\d.]+(?:e[+-]?\d+)?)px,\s*(-?[\d.]+(?:e[+-]?\d+)?)px\s*\)\s*scale\(\s*(-?[\d.]+(?:e[+-]?\d+)?)\s*\)/i.exec(transform);
  if (!m) return null;
  const [x, y, scale] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(scale) && scale > 0 ? { x, y, scale } : null;
}

export interface CameraReading {
  /** The real tile's on-screen centre and the canvas's on-screen centre, read together from the DOM (one layout). */
  tile: { cx: number; cy: number };
  canvas: { cx: number; cy: number };
  /** The canvas's inline transform at that moment. */
  transform: string;
}

/**
 * Follows a tile on a board whose camera glides, without reading the DOM every frame. getBoundingClientRect forces a layout whenever
 * the page is dirty (multiplayer writes the DOM every frame elsewhere: about 0.5 s of main-thread time per game seat in the flight alone),
 * and the camera glides during almost every flight, so caching the box by camera state does not hit. But the camera is a pure transform,
 * translate(t) scale(s) about the canvas centre, so one live reading fixes the tile's place on the canvas and every later frame is arithmetic
 * on the current transform string: screen = O + t + s * q, with O the canvas centre without the transform and q the tile's offset from it.
 * A new reading (one layout) is taken when `resizeKey()` changes (viewport or canvas size) or when the transform cannot be parsed.
 */
export function createCameraTracker(
  read: () => CameraReading,
  currentTransform: () => string,
  resizeKey: () => string,
): { get: (fresh?: boolean) => { cx: number; cy: number }; readonly reads: number } {
  let reads = 0;
  let key = '';
  let model: { ox: number; oy: number; qx: number; qy: number } | null = null;
  let last = { cx: 0, cy: 0 };
  const take = () => {
    const r = read();
    reads += 1;
    key = resizeKey();
    const t0 = parseCameraTransform(r.transform);
    last = r.tile;
    if (!t0) {
      model = null;
      return;
    }
    const ox = r.canvas.cx - t0.x;
    const oy = r.canvas.cy - t0.y;
    model = { ox, oy, qx: (r.tile.cx - ox - t0.x) / t0.scale, qy: (r.tile.cy - oy - t0.y) / t0.scale };
  };
  return {
    get(fresh = false) {
      if (fresh || !model || key !== resizeKey()) take();
      if (!model) return last;
      const t = parseCameraTransform(currentTransform());
      if (!t) {
        take();
        return last;
      }
      return { cx: model.ox + t.x + t.scale * model.qx, cy: model.oy + t.y + t.scale * model.qy };
    },
    get reads() {
      return reads;
    },
  };
}
