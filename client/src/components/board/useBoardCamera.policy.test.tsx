// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardLayout } from './boardLayout';
import { useBoardCamera, type BoardCameraState } from './useBoardCamera';
import type { BoardCameraPolicy } from '../../config/boardCameraPolicy';

/**
 * Policy B in the live hook: while the padded bounds are comfortably inside the container the camera is held (no setCamera at all); the moment they
 * are not, the fit is the same one policy A runs. Resizes, resets and explicit recentres always refit.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  private readonly cb: () => void;
  constructor(cb: () => void) { this.cb = cb; FakeResizeObserver.instances.push(this); }
  observe() {} unobserve() {} disconnect() {}
  trigger() { this.cb(); }
}
/** `halfUnits` is the half-width of the padded bounds in layout units; the container is 800 x 400 and a layout unit is 40 px. */
const layoutOf = (tiles: number, halfUnits: number): BoardLayout => ({
  tiles: Array.from({ length: tiles }, (_, i) => ({ x: i * 2 - tiles, y: 0, rotation: 0 })),
  minX: -halfUnits, maxX: halfUnits, minY: -1, maxY: 1, dropZoneFootprints: [],
} as unknown as BoardLayout);

describe('useBoardCamera: policy B (comfort hold) and policy A (default)', () => {
  let container: HTMLDivElement;
  let camera: BoardCameraState;
  let setCount: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    camera = { x: 0, y: 0, scale: 1 };
    setCount = 0;
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const mount = (policy: BoardCameraPolicy, tiles: number, halfUnits: number, resetSignature = 'a') => {
    const setCamera = vi.fn((next: BoardCameraState | ((p: BoardCameraState) => BoardCameraState)) => { setCount += 1; camera = typeof next === 'function' ? next(camera) : next; });
    const containerRef = { current: container };
    const props = (n: number, half: number, reset = resetSignature) => ({
      setCamera, camera, cameraPolicy: policy, layout: layoutOf(n, half), containFullBoard: false, resolvedFitMode: 'default' as const, boardTileCount: n,
      staticView: false, tightFit: false, unitToPixels: 40, minCameraScale: 0.2, staticFitMainline: false, resetSignature: reset, containerRef,
    });
    const hook = renderHook((p: ReturnType<typeof props>) => useBoardCamera(p), { initialProps: props(tiles, halfUnits) });
    return { hook, props };
  };
  const settle = (ms = 100) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  /** What policy A fits for a layout: the reference both policies must agree on when they do refit. */
  const referenceFit = async (tiles: number, halfUnits: number) => {
    const saved = { camera: { ...camera }, count: setCount };
    camera = { x: 0, y: 0, scale: 1 };
    const fresh = mount('full', tiles, halfUnits);
    await settle();
    const ref = { ...camera };
    fresh.hook.unmount();
    camera = saved.camera; setCount = saved.count;
    return ref;
  };

  it('B holds while the board stays comfortable: a placement that does not leave the zone does not touch the camera', async () => {
    // 3 tiles: span 6 units, the scale is capped at 2.1 (about 63% of the width). 4 tiles: span 8: A would fit 2.05, but at the held 2.1 the board is 84% of the width.
    const { hook, props } = mount('comfort', 3, 3);
    await settle();
    const fitted = { ...camera };
    const sets = setCount;
    hook.rerender(props(4, 4));
    await settle();
    expect(setCount, 'no setCamera call').toBe(sets);
    expect(camera).toEqual(fitted);
  });

  it('A (the default) refits on the same placement', async () => {
    const { hook, props } = mount('full', 3, 3);
    await settle();
    const fitted = { ...camera };
    hook.rerender(props(4, 4));
    await settle();
    expect(camera.scale).toBeCloseTo(2.05, 3);
    expect(camera.scale).toBeLessThan(fitted.scale);
  });

  it('B refits exactly as A would once the board leaves the comfort zone', async () => {
    const { hook, props } = mount('comfort', 3, 6);
    await settle();
    hook.rerender(props(9, 13)); // far wider: out of the zone at the held scale
    await settle();
    const want = await referenceFit(9, 13);
    expect(camera.scale).toBeCloseTo(want.scale, 6);
    expect(camera.x).toBeCloseTo(want.x, 4);
  });

  it('B never holds the first fit of a hand, and refits when the hand resets', async () => {
    const { hook, props } = mount('comfort', 3, 6);
    await settle();
    expect(camera.scale).not.toBe(1); // the first fit happened although the default camera is "comfortable" for some boards
    const before = { ...camera };
    hook.rerender(props(2, 3.5, 'b')); // new hand: a smaller board, the previous camera would still be comfortable
    await settle(600);
    expect(camera.scale).not.toBeCloseTo(before.scale, 3);
    expect(camera.scale).toBeCloseTo((await referenceFit(2, 3.5)).scale, 6);
  });

  it('B refits when the container is resized, even if the board would still be comfortable', async () => {
    const { hook, props } = mount('comfort', 3, 6);
    await settle();
    void props; void hook;
    const before = { ...camera };
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 1200, bottom: 600, width: 1200, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    act(() => { FakeResizeObserver.instances.forEach((o) => o.trigger()); });
    await settle();
    expect(camera.scale).toBeGreaterThan(before.scale); // fitted to the bigger container
  });

  it('an explicit recentre (double-click) always refits under B', async () => {
    const { hook } = mount('comfort', 3, 6);
    await settle();
    act(() => { camera = { x: 17, y: 9, scale: 0.9 }; }); // the user nudged it
    act(() => { hook.result.current.fitCameraToContainer('double-click-reset', undefined, undefined, true); });
    const want = await referenceFit(3, 6);
    expect(camera.scale).toBeCloseTo(want.scale, 6);
    expect(camera.x).toBeCloseTo(want.x, 4);
  });

  it('the default policy is A when none is passed', async () => {
    const setCamera = vi.fn((next: BoardCameraState | ((p: BoardCameraState) => BoardCameraState)) => { camera = typeof next === 'function' ? next(camera) : next; });
    const containerRef = { current: container };
    const props = (n: number, half: number) => ({ setCamera, layout: layoutOf(n, half), containFullBoard: false, resolvedFitMode: 'default' as const, boardTileCount: n, staticView: false, tightFit: false, unitToPixels: 40, minCameraScale: 0.2, staticFitMainline: false, resetSignature: 'a', containerRef });
    const hook = renderHook((p: ReturnType<typeof props>) => useBoardCamera(p), { initialProps: props(3, 3) });
    await settle();
    const fitted = camera.scale;
    hook.rerender(props(4, 4));
    await settle();
    expect(camera.scale).toBeLessThan(fitted);
  });
});
