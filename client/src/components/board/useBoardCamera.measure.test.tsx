// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardLayout } from './boardLayout';
import { useBoardCamera, type BoardCameraState } from './useBoardCamera';

/**
 * The camera fits on every placement. It used to read layout (getBoundingClientRect on the container and on every overlay) up to four times
 * per fit; now it measures once and re-measures only when the container or an overlay resizes, or the set of overlays changes.
 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  targets = new Set<Element>();
  private readonly callback: () => void;
  constructor(callback: () => void) { this.callback = callback; FakeResizeObserver.instances.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  trigger() { this.callback(); }
}

const layoutOf = (tiles: number): BoardLayout => ({
  tiles: Array.from({ length: tiles }, (_, i) => ({ x: i * 2 - tiles, y: 0, rotation: 0 })),
  minX: -tiles, maxX: tiles, minY: -1, maxY: 1, dropZoneFootprints: [],
} as unknown as BoardLayout);

describe('useBoardCamera: layout reads', () => {
  let reads: Array<string>;
  let container: HTMLDivElement;
  let screen: HTMLDivElement;
  let containerWidth: number;
  let cameras: BoardCameraState[];

  const rectOf = (el: Element): DOMRect => {
    if (el === container) return { left: 0, top: 0, right: containerWidth, bottom: 400, width: containerWidth, height: 400, x: 0, y: 0, toJSON: () => ({}) };
    // overlays sit in the bottom-right corner of the container
    return { left: containerWidth - 60, top: 340, right: containerWidth, bottom: 400, width: 60, height: 60, x: containerWidth - 60, y: 340, toJSON: () => ({}) };
  };

  beforeEach(() => {
    reads = [];
    cameras = [];
    containerWidth = 800;
    FakeResizeObserver.instances = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      reads.push(this.className || this.tagName);
      return rectOf(this);
    });
    document.body.innerHTML = '';
    screen = document.createElement('div');
    screen.className = 'screen';
    container = document.createElement('div');
    container.className = 'board-container';
    screen.appendChild(container);
    for (const cls of ['rh-board-controls', 'board-corner-pill']) {
      const overlay = document.createElement('div');
      overlay.className = cls;
      screen.appendChild(overlay);
    }
    document.body.appendChild(screen);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const mount = () => {
    const setCamera = vi.fn((next: BoardCameraState | ((prev: BoardCameraState) => BoardCameraState)) => {
      cameras.push(typeof next === 'function' ? next({ x: 0, y: 0, scale: 1 }) : next);
    });
    const containerRef = { current: container };
    const props = (tiles: number) => ({
      setCamera, layout: layoutOf(tiles), containFullBoard: false, resolvedFitMode: 'default' as const, boardTileCount: tiles,
      staticView: false, tightFit: true, unitToPixels: 40, minCameraScale: 0.3, staticFitMainline: false, resetSignature: 'a', containerRef,
    });
    const hook = renderHook((p: ReturnType<typeof props>) => useBoardCamera(p), { initialProps: props(2) });
    return { hook, props, setCamera };
  };

  it('measures the container and each overlay once on mount, however many fits run', async () => {
    mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); }); // the settle fits on the next frames
    // 1 container + 2 overlays, once (the old code read about 4 x (3 + overlays) here)
    expect(reads.length).toBeLessThanOrEqual(3);
  });

  it('a placement (new layout, more tiles) costs no layout read at all', async () => {
    const { hook, props } = mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    const afterMount = reads.length;
    for (let tiles = 3; tiles <= 12; tiles += 1) {
      hook.rerender(props(tiles));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    }
    expect(reads.length - afterMount).toBe(0);
    expect(cameras.length).toBeGreaterThan(1); // it still fits every time
  });

  it('a container resize re-measures once (container and overlays) and refits to the new size', async () => {
    const { hook, props } = mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    const before = reads.length;
    const cameraCount = cameras.length;
    containerWidth = 500;
    await act(async () => { FakeResizeObserver.instances[0]!.trigger(); });
    expect(reads.length - before).toBeLessThanOrEqual(3);
    expect(cameras.length).toBeGreaterThan(cameraCount);
    hook.rerender(props(3));
    expect(hook.result.current.viewportSize.width).toBe(500);
  });

  it('an overlay appearing is picked up without a resize, once', async () => {
    const { hook, props } = mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    const extra = document.createElement('div');
    extra.className = 'board-corner-pill';
    screen.appendChild(extra);
    const before = reads.length;
    hook.rerender(props(4));
    expect(reads.length - before).toBeGreaterThan(0); // the overlay list changed: read the overlays again
    const afterRead = reads.length;
    hook.rerender(props(5));
    hook.rerender(props(6));
    expect(reads.length).toBe(afterRead); // and not again
  });

  it('a window resize drops the measurements', async () => {
    const { hook, props } = mount();
    await act(async () => { await new Promise((r) => setTimeout(r, 80)); });
    containerWidth = 640;
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    hook.rerender(props(3));
    expect(hook.result.current.viewportSize.width).toBe(640);
  });
});
