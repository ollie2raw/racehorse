import { describe, expect, it } from 'vitest';
import { COMFORT_INSET, isBoardComfortable, type ComfortInput } from './boardCameraComfort.ts';

// A board whose padded bounds are 20 x 6 layout units, 84 px per unit, in a 1000 x 600 container.
const layout = { tiles: [{ x: 0, y: 0, rotation: 0, flipped: false, key: 'main-6-6', tile: { low: 6, high: 6 } }], minX: -10, maxX: 10, minY: -3, maxY: 3, dropZoneFootprints: [] } as unknown as ComfortInput['layout'];
const base: ComfortInput = {
  layout, worldOffsetUnits: { x: 0, y: 0 }, camera: { x: 0, y: 0, scale: 0.5 }, unitPx: 84, containerWidth: 1000, containerHeight: 600, reserved: [],
};
/** Width fill of the board for a scale: 20 units * 84 px * scale / 1000. */
const atFill = (fill: number): ComfortInput['camera'] => ({ x: 0, y: 0, scale: (fill * 1000) / (20 * 84) });

describe('isBoardComfortable (the test behind camera policy B)', () => {
  it('a board centred at 90% of the width is comfortable', () => {
    expect(isBoardComfortable({ ...base, camera: atFill(0.9) })).toBe(true);
  });

  it(`the comfort zone is the container less ${COMFORT_INSET * 100}% on each side: 94% fits, 95% and the 97% fit target do not`, () => {
    expect(isBoardComfortable({ ...base, camera: atFill(0.94 - 1e-6) })).toBe(true);
    expect(isBoardComfortable({ ...base, camera: atFill(0.95) })).toBe(false);
    expect(isBoardComfortable({ ...base, camera: atFill(0.97) })).toBe(false);
  });

  it('is decided per axis: a board that is short enough but too tall is not comfortable', () => {
    const tall = { ...base, layout: { ...layout, minY: -6, maxY: 6 } as ComfortInput['layout'], camera: atFill(0.5) };
    expect(isBoardComfortable(tall)).toBe(true);
    expect(isBoardComfortable({ ...tall, camera: { ...tall.camera, scale: tall.camera.scale * 2.4 } })).toBe(false); // 12 units * 84 * 1.19 = 1200 px > 600
  });

  it('follows the camera pan: the same board, panned toward an edge, leaves the zone', () => {
    const cam = atFill(0.7);
    expect(isBoardComfortable({ ...base, camera: cam })).toBe(true);
    expect(isBoardComfortable({ ...base, camera: { ...cam, x: 200 } })).toBe(false);
    expect(isBoardComfortable({ ...base, camera: { ...cam, x: -200 } })).toBe(false);
    expect(isBoardComfortable({ ...base, camera: { ...cam, y: 300 } })).toBe(false);
  });

  it('uses the world-frame offset the camera carries: offset and camera that cancel are the same as neither', () => {
    const cam = atFill(0.7);
    const px = cam.scale * 84;
    expect(isBoardComfortable({ ...base, camera: cam, worldOffsetUnits: { x: 0, y: 0 } })).toBe(true);
    // bounds centre 5 units right of the world origin: the camera must carry -5 units to keep the board centred
    expect(isBoardComfortable({ ...base, camera: { ...cam, x: -5 * px }, worldOffsetUnits: { x: 5, y: 0 } })).toBe(true);
    expect(isBoardComfortable({ ...base, camera: cam, worldOffsetUnits: { x: 5, y: 0 } })).toBe(false); // the camera forgot it: the board sits 5 units off
  });

  it('is not comfortable when a tile runs under an overlay (phone tray / corner pill), and is when the overlay is clear', () => {
    const cam = atFill(0.7);
    const tray = { left: 480, top: 280, right: 520, bottom: 320 }; // the middle of the container: the tile at the origin is under it
    expect(isBoardComfortable({ ...base, camera: cam, reserved: [tray] })).toBe(false);
    expect(isBoardComfortable({ ...base, camera: cam, reserved: [{ left: 900, top: 10, right: 990, bottom: 60 }] })).toBe(true);
  });

  it('an unmeasured container or a degenerate camera is never comfortable (the fit decides)', () => {
    expect(isBoardComfortable({ ...base, containerWidth: 0 })).toBe(false);
    expect(isBoardComfortable({ ...base, camera: { x: 0, y: 0, scale: 0 } })).toBe(false);
  });
});
