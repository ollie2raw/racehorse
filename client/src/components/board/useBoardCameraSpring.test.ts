// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_WARMUP_MS, useBoardCameraSpring } from './useBoardCameraSpring.ts';

type Cam = { x: number; y: number; scale: number };

let now = 0;
let frames: Array<(t: number) => void> = [];

beforeEach(() => {
  now = 1000;
  frames = [];
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frames = [];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function advance(ms: number, step = 1000 / 60) {
  for (let t = 0; t < ms; t += step) {
    now += step;
    const pending = frames;
    frames = [];
    for (const cb of pending) cb(now);
  }
}

function setup(initial: Cam, extra: Partial<{ motionAllowed: boolean; enabled: boolean; snapKey: string; manual: boolean }> = {}) {
  const canvas = document.createElement('div');
  const canvasRef = { current: canvas };
  const manualCameraRef = { current: extra.manual ?? false };
  const view = renderHook(
    (props: { camera: Cam; snapKey: string; motionAllowed: boolean }) =>
      useBoardCameraSpring({
        canvasRef,
        camera: props.camera,
        enabled: extra.enabled ?? true,
        motionAllowed: props.motionAllowed,
        snapKey: props.snapKey,
        manualCameraRef,
      }),
    { initialProps: { camera: initial, snapKey: 'hand1|800x300', motionAllowed: extra.motionAllowed ?? true } },
  );
  const scale = () => Number(/scale\(([-\d.e]+)\)/.exec(canvas.style.transform)?.[1]);
  const tx = () => Number(/translate\(([-\d.e]+)px/.exec(canvas.style.transform)?.[1]);
  return { canvas, view, manualCameraRef, scale, tx };
}

describe('useBoardCameraSpring', () => {
  it('writes the first camera immediately (no glide from the default on mount)', () => {
    const { canvas, scale } = setup({ x: 10, y: 0, scale: 0.8 });
    expect(scale()).toBeCloseTo(0.8, 6);
    expect(canvas.dataset.cameraSettled).toBe('true');
    expect(canvas.style.getPropertyValue('--rh-camera-scale')).toBe('0.8');
  });

  it('snaps the extra fits that follow mount (warm-up window), then glides', () => {
    const { view, scale, canvas, tx } = setup({ x: 0, y: 0, scale: 0.5 });
    // Within the warm-up window a new fit is applied instantly.
    view.rerender({ camera: { x: 30, y: 0, scale: 0.6 }, snapKey: 'hand1|800x300', motionAllowed: true });
    expect(scale()).toBeCloseTo(0.6, 6);
    expect(tx()).toBe(30);
    // After the window, a new target glides.
    now += CAMERA_WARMUP_MS + 50;
    view.rerender({ camera: { x: 130, y: 0, scale: 0.9 }, snapKey: 'hand1|800x300', motionAllowed: true });
    expect(canvas.dataset.cameraSettled).toBe('false');
    expect(scale()).toBeLessThan(0.7); // has barely started
    advance(60);
    const mid = scale();
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(0.9);
    advance(1500);
    expect(scale()).toBeCloseTo(0.9, 4);
    expect(tx()).toBeCloseTo(130, 0);
    expect(canvas.dataset.cameraSettled).toBe('true');
  });

  it('snaps when the snap key changes (new hand / container resized)', () => {
    const { view, scale } = setup({ x: 0, y: 0, scale: 0.5 });
    now += CAMERA_WARMUP_MS + 50;
    view.rerender({ camera: { x: 0, y: 0, scale: 1.2 }, snapKey: 'hand2|800x300', motionAllowed: true });
    expect(scale()).toBeCloseTo(1.2, 6);
    view.rerender({ camera: { x: 0, y: 0, scale: 0.7 }, snapKey: 'hand2|900x300', motionAllowed: true });
    expect(scale()).toBeCloseTo(0.7, 6);
  });

  it('snaps while the player is panning or zooming by hand', () => {
    const { view, scale, manualCameraRef } = setup({ x: 0, y: 0, scale: 0.5 });
    now += CAMERA_WARMUP_MS + 50;
    manualCameraRef.current = true;
    view.rerender({ camera: { x: 0, y: 0, scale: 0.8 }, snapKey: 'hand1|800x300', motionAllowed: true });
    expect(scale()).toBeCloseTo(0.8, 6);
  });

  it('snaps when motion is not allowed (reduced motion, hidden tab)', () => {
    const { view, scale } = setup({ x: 0, y: 0, scale: 0.5 }, { motionAllowed: false });
    now += CAMERA_WARMUP_MS + 50;
    view.rerender({ camera: { x: 0, y: 0, scale: 0.8 }, snapKey: 'hand1|800x300', motionAllowed: false });
    expect(scale()).toBeCloseTo(0.8, 6);
  });

  it('leaves the canvas alone for static boards', () => {
    const { canvas } = setup({ x: 5, y: 5, scale: 0.5 }, { enabled: false });
    expect(canvas.style.transform).toBe('');
  });

  it('retargeting mid-glide blends toward the new target', () => {
    const { view, scale } = setup({ x: 0, y: 0, scale: 0.5 });
    now += CAMERA_WARMUP_MS + 50;
    view.rerender({ camera: { x: 0, y: 0, scale: 0.8 }, snapKey: 'hand1|800x300', motionAllowed: true });
    advance(80);
    view.rerender({ camera: { x: 0, y: 0, scale: 0.6 }, snapKey: 'hand1|800x300', motionAllowed: true });
    advance(1500);
    expect(scale()).toBeCloseTo(0.6, 4);
  });
});
