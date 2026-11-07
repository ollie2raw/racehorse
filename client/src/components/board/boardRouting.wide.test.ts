import { describe, expect, it } from 'vitest';
import { computeBoardLayout, type BoardLayout } from './boardLayout.ts';
import { armSteps, spinnerWithArms } from './boardRoutingFixtures.ts';
import {
  CAMERA_FILL,
  WIDE_COMFORT_UNIT_PX,
  WIDE_CONTAINER_MIN_WIDTH_PX,
  WIDE_MAX_ARM_EXTENT_UNITS,
  isWideBoardContainer,
  resolveVerticalArmExtent,
} from './boardRouting.ts';

/** Straight (not yet bent) vertical tiles of the up arm, measured on the real layout. */
function straightUpTiles(layout: BoardLayout): number {
  const hubX = layout.tiles.find((t) => t.key.includes('6-6') && t.key.startsWith('main-'))!.x;
  return layout.tiles.filter((t) => t.key.startsWith('branch-') && Math.abs(t.x - hubX) < 1e-6).length;
}

function tilesFor(containerHeight: number, wide: boolean, steps = armSteps(10)): number {
  const extent = resolveVerticalArmExtent(containerHeight, wide);
  const layout = computeBoardLayout(spinnerWithArms({ up: steps }), [], extent === undefined ? {} : { maxVerticalArmExtent: extent });
  return straightUpTiles(layout);
}

describe('desktop-class vertical arm routing', () => {
  it('a laptop board (1280x720: container ~508px) runs 5 tiles before turning, not 3', () => {
    expect(tilesFor(508, false)).toBe(3); // the old rule: what the owner saw
    expect(tilesFor(508, true)).toBe(5);
  });

  it('a window a little shorter than that (container ~450px) still gets 5, never fewer than 4', () => {
    expect(tilesFor(448, false)).toBe(2);
    expect(tilesFor(448, true)).toBeGreaterThanOrEqual(5);
    expect(tilesFor(416, true)).toBeGreaterThanOrEqual(4);
  });

  it('a tall desktop board (container 674-756px) runs 6 tiles and no more', () => {
    expect(tilesFor(674, true)).toBe(6);
    expect(tilesFor(756, true)).toBe(6);
    expect(tilesFor(1200, true)).toBe(6);
    expect(resolveVerticalArmExtent(1200, true)).toBe(WIDE_MAX_ARM_EXTENT_UNITS);
  });

  it('a double in the arm moves the turn by at most one tile (a double is never the bend vertex)', () => {
    for (const h of [448, 508, 674]) {
      const plain = tilesFor(h, true);
      const withDouble = tilesFor(h, true, armSteps(10, [2]));
      expect(Math.abs(withDouble - plain)).toBeLessThanOrEqual(2);
      expect(withDouble).toBeGreaterThanOrEqual(4);
    }
  });

  it('only a wide container gets the new rule: the narrow rule is byte-for-byte what it was', () => {
    expect(WIDE_CONTAINER_MIN_WIDTH_PX).toBe(900);
    expect(isWideBoardContainer(899)).toBe(false);
    expect(isWideBoardContainer(900)).toBe(true);
    expect(isWideBoardContainer(Number.NaN)).toBe(false);
    // The legacy values the existing routing tests were written against.
    const legacy = (bucketedHeight: number) => ((bucketedHeight * 0.92) / 21 - 5) / 2;
    expect(resolveVerticalArmExtent(480)).toBeCloseTo(legacy(480), 6);
    expect(resolveVerticalArmExtent(674)).toBeCloseTo(legacy(672), 6);
    expect(resolveVerticalArmExtent(480, false)).toBe(resolveVerticalArmExtent(480));
    expect(resolveVerticalArmExtent(0, true)).toBeUndefined();
  });

  it('even with both arms at the limit the board stays inside the container at the comfort size', () => {
    for (const h of [416, 448, 480, 508, 544, 640, 756]) {
      const extent = resolveVerticalArmExtent(h, true)!;
      const layout = computeBoardLayout(spinnerWithArms({ up: armSteps(7), down: armSteps(7) }), [], { maxVerticalArmExtent: extent });
      const tallest = (Math.floor(h / 32) * 32 * CAMERA_FILL) / WIDE_COMFORT_UNIT_PX;
      // The turn waits for an ordinary tile (a deferral can overshoot by up to ~3.3 units, see responsive-board-routing).
      expect(layout.maxY - layout.minY).toBeLessThanOrEqual(tallest + 3.4);
    }
  });
});
