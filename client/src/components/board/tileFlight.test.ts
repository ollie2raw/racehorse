import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCameraTracker,
  parseCameraTransform,
  FLIGHT_MAX_MS,
  FLIGHT_MIN_MS,
  FLIGHT_SOURCE_MAX_AGE_MS,
  centreOf,
  clearFlightSource,
  easeOutCubic,
  flightDurationMs,
  flightFrame,
  hasFreshFlightSource,
  planFlight,
  recordFlightSource,
  takeFlightSource,
} from './tileFlight.ts';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe('easeOutCubic', () => {
  it('starts at 0, ends at 1, is monotonic, and clamps', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(9)).toBe(1);
    let last = 0;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      expect(easeOutCubic(p)).toBeGreaterThanOrEqual(last);
      last = easeOutCubic(p);
    }
  });

  it('covers most of the distance early (it eases out)', () => {
    expect(easeOutCubic(0.3)).toBeGreaterThan(0.6);
  });
});

describe('flightDurationMs', () => {
  it('is clamped to the min and max', () => {
    expect(flightDurationMs(0)).toBe(FLIGHT_MIN_MS);
    expect(flightDurationMs(100000)).toBe(FLIGHT_MAX_MS);
  });

  it('grows with distance, but slowly', () => {
    expect(flightDurationMs(400)).toBeGreaterThan(flightDurationMs(100));
    expect(flightDurationMs(400) - flightDurationMs(100)).toBeLessThan(80);
  });
});

describe('planFlight / flightFrame', () => {
  const from = rect(100, 600, 60, 120); // a hand tile
  const to = rect(500, 200, 40, 80); // the board tile
  const plan = planFlight(from, to, 90);
  const live = centreOf(to);

  it('starts exactly at the source pose', () => {
    const f = flightFrame(plan, live, 0);
    expect(f).toMatchObject({ cx: 130, cy: 660, width: 60, height: 120, rotateDeg: 0 });
  });

  it('ends exactly on the destination pose (the arc is zero at the end)', () => {
    const f = flightFrame(plan, live, 1);
    expect(f.cx).toBeCloseTo(520, 6);
    expect(f.cy).toBeCloseTo(240, 6);
    expect(f.width).toBeCloseTo(40, 6);
    expect(f.height).toBeCloseTo(80, 6);
    expect(f.rotateDeg).toBeCloseTo(90, 6);
  });

  it('rises on an arc mid-flight: above the straight line, by at most the cap', () => {
    const mid = flightFrame(plan, live, 0.5);
    const straightY = 660 + (240 - 660) * easeOutCubic(0.5);
    expect(mid.cy).toBeLessThan(straightY);
    expect(straightY - mid.cy).toBeLessThanOrEqual(30 + 1e-9);
  });

  it('lands on the destination as it is NOW, so a gliding camera cannot make it miss', () => {
    const moved = { ...live, cx: live.cx + 50, cy: live.cy - 20 };
    const f = flightFrame(plan, moved, 1);
    expect(f.cx).toBeCloseTo(moved.cx, 6);
    expect(f.cy).toBeCloseTo(moved.cy, 6);
  });

  it('a zero-distance flight has no arc and a minimum duration', () => {
    const still = planFlight(rect(0, 0, 50, 50), rect(0, 0, 50, 50), 0);
    expect(still.arcPx).toBe(0);
    expect(still.durationMs).toBe(FLIGHT_MIN_MS);
  });
});

describe('flight source', () => {
  beforeEach(() => clearFlightSource());

  it('hands back the recorded source once, then nothing', () => {
    recordFlightSource(rect(1, 2, 3, 4), 1000);
    expect(takeFlightSource(1100)).toEqual(rect(1, 2, 3, 4));
    expect(takeFlightSource(1100)).toBeNull();
  });

  it('does not hand back a stale source (it belongs to an earlier action)', () => {
    recordFlightSource(rect(1, 2, 3, 4), 1000);
    expect(takeFlightSource(1000 + FLIGHT_SOURCE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('reports whether a source is fresh without consuming it', () => {
    recordFlightSource(rect(1, 2, 3, 4), 1000);
    expect(hasFreshFlightSource(1100, 300)).toBe(true);
    expect(hasFreshFlightSource(1500, 300)).toBe(false);
    expect(takeFlightSource(1100)).not.toBeNull();
  });

  it('a newer record replaces an older one', () => {
    recordFlightSource(rect(1, 1, 1, 1), 1000);
    recordFlightSource(rect(9, 9, 9, 9), 1010);
    expect(takeFlightSource(1020)).toEqual(rect(9, 9, 9, 9));
  });
});

describe('createCameraTracker (the flight follows a gliding camera from its transform, not from the DOM)', () => {
  // A canvas centred at (400, 300) before the camera; the tile sits at canvas offset q = (50, -20) from the canvas centre.
  const O = { x: 400, y: 300 };
  const q = { x: 50, y: -20 };
  const transformOf = (c: { x: number; y: number; scale: number }) => `translate(${c.x}px, ${c.y}px) scale(${c.scale})`;
  const screenTile = (c: { x: number; y: number; scale: number }) => ({ cx: O.x + c.x + c.scale * q.x, cy: O.y + c.y + c.scale * q.y });
  const screenCanvas = (c: { x: number; y: number }) => ({ cx: O.x + c.x, cy: O.y + c.y });

  it('matches a live DOM reading at every camera state, with one read', () => {
    let camera = { x: -30, y: 12, scale: 0.8 };
    const read = vi.fn(() => ({ tile: screenTile(camera), canvas: screenCanvas(camera), transform: transformOf(camera) }));
    const tracker = createCameraTracker(read, () => transformOf(camera), () => 'viewport');
    const frames = [camera, { x: -42, y: 20, scale: 0.9 }, { x: -60, y: 31, scale: 1.1 }, { x: 15, y: -8, scale: 0.55 }];
    for (const c of frames) {
      camera = c;
      const got = tracker.get();
      const want = screenTile(c);
      expect(got.cx).toBeCloseTo(want.cx, 6);
      expect(got.cy).toBeCloseTo(want.cy, 6);
    }
    expect(tracker.reads).toBe(1);
  });

  it('reads again when the viewport key changes, and when a fresh reading is asked for', () => {
    const camera = { x: 0, y: 0, scale: 1 };
    let key = 'a';
    const tracker = createCameraTracker(() => ({ tile: screenTile(camera), canvas: screenCanvas(camera), transform: transformOf(camera) }), () => transformOf(camera), () => key);
    tracker.get();
    key = 'b';
    tracker.get();
    tracker.get(true);
    expect(tracker.reads).toBe(3);
  });

  it('falls back to a live reading on every frame while the transform cannot be parsed', () => {
    const transform = 'matrix(1, 0, 0, 1, 0, 0)';
    let at = { cx: 7, cy: 9 };
    const read = vi.fn(() => ({ tile: at, canvas: { cx: 0, cy: 0 }, transform }));
    const tracker = createCameraTracker(read, () => transform, () => 'k');
    expect(tracker.get()).toEqual({ cx: 7, cy: 9 });
    at = { cx: 8, cy: 10 };
    expect(tracker.get()).toEqual({ cx: 8, cy: 10 }); // no model to follow: the DOM is the source
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('parses what useBoardCameraSpring writes, including exponents and negatives, and rejects the rest', () => {
    expect(parseCameraTransform('translate(-12.5px, 3px) scale(0.75)')).toEqual({ x: -12.5, y: 3, scale: 0.75 });
    expect(parseCameraTransform('translate(1e-7px, -2e-3px) scale(1)')).toEqual({ x: 1e-7, y: -0.002, scale: 1 });
    expect(parseCameraTransform('')).toBeNull();
    expect(parseCameraTransform('translate(0px, 0px) scale(0)')).toBeNull();
    expect(parseCameraTransform('rotate(3deg)')).toBeNull();
  });
});
