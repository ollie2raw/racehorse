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

export interface UseBoardPointerControlsParams {
  camera: BoardCameraState;
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
  camera,
  setCamera,
  minCameraScale,
  manualCameraRef,
  markManualCamera,
  fitCameraToContainer,
  fitCameraToContainerRef,
}: UseBoardPointerControlsParams): UseBoardPointerControlsResult {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, camX: 0, camY: 0 });

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
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement)?.closest('.placement-zone')) {
        return;
      }
      markManualCamera();
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        camX: camera.x,
        camY: camera.y,
      };
    },
    [camera.x, camera.y, markManualCamera],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setCamera((cam) => ({
        ...cam,
        x: (() => {
          const nextX = dragStart.current.camX + dx;
          const nextY = dragStart.current.camY + dy;
          traceCameraDebug('[camera-debug] setCamera', {
            reason: 'drag',
            x: Number(nextX.toFixed(2)),
            y: Number(nextY.toFixed(2)),
            scale: Number(cam.scale.toFixed(3)),
          });
          return nextX;
        })(),
        y: dragStart.current.camY + dy,
      }));
    },
    [isDragging, setCamera],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
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
