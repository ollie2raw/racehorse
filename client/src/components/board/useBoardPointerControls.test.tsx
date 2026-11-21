// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardCameraState } from './useBoardCamera';
import { DRAG_THRESHOLD_PX, useBoardPointerControls } from './useBoardPointerControls';

/**
 * A press on the board is not a pan until it moves (a touch tap arrives as a mouse press), and a pan is incremental: it adds each move's own delta to
 * the camera as it is now, so a refit between the press and the first move cannot send the camera back to the basis it had at the press.
 */
const setup = () => {
  const state = { camera: { x: 0, y: 0, scale: 1 } as BoardCameraState };
  const history: BoardCameraState[] = [];
  const markManualCamera = vi.fn();
  const setCamera = vi.fn((update: BoardCameraState | ((prev: BoardCameraState) => BoardCameraState)) => {
    state.camera = typeof update === 'function' ? update(state.camera) : update;
    history.push(state.camera);
  });
  const hook = renderHook(() =>
    useBoardPointerControls({
      setCamera, minCameraScale: 0.3, manualCameraRef: { current: false },
      markManualCamera, fitCameraToContainer: vi.fn(), fitCameraToContainerRef: { current: vi.fn() },
    }),
  );
  const mouse = (x: number, y: number, over: { buttons?: number; target?: Element } = {}) =>
    ({ button: 0, buttons: over.buttons ?? 1, clientX: x, clientY: y, target: over.target ?? document.createElement('div') }) as unknown as React.MouseEvent;
  const down = (x: number, y: number, target?: Element) => act(() => hook.result.current.handleMouseDown(mouse(x, y, { target })));
  const move = (x: number, y: number, buttons = 1) => act(() => hook.result.current.handleMouseMove(mouse(x, y, { buttons })));
  const up = () => act(() => hook.result.current.handleMouseUp());
  /** What a refit (a placement, a resize) does: sets a new camera target from outside the pointer handlers. */
  const refit = (camera: BoardCameraState) => { state.camera = camera; };
  return { hook, state, history, markManualCamera, setCamera, down, move, up, refit };
};

describe('board pointer controls: taps and the threshold', () => {
  it('a tap (press and release without moving) does not mark the camera manual', () => {
    const t = setup();
    t.down(100, 100);
    t.up();
    expect(t.markManualCamera).not.toHaveBeenCalled();
    expect(t.setCamera).not.toHaveBeenCalled();
  });

  it('finger or hand jitter below the threshold is still a tap', () => {
    const t = setup();
    t.down(100, 100);
    t.move(100 + DRAG_THRESHOLD_PX - 1, 100);
    expect(t.markManualCamera).not.toHaveBeenCalled();
    expect(t.setCamera).not.toHaveBeenCalled();
  });

  it('a press on a placement zone never starts a pan', () => {
    const t = setup();
    const zone = document.createElement('div');
    zone.className = 'placement-zone';
    const inner = document.createElement('span');
    zone.appendChild(inner);
    t.down(100, 100, inner);
    t.move(160, 100);
    expect(t.setCamera).not.toHaveBeenCalled();
  });
});

describe('board pointer controls: the drag-start regression', () => {
  it('REPRODUCES THE REPORT: press, a refit lands, the pointer crosses the threshold, the drag continues: no backward jump, no displacement from the refit', () => {
    const t = setup();
    t.down(100, 100);
    t.refit({ x: 500, y: 40, scale: 0.5 }); // a placement refitted the camera between the press and the first move
    t.move(110, 100); // crosses the 4 px threshold: arms the drag, moves nothing
    expect(t.state.camera).toEqual({ x: 500, y: 40, scale: 0.5 });
    t.move(130, 100);
    expect(t.state.camera).toEqual({ x: 520, y: 40, scale: 0.5 }); // exactly the pointer's 20 px, from the camera as it is now
    t.move(130, 125);
    expect(t.state.camera).toEqual({ x: 520, y: 65, scale: 0.5 });
    // the scale was never touched, and no state the camera passed through was the pre-refit basis
    expect(t.history.every((c) => c.scale === 0.5 && c.x >= 500)).toBe(true);
  });

  it('a refit in the middle of a drag is kept: the next move adds only its own delta', () => {
    const t = setup();
    t.down(100, 100);
    t.move(110, 100);
    t.move(120, 100);
    expect(t.state.camera.x).toBe(10);
    t.refit({ x: 300, y: 0, scale: 0.8 });
    t.move(125, 100);
    expect(t.state.camera).toEqual({ x: 305, y: 0, scale: 0.8 });
  });

  it('a continuous drag moves the camera by exactly the pointer travel after the threshold crossing (smooth: every step equals its move)', () => {
    const t = setup();
    t.down(0, 0);
    t.move(DRAG_THRESHOLD_PX + 1, 0); // arming move
    const steps: number[] = [];
    let last = t.state.camera.x;
    for (let x = DRAG_THRESHOLD_PX + 4; x <= 80; x += 3) {
      t.move(x, 0);
      steps.push(t.state.camera.x - last);
      last = t.state.camera.x;
    }
    expect(steps.every((s) => s === 3)).toBe(true);
    expect(t.state.camera.x).toBe(80 - (DRAG_THRESHOLD_PX + 1) - ((80 - (DRAG_THRESHOLD_PX + 4)) % 3));
  });

  it('marks the camera manual only once the drag starts, and keeps it marked while the drag continues', () => {
    const t = setup();
    t.down(10, 10);
    expect(t.markManualCamera).not.toHaveBeenCalled();
    t.move(20, 10);
    expect(t.markManualCamera).toHaveBeenCalledTimes(1);
    t.move(25, 10);
    expect(t.markManualCamera).toHaveBeenCalledTimes(2);
  });
});

describe('board pointer controls: interrupted gestures and release', () => {
  it('release ends the drag: a later move with no press pans nothing, and the next press starts afresh below the threshold', () => {
    const t = setup();
    t.down(0, 0);
    t.move(20, 0);
    t.move(30, 0);
    t.up();
    const after = t.state.camera.x;
    t.move(60, 0);
    expect(t.state.camera.x).toBe(after);
    t.down(60, 0);
    t.move(62, 0); // below the threshold again: the old gesture's "moved" did not leak into this press
    expect(t.state.camera.x).toBe(after);
  });

  it('a release the page never saw (the button was let go outside the window) ends the drag on the next move instead of panning on hover', () => {
    const t = setup();
    t.down(0, 0);
    t.move(20, 0);
    t.move(30, 0);
    const before = t.state.camera.x;
    t.move(60, 0, 0); // buttons === 0: nothing is held
    expect(t.state.camera.x).toBe(before);
    t.move(90, 0, 1); // even if a button state appears again, the drag is over
    expect(t.state.camera.x).toBe(before);
  });
});

describe('board pointer controls: wheel and zoom buttons are unchanged', () => {
  it('the wheel and the zoom buttons are explicit gestures and still mark the camera manual', () => {
    const t = setup();
    act(() => t.hook.result.current.handleWheel({ deltaY: 100, preventDefault: vi.fn() } as unknown as React.WheelEvent));
    act(() => t.hook.result.current.applyZoomStep(1.2));
    expect(t.markManualCamera).toHaveBeenCalledTimes(2);
    expect(t.state.camera.scale).toBeCloseTo(0.9 * 1.2, 5);
  });
});
