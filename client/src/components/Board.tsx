// client/src/components/Board.tsx
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from 'react';
import { DominoTile } from './DominoTile';
import { ZoomInIcon, ZoomOutIcon } from './MatchBoardControlIcons';
import type { Tile, BoardState, PlacementPosition, Move } from '../types';
import { tileEquals } from '../game/tileUtils';
import { isDouble } from '../game/openEndsGeometry';
import { useRenderProfiler } from '../debug/renderProfiler';
import {
  recordDailyFritzBoardMetric,
  recordDailyFritzLayoutDebug,
  traceCameraDebug,
  traceDailyFritzBoardEvent,
} from './boardDiagnostics';
import {
  calculateBoardFitScale,
  computeBoardLayout,
  type BoardLayout,
} from './board/boardLayout';

// ─── Board Component ─────────────────────────────────────────

export interface BoardHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetCamera: () => void;
}

interface BoardProps {
  board: BoardState | null;
  legalMoves: Move[];
  selectedTile: Tile | null;
  handNumber?: number;
  handOver?: boolean;
  gameOver?: boolean;
  lastPlayedTile?: Tile | null;
  highlightedPosition?: PlacementPosition | null;
  highlightedEnds?: number[] | null;
  onPositionClick: (position: PlacementPosition) => void;
  tileSize?: number;
  showOpenEndGlow?: boolean;
  profileDailyFritz?: boolean;
  fitMode?: 'default' | 'guided';
  showZoomTray?: boolean;
  /** Learn/diagram preview: auto-fit only, no pan/zoom UI or drag. */
  staticView?: boolean;
  /** Pin vertical center to the main-line spine (y=0) so branches do not shift the row down. */
  staticFitMainline?: boolean;
  /** When set with staticFitMainline, place the spine at this fraction from the top (0–1). */
  staticSpineAnchor?: number;
  /** Fit the complete recursive board extent, including narrow review viewports. */
  containFullBoard?: boolean;
}

function highlightedEndsEqual(a?: number[] | null, b?: number[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function cameraStatesEqual(
  a: { x: number; y: number; scale: number },
  b: { x: number; y: number; scale: number },
): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.scale - b.scale) < 0.001
  );
}

function BoardComponent(
  {
    board,
    legalMoves,
    selectedTile,
    handNumber = 0,
    handOver = false,
    gameOver = false,
    lastPlayedTile = null,
    highlightedPosition = null,
    highlightedEnds = null,
    onPositionClick,
    tileSize = 72,
    showOpenEndGlow = false,
    profileDailyFritz = false,
    fitMode = 'default',
    showZoomTray = true,
    staticView = false,
    staticFitMainline = false,
    staticSpineAnchor,
    containFullBoard = false,
  }: BoardProps,
  ref: ForwardedRef<BoardHandle>,
) {
  const resolvedFitMode = staticView ? 'guided' : fitMode;
  const resolvedShowZoomTray = staticView ? false : showZoomTray;
  const minCameraScale = containFullBoard ? 0.08 : 0.22;
  useRenderProfiler('Board');
  if (profileDailyFritz) {
    recordDailyFritzBoardMetric('boardRenderCount', 1);
  }
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRetryRafRef = useRef<number | null>(null);
  const manualCameraRef = useRef(false);
  const manualCameraUntilRef = useRef(0);
  const lastResetSignatureRef = useRef('');
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const showTargetDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('BOARD_TARGET_DEBUG') === '1';

  const boardTileCount = board
    ? board.mainLine.length +
      board.hubDoubles.reduce(
        (sum, hub) =>
          sum +
          (hub.branches ?? []).reduce(
            (branchSum, branch) => branchSum + (branch?.tiles?.length ?? 0),
            0,
          ),
        0,
      )
    : 0;

  const isResettingBoard = !board || board.mainLine.length === 0;

  const openEndPositions = useMemo(() => {
    if (!board || isResettingBoard) return [] as PlacementPosition[];
    const positions: PlacementPosition[] = ['left', 'right'];
    for (const hub of board.hubDoubles ?? []) {
      if (typeof hub.hubId !== 'number' || !hub.isCrossed) continue;
      const hubId = hub.hubId;
      positions.push(`branch-${hubId}-0`, `branch-${hubId}-1`);
    }
    return positions;
  }, [board, isResettingBoard]);

  const validPositions = useMemo((): PlacementPosition[] => {
    if (!selectedTile) return [];
    return legalMoves
      .filter((m) => m.type === 'play' && m.tile && selectedTile && tileEquals(m.tile, selectedTile))
      .map((m) => m.position!)
      .filter(Boolean);
  }, [selectedTile, legalMoves]);

  const cameraFitPositions = useMemo(() => {
    if (staticView) return [] as PlacementPosition[];
    if (isResettingBoard) {
      return validPositions.length > 0 ? validPositions : (['left'] as PlacementPosition[]);
    }
    return selectedTile != null || showOpenEndGlow ? openEndPositions : [];
  }, [staticView, isResettingBoard, validPositions, openEndPositions, selectedTile, showOpenEndGlow]);

  const logLayoutDebug = useCallback(
    (validPositionsCount: number, selectedTileKey: string | null, layout: BoardLayout) => {
      if (typeof window === 'undefined') return;
      const timestamp =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? Number(performance.now().toFixed(2))
          : Date.now();
      recordDailyFritzLayoutDebug({
        tag: '[layout-debug]',
        timestamp,
        handNumber,
        handOver,
        gameOver,
        boardTileCount,
        openEndPositions,
        validPositionsCount,
        selectedTile: selectedTileKey,
        computedBounds: {
          minX: Number(layout.minX.toFixed(2)),
          maxX: Number(layout.maxX.toFixed(2)),
          minY: Number(layout.minY.toFixed(2)),
          maxY: Number(layout.maxY.toFixed(2)),
        },
        zoomScale: Number(camera.scale.toFixed(3)),
      });
    },
    [boardTileCount, camera.scale, gameOver, handNumber, handOver, openEndPositions],
  );

  // Keep the camera/layout stable when the player selects a tile.
  const layout = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe inside the layout memo — instrumentation, not a value the memo returns
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    traceCameraDebug('[camera-debug] computeLayout input', {
      boardTileCount,
      openEndPositions: cameraFitPositions,
      validPositions,
      selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
    });
    const nextLayout = computeBoardLayout(isResettingBoard ? null : board, cameraFitPositions);
    traceCameraDebug('[camera-debug] computeLayout output', {
      minX: Number(nextLayout.minX.toFixed(2)),
      maxX: Number(nextLayout.maxX.toFixed(2)),
      minY: Number(nextLayout.minY.toFixed(2)),
      maxY: Number(nextLayout.maxY.toFixed(2)),
      scale: Number(camera.scale.toFixed(3)),
    });
    if (profileDailyFritz) {
      // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe — instrumentation
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordDailyFritzBoardMetric('computeLayout', end - start);
      logLayoutDebug(validPositions.length, selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null, nextLayout);
    }
    return nextLayout;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the layout memo keys on the inputs that change its geometry; boardTileCount/camera.scale are derived from those and would only add churn
  }, [board, cameraFitPositions, profileDailyFritz, logLayoutDebug, selectedTile, validPositions, isResettingBoard]);
  const placementZones = useMemo(() => {
    // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe — instrumentation
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const zones = computeBoardLayout(isResettingBoard ? null : board, validPositions).zones;
    if (profileDailyFritz) {
      // eslint-disable-next-line react-hooks/purity -- performance.now() timing probe — instrumentation
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordDailyFritzBoardMetric('computeLayout', end - start);
      traceDailyFritzBoardEvent('[render] placementZones', {
        count: zones.length,
        selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      });
    }
    return zones;
  }, [board, validPositions, profileDailyFritz, selectedTile, isResettingBoard]);

  useEffect(() => {
    if (!profileDailyFritz) return;
    traceDailyFritzBoardEvent('[render] Board props', {
      selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      legalMovesCount: legalMoves.length,
    });
  }, [profileDailyFritz, selectedTile, legalMoves.length]);

  const glowLayout = useMemo(() => {
    if (!showOpenEndGlow) return null;
    return computeBoardLayout(isResettingBoard ? null : board, openEndPositions);
  }, [showOpenEndGlow, board, openEndPositions, isResettingBoard]);

  const resetSignature = useMemo(
    () => `${handNumber}:${gameOver}:${isResettingBoard}`,
    [gameOver, handNumber, isResettingBoard],
  );

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
  }, [resetSignature]);

  // Convert layout units to pixels
  const unitToPixels = tileSize;
  // Calculate board center offset
  const centerX = (layout.minX + layout.maxX) / 2;
  const centerY =
    staticView && staticFitMainline ? 0 : (layout.minY + layout.maxY) / 2;
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
  }, [markManualCamera, minCameraScale]);

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
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    manualCameraRef.current = false;
    fitCameraToContainer('double-click-reset', undefined, undefined, true);
  }, [fitCameraToContainer]);

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
  }, [markManualCamera, minCameraScale]);

  const resetCameraToFit = useCallback(() => {
    manualCameraRef.current = false;
    fitCameraToContainerRef.current('manual-reset', undefined, undefined, true);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => applyZoomStep(1.22),
      zoomOut: () => applyZoomStep(1 / 1.22),
      resetCamera: resetCameraToFit,
    }),
    [applyZoomStep, resetCameraToFit],
  );

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Domino board"
      className={`board-container${staticView ? ' board-container--static' : ''}`}
      onWheel={staticView ? undefined : handleWheel}
      onMouseDown={staticView ? undefined : handleMouseDown}
      onMouseMove={staticView ? undefined : handleMouseMove}
      onMouseUp={staticView ? undefined : handleMouseUp}
      onMouseLeave={staticView ? undefined : handleMouseUp}
      onDoubleClick={staticView ? undefined : handleDoubleClick}
      style={{
        cursor: staticView ? 'default' : isDragging ? 'grabbing' : 'grab',
        pointerEvents: staticView ? 'none' : undefined,
        touchAction: staticView ? 'none' : undefined,
      }}
    >
      <div
        className="board-canvas"
        style={{
          width: isMobile ? '100%' : viewportSize.width > 0 ? `${viewportSize.width}px` : '100%',
          height: isMobile ? '100%' : viewportSize.height > 0 ? `${viewportSize.height}px` : '100%',
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: 'center center',
        }}
      >
        {layout.tiles.map((lt) => {
          if (!lt.tile) return null;
          const x = (lt.x - centerX) * unitToPixels;
          const y = (lt.y - centerY) * unitToPixels;
          const tileIsDouble = isDouble(lt.tile);

          return (
            <div
              key={lt.key}
              className={`board-tile-wrapper ${
                lastPlayedTile != null && tileEquals(lt.tile, lastPlayedTile) ? 'is-last-played' : ''
              }`.trim()}
              style={{
                position: 'absolute',
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <DominoTile
                tile={lt.tile}
                size={tileSize}
                rotation={lt.rotation}
                flipped={lt.flipped}
                highlight={
                  (lastPlayedTile != null && tileEquals(lt.tile, lastPlayedTile)) ||
                  (highlightedEnds != null && (highlightedEnds.includes(lt.tile.low) || highlightedEnds.includes(lt.tile.high)))
                }
                disabled
                className={`board-tile ${tileIsDouble ? 'hub-double' : ''}`}
              />
            </div>
          );
        })}

        {/* Render placement zones */}
        {!staticView &&
          placementZones.map((zone) => {
          const outwardPx = tileSize * 0.16;
          const x = (zone.x - centerX) * unitToPixels + zone.dirX * outwardPx;
          const y = (zone.y - centerY) * unitToPixels + zone.dirY * outwardPx;
          const width = zone.width * unitToPixels;
          const height = zone.height * unitToPixels;

          // Opening tile uses '+'; ends use a direction glyph — same as 3cd8858.
          let arrow = '+';
          if (zone.dirX < 0) arrow = '←';
          else if (zone.dirX > 0) arrow = '→';
          else if (zone.dirY < 0) arrow = '↑';
          else if (zone.dirY > 0) arrow = '↓';

          const arrowLabel = zone.dirX < 0 ? 'left' : zone.dirX > 0 ? 'right' : zone.dirY < 0 ? 'up' : 'down';

          return (
            <button
              key={zone.key}
              type="button"
              className={`placement-zone active${showTargetDebug ? ' debug' : ''}${highlightedPosition === zone.position ? ' highlighted' : ''}`}
              aria-label={`Place tile ${arrowLabel} on ${zone.lane} lane`}
              style={{
                position: 'absolute',
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                width,
                height,
                transform: 'translate(-50%, -50%)',
                touchAction: 'none',
                padding: 0,
                cursor: 'pointer',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (profileDailyFritz) {
                  traceDailyFritzBoardEvent('[input] placement click', {
                    position: zone.position,
                  });
                }
                if (typeof onPositionClick !== 'function') {
                  return;
                }
                onPositionClick(zone.position);
              }}
              data-lane={zone.lane}
              data-dir={`${zone.dirX},${zone.dirY}`}
              data-position={zone.position}
            >
              <span className="placement-arrow" aria-hidden="true">{arrow}</span>
              {showTargetDebug && (
                <span className="placement-debug-label">
                  {zone.lane} ({zone.dirX},{zone.dirY})
                </span>
              )}
            </button>
          );
          })}

        {!staticView &&
          showOpenEndGlow &&
          selectedTile === null &&
          glowLayout?.zones.map((zone) => {
            const outwardPx = tileSize * 0.16;
            const x = (zone.x - centerX) * unitToPixels + zone.dirX * outwardPx;
            const y = (zone.y - centerY) * unitToPixels + zone.dirY * outwardPx;
            const width = zone.width * unitToPixels;
            const height = zone.height * unitToPixels;
            return (
              <div
                key={`glow-${zone.key}`}
                className="placement-zone open-end-glow"
                style={{
                  position: 'absolute',
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                  width,
                  height,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            );
          })}

      </div>
      {resolvedShowZoomTray ? (
      <div
        className="board-zoom-tray control-pill"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="board-zoom-btn"
          title="Zoom out"
          aria-label="Zoom out"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applyZoomStep(1 / 1.22);
          }}
        >
          <ZoomOutIcon />
        </button>
        <button
          type="button"
          className="board-zoom-btn"
          title="Zoom in"
          aria-label="Zoom in"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applyZoomStep(1.22);
          }}
        >
          <ZoomInIcon />
        </button>
      </div>
      ) : null}
    </div>
  );
}

function areBoardPropsEqual(prev: BoardProps, next: BoardProps): boolean {
  return (
    prev.board === next.board &&
    prev.legalMoves === next.legalMoves &&
    Boolean(prev.selectedTile && next.selectedTile && tileEquals(prev.selectedTile, next.selectedTile)) &&
    Boolean(prev.lastPlayedTile && next.lastPlayedTile && tileEquals(prev.lastPlayedTile, next.lastPlayedTile)) &&
    prev.highlightedPosition === next.highlightedPosition &&
    highlightedEndsEqual(prev.highlightedEnds, next.highlightedEnds) &&
    prev.onPositionClick === next.onPositionClick &&
    prev.tileSize === next.tileSize &&
    prev.showOpenEndGlow === next.showOpenEndGlow &&
    prev.profileDailyFritz === next.profileDailyFritz &&
    prev.fitMode === next.fitMode &&
    prev.showZoomTray === next.showZoomTray &&
    prev.staticView === next.staticView &&
    prev.staticFitMainline === next.staticFitMainline &&
    prev.staticSpineAnchor === next.staticSpineAnchor &&
    prev.containFullBoard === next.containFullBoard
  );
}

export const Board = memo(forwardRef(BoardComponent), areBoardPropsEqual);

export default Board;
