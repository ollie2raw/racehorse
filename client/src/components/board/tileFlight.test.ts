import { beforeEach, describe, expect, it } from 'vitest';
import {
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
