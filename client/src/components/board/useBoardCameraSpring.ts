// client/src/components/board/useBoardCameraSpring.ts
//
// Drives the board canvas's transform from a camera TARGET through the spring in
// cameraSpring.ts. The target is still the React camera state (what auto-fit and the
// gestures set); this hook is the only thing that writes the canvas's transform, imperatively
// and once per animation frame, so the board animates without re-rendering React per frame.
//
// It snaps instead of animating when motion would be wrong or pointless:
//   - the first fit after mount, and the short settling window after any snap (the camera
//     fits several times in the first frames: immediately, next frame, after fonts/resize);
//   - a new hand / board reset (the snapKey changes);
//   - the container being resized (the snapKey changes), so dragging a window edge tracks 1:1;
//   - the player is panning or zooming by hand (manualCameraRef), so gestures stay direct;
//   - motion is not allowed (prefers-reduced-motion, or the tab is hidden).
import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import {
  cameraOf,
  createCameraSpring,
  isCameraSettled,
  stepCameraSpring,
  type CameraSpringState,
  type CameraTarget,
} from './cameraSpring';

/** After mount or a snap, targets within this window are applied instantly. */
export const CAMERA_WARMUP_MS = 450;

export interface UseBoardCameraSpringParams {
  canvasRef: RefObject<HTMLDivElement | null>;
  /** The target camera (React state). */
  camera: CameraTarget;
  /** False for static diagrams: the canvas keeps its React-rendered transform. */
  enabled: boolean;
  /** useMotionAllowed(): false under prefers-reduced-motion or while the tab is hidden. */
  motionAllowed: boolean;
  /** Changes when the camera must jump rather than glide (new hand, container resized). */
  snapKey: string;
  manualCameraRef: MutableRefObject<boolean>;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function writeCamera(canvas: HTMLElement, camera: CameraTarget, settled: boolean) {
  canvas.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
  // Lets CSS size placement-zone hit slop in screen pixels despite the camera scale.
  canvas.style.setProperty('--rh-camera-scale', String(camera.scale));
  // e2e and geometry tools wait for this before measuring.
  canvas.dataset.cameraSettled = settled ? 'true' : 'false';
}

export function useBoardCameraSpring({
  canvasRef,
  camera,
  enabled,
  motionAllowed,
  snapKey,
  manualCameraRef,
}: UseBoardCameraSpringParams) {
  const springRef = useRef<CameraSpringState | null>(null);
  const targetRef = useRef<CameraTarget>(camera);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const warmUntilRef = useRef(0);
  const snapKeyRef = useRef<string | null>(null);

  const { x, y, scale } = camera;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || !canvas) return;
    const target: CameraTarget = { x, y, scale };
    targetRef.current = target;
    const now = nowMs();

    const first = springRef.current === null;
    const snapKeyChanged = snapKeyRef.current !== snapKey;
    snapKeyRef.current = snapKey;
    const snap =
      first ||
      snapKeyChanged ||
      manualCameraRef.current ||
      !motionAllowed ||
      now < warmUntilRef.current;

    const cancel = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    if (snap) {
      cancel();
      springRef.current = createCameraSpring(target);
      // Open the settling window on the first fit and on a reset/resize, not on gestures.
      if (first || snapKeyChanged) warmUntilRef.current = now + CAMERA_WARMUP_MS;
      writeCamera(canvas, target, true);
      return;
    }

    if (rafRef.current !== null) return; // already animating: the loop reads the new target
    lastFrameRef.current = now;
    const frame = () => {
      const el = canvasRef.current;
      const spring = springRef.current;
      if (!el || !spring) {
        rafRef.current = null;
        return;
      }
      const t = nowMs();
      const dt = (t - lastFrameRef.current) / 1000;
      lastFrameRef.current = t;
      const next = stepCameraSpring(spring, targetRef.current, dt);
      if (isCameraSettled(next, targetRef.current)) {
        springRef.current = createCameraSpring(targetRef.current);
        writeCamera(el, targetRef.current, true);
        rafRef.current = null;
        return;
      }
      springRef.current = next;
      writeCamera(el, cameraOf(next), false);
      rafRef.current = window.requestAnimationFrame(frame);
    };
    writeCamera(canvas, cameraOf(springRef.current as CameraSpringState), false);
    rafRef.current = window.requestAnimationFrame(frame);
  }, [canvasRef, enabled, manualCameraRef, motionAllowed, snapKey, x, y, scale]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );
}
