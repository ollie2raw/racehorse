// client/src/components/board/cameraSpring.ts
//
// The board camera's motion model: a critically damped spring on the camera's x, y and
// log-scale. Pure, frame-rate independent, and interruptible (retargeting mid-flight keeps
// the current velocity, so a second placement while the camera is still moving blends
// instead of restarting).
//
// Critically damped on purpose: it eases in, never overshoots and never oscillates, which
// is what a board you are reading needs. The closed form is the standard "smooth damp"
// (a critically damped spring integrated analytically per step), stable for any dt.
//
// Scale is animated in log space so a 2x zoom-in and a 2x zoom-out take the same time and
// feel the same, instead of the zoom-out looking abrupt.

export interface SpringAxis {
  value: number;
  velocity: number;
}

export interface CameraSpringState {
  x: SpringAxis;
  y: SpringAxis;
  /** ln(scale) */
  logScale: SpringAxis;
}

export interface CameraTarget {
  x: number;
  y: number;
  scale: number;
}

/**
 * Time constant of the camera, in seconds: roughly how long the camera takes to cover most
 * of a move (about 98 % in 2.9x this, ~0.5 s at the default). A tile every second or two
 * stays comfortably ahead of it.
 */
export const CAMERA_SMOOTH_TIME_S = 0.18;

/** A stalled frame (background tab, GC pause) must not teleport the camera or destabilise it. */
export const MAX_STEP_S = 1 / 20;

export function createCameraSpring(camera: CameraTarget): CameraSpringState {
  return {
    x: { value: camera.x, velocity: 0 },
    y: { value: camera.y, velocity: 0 },
    logScale: { value: Math.log(camera.scale), velocity: 0 },
  };
}

export function smoothDamp(axis: SpringAxis, target: number, smoothTime: number, dt: number): SpringAxis {
  const omega = 2 / Math.max(1e-4, smoothTime);
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = axis.value - target;
  const temp = (axis.velocity + omega * change) * dt;
  return {
    velocity: (axis.velocity - omega * temp) * decay,
    value: target + (change + temp) * decay,
  };
}

export function stepCameraSpring(
  state: CameraSpringState,
  target: CameraTarget,
  dtSeconds: number,
  smoothTime: number = CAMERA_SMOOTH_TIME_S,
): CameraSpringState {
  const dt = Math.min(MAX_STEP_S, Math.max(0, dtSeconds));
  if (dt === 0) return state;
  return {
    x: smoothDamp(state.x, target.x, smoothTime, dt),
    y: smoothDamp(state.y, target.y, smoothTime, dt),
    logScale: smoothDamp(state.logScale, Math.log(target.scale), smoothTime, dt),
  };
}

export function cameraOf(state: CameraSpringState): CameraTarget {
  return { x: state.x.value, y: state.y.value, scale: Math.exp(state.logScale.value) };
}

/** Close enough, and slow enough, that snapping to the target is invisible. */
export function isCameraSettled(state: CameraSpringState, target: CameraTarget): boolean {
  const { x, y, logScale } = state;
  return (
    Math.abs(x.value - target.x) < 0.2 &&
    Math.abs(y.value - target.y) < 0.2 &&
    Math.abs(logScale.value - Math.log(target.scale)) < 0.0005 &&
    Math.abs(x.velocity) < 2 &&
    Math.abs(y.velocity) < 2 &&
    Math.abs(logScale.velocity) < 0.01
  );
}
