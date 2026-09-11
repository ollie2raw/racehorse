// client/src/components/board/useBoardCamera.ts
//
// Extracted verbatim from Board.tsx (D2 Tier-1 — see
// docs/scoping/D2-board-tsx-decomposition-scoping.md). Owns the camera state
// and every effect that decides where the camera sits: the board-reset snap,
// the tile-placed auto-fit, and the ResizeObserver/double-rAF auto-fit that
// tracks the container. This is "the hard one" the doc calls out — the
// manualCameraRef / manualCameraUntilRef gating and the fitCameraToContainerRef
// mirror exist so a user's manual pan/zoom isn't fought by auto-fit, and so
// the ResizeObserver callback (created once) always calls the *current*
// fitCameraToContainer closure rather than a stale one from mount.
//
// Pointer handlers (wheel/drag/zoom-tray/double-click) stay in Board.tsx for
// now — they call the camera setter and this hook's markManualCamera /
// fitCameraToContainer, which is why this hook is extracted *before*
// useBoardPointerControls, reversing the doc's PR-3/PR-4 documentation order
// to match the real dependency direction (pointer controls consume the
// camera-fit machinery, not the other way around).
//
// The camera *state* itself (useState) stays in Board.tsx, not here — its
// `.scale` has to exist for useBoardRenderLayout's debug trace before
// `layout` (the value this hook's fit effects need) exists. This hook owns
// the setter's effects, not the state's creation, which is why its param is
// `setCamera` rather than `[camera, setCamera]`.
import { useCallback, useEffect, useRef, useState } from 'react';
import { calculateBoardFitScale, type BoardLayout } from './boardLayout';
import { traceCameraDebug } from '../boardDiagnostics';

export type BoardCameraState = { x: number; y: number; scale: number };

function cameraStatesEqual(a: BoardCameraState, b: BoardCameraState): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.scale - b.scale) < 0.001
  );
}

export interface UseBoardCameraParams {
  /**
   * The setter only — camera *state* is created in Board.tsx, not by this
   * hook, so its `.scale` is available to useBoardRenderLayout's debug trace
   * before `layout` (the one value this hook needs) exists. Same render
   * order as the original single-component code; this hook owns the effects
   * that decide the camera, not the state's creation.
   */
  setCamera: React.Dispatch<React.SetStateAction<BoardCameraState>>;
  layout: BoardLayout;
  containFullBoard: boolean;
  resolvedFitMode: 'default' | 'guided';
  boardTileCount: number;
  staticView: boolean;
  unitToPixels: number;
  minCameraScale: number;
  staticFitMainline: boolean;
  staticSpineAnchor?: number;
  /** Changes whenever the board should snap the camera back to origin (new hand / game-over). */
  resetSignature: string;
}

export interface UseBoardCameraResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  viewportSize: { width: number; height: number };
  manualCameraRef: React.MutableRefObject<boolean>;
  markManualCamera: () => void;
  fitCameraToContainer: (reason: string, width?: number, height?: number, force?: boolean) => void;
  fitCameraToContainerRef: React.MutableRefObject<
    (reason: string, width?: number, height?: number, force?: boolean) => void
  >;
}

export function useBoardCamera({
  setCamera,
  layout,
  containFullBoard,
  resolvedFitMode,
  boardTileCount,
  staticView,
  unitToPixels,
  minCameraScale,
  staticFitMainline,
  staticSpineAnchor,
  resetSignature,
}: UseBoardCameraParams): UseBoardCameraResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRetryRafRef = useRef<number | null>(null);
  const manualCameraRef = useRef(false);
  const manualCameraUntilRef = useRef(0);
  const lastResetSignatureRef = useRef('');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (lastResetSignatureRef.current === resetSignature) return;
    lastResetSignatureRef.current = resetSignature;
    manualCameraRef.current = false;
    traceCameraDebug('[camera-debug] setCamera', {
      reason: 'board-reset',
      x: 0,
      y: 0,
      scale: 1,
    });
    const resetCamera = { x: 0, y: 0, scale: 1 };
    setCamera((prev) => (cameraStatesEqual(prev, resetCamera) ? prev : resetCamera));
  }, [resetSignature, setCamera]);

  const markManualCamera = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    manualCameraRef.current = true;
    manualCameraUntilRef.current = now + 1500;
  }, []);

  // Stable ref so the RAF retry callback always calls the latest version,
  // avoiding a stale closure when layout/deps change between scheduling and firing.
  const fitCameraToContainerRef = useRef<(reason: string, width?: number, height?: number, force?: boolean) => void>(() => {});

  const fitCameraToContainer = useCallback((reason: string, width?: number, height?: number, force = false) => {
    const container = containerRef.current;
    if (!container) return;
    if (manualCameraRef.current && !force) {
      const now =
        typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      if (now < manualCameraUntilRef.current) return;
      manualCameraRef.current = false;
    }

    const rect = container.getBoundingClientRect();
    const containerWidth = width ?? rect.width;
    const containerHeight = height ?? rect.height;
    if (containerWidth < 2 || containerHeight < 2) {
      // Mobile can report 0x0 before layout settles; retry next frame.
      if (typeof window !== 'undefined' && fitRetryRafRef.current === null) {
        fitRetryRafRef.current = window.requestAnimationFrame(() => {
          fitRetryRafRef.current = null;
          fitCameraToContainerRef.current('retry');
        });
      }
      return;
    }

    // Calculate scale to fit
    const layoutSpanUnits = Math.max(layout.maxX - layout.minX, layout.maxY - layout.minY);
    const targetFill =
      containFullBoard
        ? 0.88
        : resolvedFitMode === 'guided'
        ? layoutSpanUnits <= 3
          ? 1.08
          : layoutSpanUnits <= 5
            ? 0.94
            : layoutSpanUnits <= 8
              ? 0.88
              : layoutSpanUnits >= 10
                ? 0.93
                : 0.9
        : layoutSpanUnits <= 3
          ? 0.52
          : layoutSpanUnits <= 5
            ? 0.65
            : layoutSpanUnits <= 8
              ? 0.82
              : layoutSpanUnits >= 10
                ? 0.92
                : 0.9;
    let maxFitScale =
      containFullBoard
        ? 1.8
        : resolvedFitMode === 'guided'
        ? boardTileCount <= 1
          ? 4.4
          : boardTileCount <= 4
            ? 3.2
            : boardTileCount <= 8
              ? 2.2
              : 1.6
        : boardTileCount <= 1
          ? 2.4
          : boardTileCount <= 4
            ? 2.1
            : boardTileCount <= 8
              ? 1.8
              : 1.65;

    if (staticView) {
      const diagramFill = 1.04;
      maxFitScale =
        boardTileCount <= 3 ? 11.6 : boardTileCount <= 5 ? 10.4 : boardTileCount <= 8 ? 9.2 : 8;
      const fitScale = calculateBoardFitScale({
        layout,
        tileSize: unitToPixels,
        viewportWidth: containerWidth,
        viewportHeight: containerHeight,
        targetFill: diagramFill,
        minScale: 0.22,
        maxScale: maxFitScale,
        multiplier: 2,
      });
      applyFitCamera(fitScale);
      return;
    }

    const fitScale = calculateBoardFitScale({
      layout,
      tileSize: unitToPixels,
      viewportWidth: containerWidth,
      viewportHeight: containerHeight,
      targetFill,
      minScale: minCameraScale,
      maxScale: maxFitScale,
    });

    applyFitCamera(fitScale);

    function applyFitCamera(nextScale: number) {
      let cameraY = 0;
      if (staticView && staticFitMainline && staticSpineAnchor != null) {
        const anchor = Math.min(0.85, Math.max(0.15, staticSpineAnchor));
        cameraY = containerHeight * (anchor - 0.5);
      }

      traceCameraDebug('[camera-debug] setCamera', {
        reason,
        x: 0,
        y: Number(cameraY.toFixed(1)),
        scale: Number(nextScale.toFixed(3)),
      });
      const nextCamera = { x: 0, y: cameraY, scale: nextScale };
      setCamera((prev) => (cameraStatesEqual(prev, nextCamera) ? prev : nextCamera));
    }
  }, [layout, containFullBoard, resolvedFitMode, boardTileCount, staticView, unitToPixels, minCameraScale, staticFitMainline, staticSpineAnchor, setCamera]);

  useEffect(() => {
    fitCameraToContainerRef.current = fitCameraToContainer;
  }, [fitCameraToContainer]);

  // Re-fit automatically when a new tile is placed, unless user has manually adjusted the camera.
  const prevBoardTileCountRef = useRef(boardTileCount);
  useEffect(() => {
    if (staticView) return;
    if (boardTileCount > prevBoardTileCountRef.current && !manualCameraRef.current) {
      fitCameraToContainerRef.current('tile-placed-auto-fit');
    }
    prevBoardTileCountRef.current = boardTileCount;
  }, [boardTileCount, staticView]);

  // Single authoritative camera auto-fit: respond to layout and container size.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const runFit = () => {
      const rect = container.getBoundingClientRect();
      setViewportSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
      fitCameraToContainer('effect-runFit', rect.width, rect.height);
    };
    runFit();
    const raf1 = window.requestAnimationFrame(runFit);
    const raf2 = window.requestAnimationFrame(() => window.requestAnimationFrame(runFit));

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.cancelAnimationFrame(raf1);
        window.cancelAnimationFrame(raf2);
      };
    }

    const observer = new ResizeObserver(() => {
      runFit();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (fitRetryRafRef.current !== null) {
        window.cancelAnimationFrame(fitRetryRafRef.current);
        fitRetryRafRef.current = null;
      }
    };
  }, [
    fitCameraToContainer,
    containFullBoard,
    layout,
    minCameraScale,
    resolvedFitMode,
    staticFitMainline,
    staticSpineAnchor,
    staticView,
    unitToPixels,
  ]);

  return {
    containerRef,
    viewportSize,
    manualCameraRef,
    markManualCamera,
    fitCameraToContainer,
    fitCameraToContainerRef,
  };
}
