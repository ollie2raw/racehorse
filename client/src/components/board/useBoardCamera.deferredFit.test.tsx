// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardLayout } from './boardLayout';
import { useBoardCamera, type BoardCameraState } from './useBoardCamera';

/**
 * Root cause of "the camera sometimes does not adjust after a move": a fit requested while a manual pan/zoom was in flight (the 1.5 s window
 * after a gesture) was dropped, and nothing asked again, so the board stayed at the old zoom, off screen, until some later move.
 */
class FakeResizeObserver { constructor(_cb: () => void) {} observe() {} unobserve() {} disconnect() {} }
const layoutOf = (tiles: number): BoardLayout => ({
  tiles: Array.from({ length: tiles }, (_, i) => ({ x: i * 2 - tiles, y: 0, rotation: 0 })),
  minX: -tiles * 2, maxX: tiles * 2, minY: -1, maxY: 1, dropZoneFootprints: [],
} as unknown as BoardLayout);

describe('useBoardCamera: a fit held off by a gesture is deferred, not dropped', () => {
  let container: HTMLDivElement;
  let camera: BoardCameraState;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'Date'] });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    camera = { x: 0, y: 0, scale: 1 };
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const mount = (tiles = 2) => {
    const setCamera = vi.fn((next: BoardCameraState | ((p: BoardCameraState) => BoardCameraState)) => { camera = typeof next === 'function' ? next(camera) : next; });
    const containerRef = { current: container };
    const props = (n: number) => ({ setCamera, layout: layoutOf(n), containFullBoard: false, resolvedFitMode: 'default' as const, boardTileCount: n, staticView: false, tightFit: true, unitToPixels: 40, minCameraScale: 0.3, staticFitMainline: false, resetSignature: 'a', containerRef });
    const hook = renderHook((p: ReturnType<typeof props>) => useBoardCamera(p), { initialProps: props(tiles) });
    return { hook, props };
  };
  const settle = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const referenceScaleFor = async (tiles: number) => {
    const before = { ...camera };
    const fresh = mount(tiles);
    await settle(100);
    const scale = camera.scale;
    fresh.hook.unmount();
    camera = before;
    return scale;
  };

  it('reproduces the report: a move 500 ms after a pan used to leave the board at the 2-tile zoom for good; it now refits when the gesture window closes', async () => {
    const { hook, props } = mount(2);
    await settle(100);
    const twoTileScale = camera.scale;
    act(() => { hook.result.current.markManualCamera(); });
    await settle(500);
    hook.rerender(props(6)); // a placement inside the window
    await settle(100);
    expect(camera.scale, 'held off while the gesture is in flight').toBeCloseTo(twoTileScale, 3);
    await settle(1500); // the window (1.5 s from the gesture) closes
    const want = await referenceScaleFor(6);
    expect(camera.scale, 'refitted for 6 tiles after the window').toBeCloseTo(want, 3);
    expect(camera.scale).toBeLessThan(twoTileScale * 0.7);
  });

  it('with no gesture in flight the fit is immediate and no timer is left behind', async () => {
    const { hook, props } = mount(2);
    await settle(100);
    hook.rerender(props(6));
    await settle(50);
    expect(camera.scale).toBeCloseTo(await referenceScaleFor(6), 3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('several placements inside one window produce one refit, for the latest board', async () => {
    const { hook, props } = mount(2);
    await settle(100);
    act(() => { hook.result.current.markManualCamera(); });
    for (const n of [3, 4, 5, 6]) { hook.rerender(props(n)); await settle(100); }
    await settle(1500);
    expect(camera.scale).toBeCloseTo(await referenceScaleFor(6), 3);
  });

  it('a gesture extended while a fit is waiting pushes the fit back, and it still happens', async () => {
    const { hook, props } = mount(2);
    await settle(100);
    act(() => { hook.result.current.markManualCamera(); });
    hook.rerender(props(6));
    await settle(1000);
    act(() => { hook.result.current.markManualCamera(); }); // the player keeps panning
    await settle(700); // the first timer fires inside the new window: nothing yet
    const during = camera.scale;
    await settle(1500);
    expect(during).toBeGreaterThan(camera.scale);
    expect(camera.scale).toBeCloseTo(await referenceScaleFor(6), 3);
  });

  it('unmounting cancels the waiting fit', async () => {
    const { hook, props } = mount(2);
    await settle(100);
    act(() => { hook.result.current.markManualCamera(); });
    hook.rerender(props(6));
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
