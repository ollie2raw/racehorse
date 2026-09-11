// client/src/components/Board.tsx
import {
  forwardRef,
  memo,
  useImperativeHandle,
  useState,
  type ForwardedRef,
} from 'react';
import { DominoTile } from './DominoTile';
import { ZoomInIcon, ZoomOutIcon } from './MatchBoardControlIcons';
import type { Tile, BoardState, PlacementPosition, Move } from '../types';
import { tileEquals } from '../game/tileUtils';
import { isDouble } from '../game/openEndsGeometry';
import { useRenderProfiler } from '../debug/renderProfiler';
import { recordDailyFritzBoardMetric, traceDailyFritzBoardEvent } from './boardDiagnostics';
import { useBoardRenderLayout } from './board/useBoardRenderLayout';
import { useBoardCamera } from './board/useBoardCamera';
import { useBoardPointerControls } from './board/useBoardPointerControls';

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
  // Camera state lives here, not inside useBoardCamera below — its `.scale`
  // needs to exist for useBoardRenderLayout's debug trace before `layout`
  // (the value useBoardCamera's fit effects need) exists. Same render order
  // as the original single-component code; useBoardCamera owns the effects
  // that decide the camera, not the state itself.
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const showTargetDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('BOARD_TARGET_DEBUG') === '1';

  const { boardTileCount, layout, placementZones, glowLayout, resetSignature } = useBoardRenderLayout({
    board,
    legalMoves,
    selectedTile,
    handNumber,
    handOver,
    gameOver,
    showOpenEndGlow,
    staticView,
    profileDailyFritz,
    cameraScale: camera.scale,
  });

  // Convert layout units to pixels
  const unitToPixels = tileSize;

  const {
    containerRef,
    viewportSize,
    manualCameraRef,
    markManualCamera,
    fitCameraToContainer,
    fitCameraToContainerRef,
  } = useBoardCamera({
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
  });

  // Calculate board center offset
  const centerX = (layout.minX + layout.maxX) / 2;
  const centerY =
    staticView && staticFitMainline ? 0 : (layout.minY + layout.maxY) / 2;

  const {
    isDragging,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDoubleClick,
    applyZoomStep,
    resetCameraToFit,
  } = useBoardPointerControls({
    camera,
    setCamera,
    minCameraScale,
    manualCameraRef,
    markManualCamera,
    fitCameraToContainer,
    fitCameraToContainerRef,
  });

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
