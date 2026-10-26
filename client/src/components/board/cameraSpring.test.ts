import { describe, expect, it } from 'vitest';
import {
  CAMERA_SMOOTH_TIME_S,
  MAX_STEP_S,
  cameraOf,
  createCameraSpring,
  isCameraSettled,
  smoothDamp,
  stepCameraSpring,
  type CameraSpringState,
  type CameraTarget,
} from './cameraSpring.ts';

function run(state: CameraSpringState, target: CameraTarget, seconds: number, dt = 1 / 60): CameraSpringState {
  let s = state;
  for (let t = 0; t < seconds - 1e-9; t += dt) s = stepCameraSpring(s, target, dt);
  return s;
}

describe('cameraSpring', () => {
  it('converges on the target and settles', () => {
    const from = { x: 0, y: 0, scale: 0.5 };
    const to = { x: 120, y: -40, scale: 0.9 };
    const s = run(createCameraSpring(from), to, 2);
    const cam = cameraOf(s);
    expect(cam.x).toBeCloseTo(120, 1);
    expect(cam.y).toBeCloseTo(-40, 1);
    expect(cam.scale).toBeCloseTo(0.9, 3);
    expect(isCameraSettled(s, to)).toBe(true);
  });

  it('is critically damped: never overshoots, moves monotonically', () => {
    const to = { x: 200, y: 0, scale: 1 };
    let s = createCameraSpring({ x: 0, y: 0, scale: 1 });
    let last = 0;
    for (let i = 0; i < 180; i += 1) {
      s = stepCameraSpring(s, to, 1 / 60);
      const x = cameraOf(s).x;
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      expect(x).toBeLessThanOrEqual(200 + 1e-9);
      last = x;
    }
  });

  it('is frame-rate independent: 30, 60 and 144 fps land in the same place', () => {
    const from = createCameraSpring({ x: 0, y: 0, scale: 0.4 });
    const to = { x: 90, y: 30, scale: 0.8 };
    const at = (dt: number) => cameraOf(run(from, to, 0.3, dt));
    const a = at(1 / 30);
    const b = at(1 / 60);
    const c = at(1 / 144);
    for (const cam of [a, c]) {
      expect(Math.abs(cam.x - b.x)).toBeLessThan(1);
      expect(Math.abs(cam.scale - b.scale)).toBeLessThan(0.01);
    }
  });

  it('animates scale in log space: zooming in and out by the same factor takes the same time', () => {
    const up = run(createCameraSpring({ x: 0, y: 0, scale: 0.5 }), { x: 0, y: 0, scale: 1 }, 0.2);
    const down = run(createCameraSpring({ x: 0, y: 0, scale: 1 }), { x: 0, y: 0, scale: 0.5 }, 0.2);
    // Both covered the same fraction of the ln distance.
    const upDone = (up.logScale.value - Math.log(0.5)) / (Math.log(1) - Math.log(0.5));
    const downDone = (down.logScale.value - Math.log(1)) / (Math.log(0.5) - Math.log(1));
    expect(upDone).toBeCloseTo(downDone, 6);
  });

  it('keeps its velocity when retargeted mid-flight (no restart, no hitch)', () => {
    const start = { x: 0, y: 0, scale: 1 };
    let s = run(createCameraSpring(start), { x: 100, y: 0, scale: 1 }, 0.1);
    const before = s.x.velocity;
    expect(before).toBeGreaterThan(0);
    s = stepCameraSpring(s, { x: 140, y: 0, scale: 1 }, 1 / 60);
    // Velocity carries over instead of resetting to zero.
    expect(s.x.velocity).toBeGreaterThan(before * 0.5);
  });

  it('does not teleport or blow up after a stalled frame', () => {
    const to = { x: 100, y: 0, scale: 1 };
    const s = stepCameraSpring(createCameraSpring({ x: 0, y: 0, scale: 1 }), to, 5);
    const stalled = cameraOf(s).x;
    const capped = cameraOf(stepCameraSpring(createCameraSpring({ x: 0, y: 0, scale: 1 }), to, MAX_STEP_S)).x;
    expect(stalled).toBeCloseTo(capped, 9);
    expect(stalled).toBeLessThan(100);
  });

  it('a zero or negative dt leaves the state untouched', () => {
    const s = createCameraSpring({ x: 5, y: 6, scale: 0.7 });
    expect(stepCameraSpring(s, { x: 50, y: 60, scale: 1 }, 0)).toBe(s);
    expect(stepCameraSpring(s, { x: 50, y: 60, scale: 1 }, -1)).toBe(s);
  });

  it('smoothDamp on an already-settled axis stays put', () => {
    const next = smoothDamp({ value: 10, velocity: 0 }, 10, CAMERA_SMOOTH_TIME_S, 1 / 60);
    expect(next).toEqual({ value: 10, velocity: 0 });
  });
});
