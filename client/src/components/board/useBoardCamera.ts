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
import { resolveBoardFitTargets } from './boardCameraFit';
import { ReservedRectsCache, clearScaleForReserved, type ContainerBox } from './boardCameraReserve';

export type BoardCameraState = { x: number; y: number; scale: number };

const ZERO_OFFSET = { x: 0, y: 0 } as const;

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
  /** Bounds are exact (phone-landscape): let a large board fill more of the container. */
  tightFit?: boolean;
  /**
   * How far the bounds centre sits from the world origin tiles are positioned against, in layout units
   * (boardWorldFrame.ts). The camera carries it as a translation so the bounds stay centred on screen.
   * Zero for static boards.
   */
  worldOffsetUnits?: { x: number; y: number };
  unitToPixels: number;
  minCameraScale: number;
  staticFitMainline: boolean;
  staticSpineAnchor?: number;
  /** Changes whenever the board should snap the camera back to origin (new hand / game-over). */
  resetSignature: string;
  /** Owned by Board.tsx (useBoardContainerHeight) so routing can measure the same element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
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
  tightFit = false,
  worldOffsetUnits = ZERO_OFFSET,
  unitToPixels,
  minCameraScale,
  staticFitMainline,
  staticSpineAnchor,
  resetSignature,
  containerRef,
}: UseBoardCameraParams): UseBoardCameraResult {
  const fitRetryRafRef = useRef<number | null>(null);
  const manualCameraRef = useRef(false);
  const manualCameraUntilRef = useRef(0);
  const lastResetSignatureRef = useRef('');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });

  // The container's box and the overlays' rects are measured, not read from the DOM on every fit: a read forces layout, and the fit runs on
  // every placement (and again on the following frames). They are re-measured when the container or an overlay resizes (ResizeObserver
  // below), when the set of overlays changes, or on a window resize; otherwise a fit costs no layout read at all.
  const boxRef = useRef<ContainerBox | null>(null);
  const reservedCacheRef = useRef(new ReservedRectsCache());
  const settledContainerRef = useRef<HTMLElement | null>(null);
  const measureBox = useCallback((): ContainerBox | null => {
    const container = containerRef.current;
    if (!container) return null;
    if (!boxRef.current) {
      const r = container.getBoundingClientRect();
      boxRef.current = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    return boxRef.current;
  }, [containerRef]);
  const invalidateMeasurements = useCallback(() => {
    boxRef.current = null;
    reservedCacheRef.current.invalidate();
  }, []);

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

    const box = measureBox();
    if (!box) return;
    const containerWidth = width ?? box.width;
    const containerHeight = height ?? box.height;
    if (containerWidth < 2 || containerHeight < 2) {
      // The box was measured too early: measure again next time.
      boxRef.current = null;
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
    const fitTargets = resolveBoardFitTargets({
      containFullBoard,
      resolvedFitMode,
      layoutSpanUnits,
      boardTileCount,
      tightFit,
    });
    const targetFill = fitTargets.targetFill;
    let maxFitScale = fitTargets.maxFitScale;

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

    // A board allowed to fill the container (tightFit) can run under the controls tray or a corner pill:
    // take the largest scale at which no tile touches one.
    applyFitCamera(
      tightFit
        ? clearScaleForReserved({
            layout,
            unitPx: unitToPixels,
            containerWidth,
            containerHeight,
            cameraX: 0,
            cameraY: 0,
            fitScale,
            minScale: minCameraScale,
            reserved: reservedCacheRef.current.get(container, box),
          })
        : fitScale,
    );

    function applyFitCamera(nextScale: number) {
      let cameraY = 0;
      if (staticView && staticFitMainline && staticSpineAnchor != null) {
        const anchor = Math.min(0.85, Math.max(0.15, staticSpineAnchor));
        cameraY = containerHeight * (anchor - 0.5);
      }

      traceCameraDebug('[camera-debug] setCamera', {
        reason,
        x: Number((-nextScale * worldOffsetUnits.x * unitToPixels).toFixed(1)),
        y: Number(cameraY.toFixed(1)),
        scale: Number(nextScale.toFixed(3)),
      });
      // Recentre in the camera, not by moving tiles: screen = centre + camera + scale * (tile - origin).
      const nextCamera = {
        x: -nextScale * worldOffsetUnits.x * unitToPixels,
        y: staticView ? cameraY : cameraY - nextScale * worldOffsetUnits.y * unitToPixels,
        scale: nextScale,
      };
      setCamera((prev) => (cameraStatesEqual(prev, nextCamera) ? prev : nextCamera));
    }
  }, [containerRef, measureBox, layout, containFullBoard, resolvedFitMode, boardTileCount, staticView, tightFit, worldOffsetUnits.x, worldOffsetUnits.y, unitToPixels, minCameraScale, staticFitMainline, staticSpineAnchor, setCamera]);

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

  const runFit = useCallback(() => {
    const box = measureBox();
    if (!box) return;
    setViewportSize((prev) =>
      Math.abs(prev.width - box.width) < 0.5 && Math.abs(prev.height - box.height) < 0.5
        ? prev
        : { width: box.width, height: box.height },
    );
    fitCameraToContainer('effect-runFit', box.width, box.height);
  }, [measureBox, fitCameraToContainer]);
  useEffect(
    () => () => {
      if (fitRetryRafRef.current !== null) window.cancelAnimationFrame(fitRetryRafRef.current);
    },
    [],
  );
  const runFitRef = useRef(runFit);
  useEffect(() => {
    runFitRef.current = runFit;
  }, [runFit]);

  // Re-measure and re-fit when the container (or an overlay that sits on it) changes size. Created once per container, not on every layout:
  // observing starts with a callback of its own, which used to re-run the fit (and its layout reads) after every placement.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observed = new Set<Element>([container]);
    const observer = new ResizeObserver(() => {
      invalidateMeasurements();
      runFitRef.current();
      // Overlays that appeared since: watch their size too.
      for (const el of reservedCacheRef.current.observed()) {
        if (!observed.has(el)) {
          observed.add(el);
          observer.observe(el);
        }
      }
    });
    observer.observe(container);
    const onWindowResize = () => invalidateMeasurements();
    window.addEventListener('resize', onWindowResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onWindowResize);
      invalidateMeasurements();
    };
  }, [containerRef, invalidateMeasurements, staticView]);

  // Single authoritative camera auto-fit: respond to layout. The settle fits on the next two frames are for a container that has just
  // appeared (fonts, safe-area insets, a layout that was not final yet); a later layout change only needs the immediate one, because a
  // container resize is caught by the observer above.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isNewContainer = settledContainerRef.current !== container;
    settledContainerRef.current = container;
    runFit();
    if (!isNewContainer) return;
    const raf1 = window.requestAnimationFrame(runFit);
    const raf2 = window.requestAnimationFrame(() => window.requestAnimationFrame(runFit));
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (fitRetryRafRef.current !== null) {
        window.cancelAnimationFrame(fitRetryRafRef.current);
        fitRetryRafRef.current = null;
      }
    };
  }, [
    containerRef,
    runFit,
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
