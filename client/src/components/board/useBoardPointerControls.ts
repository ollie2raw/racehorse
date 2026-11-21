// client/src/components/board/useBoardPointerControls.ts
//
// Extracted verbatim from Board.tsx (D2 Tier-1, final hook — see
// docs/scoping/D2-board-tsx-decomposition-scoping.md). Wheel-zoom, drag-pan,
// double-click-to-fit, and the zoom-tray's applyZoomStep/resetCameraToFit —
// every pointer interaction that mutates the camera. Genuinely last of the
// three D2 hooks: its signature depends on useBoardCamera's output (the
// camera setter, markManualCamera, fitCameraToContainer), which is why the
// implementation order ended up reversed from the scoping doc's PR-3/PR-4
// documentation order (see useBoardCamera.ts's header for the full story).
import { useCallback, useRef, useState } from 'react';
import { traceCameraDebug } from '../boardDiagnostics';
import type { BoardCameraState } from './useBoardCamera';

/** How far a press must travel before it is a pan (and holds off auto-fit); a tap with a little finger jitter stays a tap. */
export const DRAG_THRESHOLD_PX = 4;

export interface UseBoardPointerControlsParams {
  setCamera: React.Dispatch<React.SetStateAction<BoardCameraState>>;
  minCameraScale: number;
  manualCameraRef: React.MutableRefObject<boolean>;
  markManualCamera: () => void;
  fitCameraToContainer: (reason: string, width?: number, height?: number, force?: boolean) => void;
  fitCameraToContainerRef: React.MutableRefObject<
    (reason: string, width?: number, height?: number, force?: boolean) => void
  >;
}

export interface UseBoardPointerControlsResult {
  isDragging: boolean;
  handleWheel: (e: React.WheelEvent) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleDoubleClick: () => void;
  applyZoomStep: (factor: number) => void;
  resetCameraToFit: () => void;
}

export function useBoardPointerControls({
  setCamera,
  minCameraScale,
  manualCameraRef,
  markManualCamera,
  fitCameraToContainer,
  fitCameraToContainerRef,
}: UseBoardPointerControlsParams): UseBoardPointerControlsResult {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, lastX: 0, lastY: 0, moved: false });

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    markManualCamera();
    setCamera((cam) => ({
      ...cam,
      scale: (() => {
        const nextScale = Math.min(2.4, Math.max(minCameraScale, cam.scale * delta));
        traceCameraDebug('[camera-debug] setCamera', {
          reason: 'wheel',
          x: Number(cam.x.toFixed(2)),
          y: Number(cam.y.toFixed(2)),
          scale: Number(nextScale.toFixed(3)),
        });
        return nextScale;
      })(),
    }));
  }, [markManualCamera, minCameraScale, setCamera]);

  // Pan handlers
  //
  // The pan is incremental: every move adds its own delta (since the previous move) to the camera as it is NOW. It used to be absolute, from the
  // camera captured at mouse-down, and a refit that landed between the press and the first move (a placement, a resize) made the next move set
  // the camera back to the pre-refit basis: a backward jump. A press is also not a gesture until it travels DRAG_THRESHOLD_PX; the pan starts
  // from the pointer's position at that crossing, so the threshold distance is not a pop at the start of a drag.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement)?.closest('.placement-zone')) {
        return;
      }
      // A press is not a gesture until it moves: a tap on the board (a touch tap arrives as a mouse press) used to mark the camera manual
      // and hold off every auto-fit for 1.5 s.
      setIsDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      // The button was released where this page did not see it (outside the window): end the drag instead of panning on hover.
      if (e.buttons === 0) {
        setIsDragging(false);
        dragStart.current.moved = false;
        return;
      }
      const drag = dragStart.current;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        markManualCamera();
        return;
      }
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      markManualCamera();
      setCamera((cam) => {
        traceCameraDebug('[camera-debug] setCamera', {
          reason: 'drag',
          x: Number((cam.x + dx).toFixed(2)),
          y: Number((cam.y + dy).toFixed(2)),
          scale: Number(cam.scale.toFixed(3)),
        });
        return { ...cam, x: cam.x + dx, y: cam.y + dy };
      });
    },
    [isDragging, markManualCamera, setCamera],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStart.current.moved = false;
  }, []);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    manualCameraRef.current = false;
    fitCameraToContainer('double-click-reset', undefined, undefined, true);
  }, [fitCameraToContainer, manualCameraRef]);

  const applyZoomStep = useCallback((factor: number) => {
    markManualCamera();
    setCamera((cam) => ({
      ...cam,
      scale: (() => {
        const nextScale = Math.min(2.4, Math.max(minCameraScale, cam.scale * factor));
        traceCameraDebug('[camera-debug] setCamera', {
          reason: 'manual-zoom',
          x: Number(cam.x.toFixed(2)),
          y: Number(cam.y.toFixed(2)),
          scale: Number(nextScale.toFixed(3)),
        });
        return nextScale;
      })(),
    }));
  }, [markManualCamera, minCameraScale, setCamera]);

  const resetCameraToFit = useCallback(() => {
    manualCameraRef.current = false;
    fitCameraToContainerRef.current('manual-reset', undefined, undefined, true);
  }, [fitCameraToContainerRef, manualCameraRef]);

  return {
    isDragging,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
    applyZoomStep,
    resetCameraToFit,
  };
}
