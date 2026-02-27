// client/src/components/Board.tsx
import { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { DominoTile } from './DominoTile';
import type { Tile, BoardState, PlacementPosition, Move } from '../types';

// ─── Layout Constants ────────────────────────────────────────

// Tile dimensions in layout units (1 unit = 1 pip half)
const TILE_UNIT = 1;
const TILE_GAP = 0.15;
const DOUBLE_CROSS_GAP = 0.2;

// ─── Types ───────────────────────────────────────────────────

interface LayoutTile {
  tile: Tile;
  x: number;
  y: number;
  rotation: number;
  flipped: boolean;
  key: string;
}

interface LayoutZone {
  position: PlacementPosition;
  x: number;
  y: number;
  width: number;
  height: number;
  // Outward direction from endpoint center in layout lane coordinates.
  dirX: number;
  dirY: number;
  lane: 'horizontal' | 'vertical';
  key: string;
}

interface BoardLayout {
  tiles: LayoutTile[];
  zones: LayoutZone[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function isDouble(tile: Tile): boolean {
  return tile.high === tile.low;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

interface HubLookup {
  byMainIndex: Map<number, BoardState['hubDoubles'][number]>;
  byLaneDepth: Map<string, number>;
  byId: Map<number, BoardState['hubDoubles'][number]>;
}

// ─── Layout Engine ───────────────────────────────────────────

function computeLayout(board: BoardState | null, validPositions: PlacementPosition[]): BoardLayout {
  const tiles: LayoutTile[] = [];
  const zones: LayoutZone[] = [];

  if (!board) {
    // Empty board - opening placement zone
    if (validPositions.includes('left')) {
      zones.push({
        position: 'left',
        x: 0,
        y: 0,
        width: TILE_UNIT * 2,
        height: TILE_UNIT,
        dirX: 0,
        dirY: 0,
        lane: 'horizontal',
        key: 'zone-opening',
      });
    }

    if (zones.length > 0) {
      // Fit strictly to the opening placement zone footprint with a small breathing margin.
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const zone of zones) {
        const halfW = zone.width / 2;
        const halfH = zone.height / 2;
        minX = Math.min(minX, zone.x - halfW);
        maxX = Math.max(maxX, zone.x + halfW);
        minY = Math.min(minY, zone.y - halfH);
        maxY = Math.max(maxY, zone.y + halfH);
      }
      const margin = 0.5;
      return {
        tiles,
        zones,
        minX: minX - margin,
        maxX: maxX + margin,
        minY: minY - margin,
        maxY: maxY + margin,
      };
    }

    return {
      tiles,
      zones,
      minX: -1.5,
      maxX: 1.5,
      minY: -1,
      maxY: 1,
    };
  }

  const { mainLine, hubDoubles } = board;

  // Build hub lookup
  const hubLookup: HubLookup = {
    byMainIndex: new Map<number, BoardState['hubDoubles'][number]>(),
    byLaneDepth: new Map<string, number>(),
    byId: new Map<number, BoardState['hubDoubles'][number]>(),
  };
  for (let idx = 0; idx < hubDoubles.length; idx++) {
    const hub = hubDoubles[idx];
    const stableHubId = hub.hubId;
    if (typeof stableHubId !== 'number') continue;
    hubLookup.byId.set(stableHubId, hub);

    if ((hub.laneType ?? 'mainline') === 'mainline') {
      const mainIndex = hub.mainlineIndex ?? hub.tileIndex;
      hubLookup.byMainIndex.set(mainIndex, hub);
    }

    if (
      (hub.laneType ?? 'mainline') === 'branch' &&
      hub.laneRef &&
      typeof hub.branchDepth === 'number'
    ) {
      hubLookup.byLaneDepth.set(`${hub.laneRef}|${hub.branchDepth}`, stableHubId);
    }
  }

  const hubCenters = new Map<number, { x: number; y: number }>();
  const laidOutHubIds = new Set<number>();

  const layoutHubBranches = (
    hub: BoardState['hubDoubles'][number],
    hubId: number,
    hubX: number,
    hubY: number,
    laneHorizontal: boolean,
  ) => {
    if (laidOutHubIds.has(hubId)) {
      return { tiles: [] as LayoutTile[], zones: [] as LayoutZone[], minY: hubY, maxY: hubY };
    }
    laidOutHubIds.add(hubId);
    hubCenters.set(hubId, { x: hubX, y: hubY });
    return layoutBranches(
      hub,
      hubId,
      hubX,
      hubY,
      validPositions,
      hubLookup,
      hubCenters,
      layoutHubBranches,
      laneHorizontal,
    );
  };

  // First pass: calculate total width of main line
  let totalWidth = 0;
  for (let i = 0; i < mainLine.length; i++) {
    const pt = mainLine[i];
    const double = isDouble(pt.tile);

    if (i > 0) totalWidth += TILE_GAP;
    totalWidth += double ? TILE_UNIT : TILE_UNIT * 2;
  }

  // Start position (centered horizontally)
  let currentX = -totalWidth / 2;
  const mainY = 0;

  // Track bounds
  let minX = currentX - 2;
  let maxX = -currentX + 2;
  let minY = -TILE_UNIT;
  let maxY = TILE_UNIT;

  // Second pass: place tiles
  for (let i = 0; i < mainLine.length; i++) {
    const pt = mainLine[i];
    const double = isDouble(pt.tile);
    const hub = hubLookup.byMainIndex.get(i);

    const tileWidth = double ? TILE_UNIT : TILE_UNIT * 2;
    const centerX = currentX + tileWidth / 2;

    // Doubles are perpendicular (90 deg rotation)
    const rotation = double ? 90 : 0;
    const flipped = pt.orientation.endsWith('flipped');

    tiles.push({
      tile: pt.tile,
      x: centerX,
      y: mainY,
      rotation,
      flipped,
      key: `main-${pt.tile.high}-${pt.tile.low}`,
    });

    // Layout branches from this hub
    if (hub && hub.isCrossed && typeof hub.hubId === 'number') {
      // Mainline is horizontal.
      const branchResult = layoutHubBranches(hub, hub.hubId, centerX, mainY, true);
      tiles.push(...branchResult.tiles);
      zones.push(...branchResult.zones);
      minY = Math.min(minY, branchResult.minY);
      maxY = Math.max(maxY, branchResult.maxY);
    }

    currentX += tileWidth + TILE_GAP;
  }

  // Update X bounds
  minX = -totalWidth / 2 - 3;
  maxX = totalWidth / 2 + 3;

  // Main line placement zones
  if (validPositions.includes('left')) {
    const leftX = -totalWidth / 2 - TILE_GAP - TILE_UNIT;
    zones.push({
      position: 'left',
      x: leftX,
      y: mainY,
      width: TILE_UNIT * 2,
      height: TILE_UNIT,
      dirX: -1,
      dirY: 0,
      lane: 'horizontal',
      key: 'zone-left',
    });
    minX = Math.min(minX, leftX - TILE_UNIT);
  }

  if (validPositions.includes('right')) {
    const rightX = totalWidth / 2 + TILE_GAP + TILE_UNIT;
    zones.push({
      position: 'right',
      x: rightX,
      y: mainY,
      width: TILE_UNIT * 2,
      height: TILE_UNIT,
      dirX: 1,
      dirY: 0,
      lane: 'horizontal',
      key: 'zone-right',
    });
    maxX = Math.max(maxX, rightX + TILE_UNIT);
  }

  return {
    tiles,
    zones,
    // Keep full placement-zone footprints visible near edges during camera auto-fit.
    // Existing 1.0 breathing room + requested additional 1.5 => total 2.5 units.
    minX: minX - 2.5,
    maxX: maxX + 2.5,
    minY: minY - 2.5,
    maxY: maxY + 2.5,
  };
}

function layoutBranches(
  hub: BoardState['hubDoubles'][number],
  hubId: number,
  hubX: number,
  hubY: number,
  validPositions: PlacementPosition[],
  hubLookup: HubLookup,
  hubCenters: Map<number, { x: number; y: number }>,
  layoutHubBranches: (
    hub: BoardState['hubDoubles'][number],
    hubId: number,
    hubX: number,
    hubY: number,
    laneHorizontal: boolean,
  ) => { tiles: LayoutTile[]; zones: LayoutZone[]; minY: number; maxY: number },
  laneHorizontal: boolean,
): { tiles: LayoutTile[]; zones: LayoutZone[]; minY: number; maxY: number } {
  const tiles: LayoutTile[] = [];
  const zones: LayoutZone[] = [];
  let minY = hubY - TILE_UNIT / 2;
  let maxY = hubY + TILE_UNIT / 2;
  let minX = hubX - TILE_UNIT / 2;
  let maxX = hubX + TILE_UNIT / 2;

  // Branch arms are always perpendicular to the lane this hub is on.
  const verticalArms = laneHorizontal;

  // arm 0: up (horizontal lane) / left (vertical lane)
  // arm 1: down (horizontal lane) / right (vertical lane)
  const directions = [-1, 1];

  for (let armIdx = 0; armIdx < 2; armIdx++) {
    const direction = directions[armIdx];
    const branch = hub.branches[armIdx];

    // Start position for branch
    let currentX = hubX + (verticalArms ? 0 : direction * (TILE_UNIT + DOUBLE_CROSS_GAP));
    let currentY = hubY + (verticalArms ? direction * (TILE_UNIT + DOUBLE_CROSS_GAP) : 0);

    if (branch && branch.tiles.length > 0) {
      // Layout branch tiles
      for (let i = 0; i < branch.tiles.length; i++) {
        const pt = branch.tiles[i];
        const double = isDouble(pt.tile);

        const tileSpan = double ? TILE_UNIT : TILE_UNIT * 2;
        const rotation = verticalArms ? (double ? 0 : 90) : double ? 90 : 0;

        // Arm-0 needs inverted flip relative to arm-1 for both vertical and horizontal lanes.
        const serverFlipped = pt.orientation.endsWith('flipped');
        const flipped = armIdx === 0 ? !serverFlipped : serverFlipped;

        const centerX = verticalArms ? currentX : currentX + direction * (tileSpan / 2);
        const centerY = verticalArms ? currentY + direction * (tileSpan / 2) : currentY;

        tiles.push({
          tile: pt.tile,
          x: centerX,
          y: centerY,
          rotation,
          flipped,
          key: `branch-${hubId}-${armIdx}-${i}`,
        });

        if (double) {
          const laneRef = `branch-${hubId}-${armIdx}`;
          const childHubId = hubLookup.byLaneDepth.get(`${laneRef}|${i}`);
          if (typeof childHubId === 'number') {
            hubCenters.set(childHubId, { x: centerX, y: centerY });
            const childHub = hubLookup.byId.get(childHubId);
            if (childHub && childHub.isCrossed) {
              // Child hub is on this branch lane (perpendicular to parent lane).
              const nested = layoutHubBranches(
                childHub,
                childHubId,
                centerX,
                centerY,
                !laneHorizontal,
              );
              tiles.push(...nested.tiles);
              zones.push(...nested.zones);
              minX = Math.min(minX, ...nested.tiles.map((t) => t.x));
              maxX = Math.max(maxX, ...nested.tiles.map((t) => t.x));
              minY = Math.min(minY, nested.minY);
              maxY = Math.max(maxY, nested.maxY);
            }
          }
        }

        if (verticalArms) {
          currentY = centerY + direction * (tileSpan / 2 + TILE_GAP);
        } else {
          currentX = centerX + direction * (tileSpan / 2 + TILE_GAP);
        }
        minX = Math.min(minX, centerX - (verticalArms ? TILE_UNIT / 2 : tileSpan / 2));
        maxX = Math.max(maxX, centerX + (verticalArms ? TILE_UNIT / 2 : tileSpan / 2));
        minY = Math.min(minY, centerY - (verticalArms ? tileSpan / 2 : TILE_UNIT / 2));
        maxY = Math.max(maxY, centerY + (verticalArms ? tileSpan / 2 : TILE_UNIT / 2));
      }

      // Placement zone at end of branch
      const branchPos: PlacementPosition = `branch-${hubId}-${armIdx}`;
      if (validPositions.includes(branchPos)) {
        const zoneX = verticalArms ? currentX : currentX + direction * TILE_UNIT;
        const zoneY = verticalArms ? currentY + direction * TILE_UNIT : currentY;
        zones.push({
          position: branchPos,
          x: zoneX,
          y: zoneY,
          width: verticalArms ? TILE_UNIT : TILE_UNIT * 2,
          height: verticalArms ? TILE_UNIT * 2 : TILE_UNIT,
          dirX: verticalArms ? 0 : direction,
          dirY: verticalArms ? direction : 0,
          lane: verticalArms ? 'vertical' : 'horizontal',
          key: `zone-branch-${hubId}-${armIdx}`,
        });
        minX = Math.min(minX, zoneX - (verticalArms ? TILE_UNIT / 2 : TILE_UNIT));
        maxX = Math.max(maxX, zoneX + (verticalArms ? TILE_UNIT / 2 : TILE_UNIT));
        minY = Math.min(minY, zoneY - (verticalArms ? TILE_UNIT : TILE_UNIT / 2));
        maxY = Math.max(maxY, zoneY + (verticalArms ? TILE_UNIT : TILE_UNIT / 2));
      }
    } else {
      // No branch yet - show placement zone if valid
      const branchPos: PlacementPosition = `branch-${hubId}-${armIdx}`;
      if (validPositions.includes(branchPos)) {
        const zoneX = verticalArms ? currentX : currentX + direction * TILE_UNIT;
        const zoneY = verticalArms ? currentY + direction * TILE_UNIT : currentY;
        zones.push({
          position: branchPos,
          x: zoneX,
          y: zoneY,
          width: verticalArms ? TILE_UNIT : TILE_UNIT * 2,
          height: verticalArms ? TILE_UNIT * 2 : TILE_UNIT,
          dirX: verticalArms ? 0 : direction,
          dirY: verticalArms ? direction : 0,
          lane: verticalArms ? 'vertical' : 'horizontal',
          key: `zone-branch-${hubId}-${armIdx}`,
        });
        minX = Math.min(minX, zoneX - (verticalArms ? TILE_UNIT / 2 : TILE_UNIT));
        maxX = Math.max(maxX, zoneX + (verticalArms ? TILE_UNIT / 2 : TILE_UNIT));
        minY = Math.min(minY, zoneY - (verticalArms ? TILE_UNIT : TILE_UNIT / 2));
        maxY = Math.max(maxY, zoneY + (verticalArms ? TILE_UNIT : TILE_UNIT / 2));
      }
    }
  }

  return { tiles, zones, minY, maxY };
}

// ─── Board Component ─────────────────────────────────────────

interface BoardProps {
  board: BoardState | null;
  legalMoves: Move[];
  selectedTile: Tile | null;
  onPositionClick: (position: PlacementPosition) => void;
  tileSize?: number;
  showOpenEndGlow?: boolean;
}

export function Board({
  board,
  legalMoves,
  selectedTile,
  onPositionClick,
  tileSize = 72,
  showOpenEndGlow = false,
}: BoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRetryRafRef = useRef<number | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredZoom, setHoveredZoom] = useState<'in' | 'out' | null>(null);
  const dragStart = useRef({ x: 0, y: 0, camX: 0, camY: 0 });
  const showTargetDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('BOARD_TARGET_DEBUG') === '1';

  // Get valid positions for the selected tile
  const validPositions = useMemo((): PlacementPosition[] => {
    if (!selectedTile) return [];
    return legalMoves
      .filter((m) => m.type === 'play' && m.tile && tileEquals(m.tile, selectedTile))
      .map((m) => m.position!)
      .filter(Boolean);
  }, [selectedTile, legalMoves]);

  // Compute layout
  const layout = useMemo(() => {
    return computeLayout(board, validPositions);
  }, [board, validPositions]);

  const openEndPositions = useMemo(() => {
    if (!board) return [] as PlacementPosition[];
    const positions: PlacementPosition[] = ['left', 'right'];
    for (const hub of board.hubDoubles ?? []) {
      if (typeof hub.hubId !== 'number') continue;
      const hubId = hub.hubId;
      positions.push(`branch-${hubId}-0`, `branch-${hubId}-1`);
    }
    return positions;
  }, [board]);

  const glowLayout = useMemo(() => {
    if (!showOpenEndGlow) return null;
    return computeLayout(board, openEndPositions);
  }, [showOpenEndGlow, board, openEndPositions]);

  // Convert layout units to pixels
  const unitToPixels = tileSize;
  // Calculate board center offset
  const centerX = (layout.minX + layout.maxX) / 2;
  const centerY = (layout.minY + layout.maxY) / 2;

  function fitCameraToContainer(width?: number, height?: number) {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerWidth = width ?? rect.width;
    const containerHeight = height ?? rect.height;
    if (containerWidth < 2 || containerHeight < 2) {
      // Mobile can report 0x0 before layout settles; retry next frame.
      if (typeof window !== 'undefined' && fitRetryRafRef.current === null) {
        fitRetryRafRef.current = window.requestAnimationFrame(() => {
          fitRetryRafRef.current = null;
          fitCameraToContainer();
        });
      }
      return;
    }

    const layoutWidth = (layout.maxX - layout.minX) * unitToPixels;
    const layoutHeight = (layout.maxY - layout.minY) * unitToPixels;
    if (layoutWidth <= 0 || layoutHeight <= 0) return;

    // Calculate scale to fit
    const layoutSpanUnits = Math.max(layout.maxX - layout.minX, layout.maxY - layout.minY);
    const targetFill = layoutSpanUnits >= 10 ? 0.93 : 0.9;
    const scaleX = (containerWidth * targetFill) / layoutWidth;
    const scaleY = (containerHeight * targetFill) / layoutHeight;
    const fitScale = Math.min(1.45, Math.max(0.42, Math.min(scaleX, scaleY)));

    setCamera({ x: 0, y: 0, scale: fitScale });
  }

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
      fitCameraToContainer(rect.width, rect.height);
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
      fitCameraToContainer();
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
  }, [layout, unitToPixels]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setCamera((cam) => ({
      ...cam,
      scale: Math.min(1.8, Math.max(0.5, cam.scale * delta)),
    }));
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        camX: camera.x,
        camY: camera.y,
      };
    },
    [camera.x, camera.y],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setCamera((cam) => ({
        ...cam,
        x: dragStart.current.camX + dx,
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
    fitCameraToContainer();
  }, [layout, unitToPixels]);

  const applyZoomStep = useCallback((delta: number) => {
    setCamera((cam) => ({
      ...cam,
      scale: Math.min(1.8, Math.max(0.3, cam.scale + delta)),
    }));
  }, []);

  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  return (
    <div
      ref={containerRef}
      className="board-container"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
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
        {/* Render tiles */}
        {layout.tiles.map((lt) => {
          const x = (lt.x - centerX) * unitToPixels;
          const y = (lt.y - centerY) * unitToPixels;
          const tileIsDouble = isDouble(lt.tile);

          return (
            <div
              key={lt.key}
              className="board-tile-wrapper"
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
                disabled
                className={`board-tile ${tileIsDouble ? 'hub-double' : ''}`}
              />
            </div>
          );
        })}

        {/* Render placement zones */}
        {layout.zones.map((zone) => {
          const outwardPx = tileSize * 0.16;
          const x = (zone.x - centerX) * unitToPixels + zone.dirX * outwardPx;
          const y = (zone.y - centerY) * unitToPixels + zone.dirY * outwardPx;
          const width = zone.width * unitToPixels;
          const height = zone.height * unitToPixels;

          // Determine arrow direction from computed endpoint direction.
          let arrow = '+';
          if (zone.dirX < 0) arrow = '←';
          else if (zone.dirX > 0) arrow = '→';
          else if (zone.dirY < 0) arrow = '↑';
          else if (zone.dirY > 0) arrow = '↓';

          return (
            <div
              key={zone.key}
              className={`placement-zone active${showTargetDebug ? ' debug' : ''}`}
              style={{
                position: 'absolute',
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                width,
                height,
                transform: 'translate(-50%, -50%)',
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPositionClick(zone.position);
              }}
              data-lane={zone.lane}
              data-dir={`${zone.dirX},${zone.dirY}`}
              data-position={zone.position}
            >
              <span className="placement-arrow">{arrow}</span>
              {showTargetDebug && (
                <span className="placement-debug-label">
                  {zone.lane} ({zone.dirX},{zone.dirY})
                </span>
              )}
            </div>
          );
        })}

        {showOpenEndGlow &&
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
      <div
        className="board-zoom-tray"
        style={{
          position: 'absolute',
          bottom: 10,
          left: 10,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(255,255,255,0.06)',
          borderRadius: 999,
          padding: '4px 6px',
          border: '1px solid rgba(236,252,245,0.24)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <button
          className="board-zoom-btn"
          title="Zoom out"
          onMouseEnter={() => setHoveredZoom('out')}
          onMouseLeave={() => setHoveredZoom(null)}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applyZoomStep(-0.12);
          }}
          style={{
            padding: '4px 8px',
            color: 'rgba(200,220,215,0.7)',
            fontSize: '0.9rem',
            lineHeight: 1,
            background: hoveredZoom === 'out' ? 'rgba(255,255,255,0.08)' : 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 8,
          }}
        >
          −
        </button>
        <div
          className="board-zoom-divider"
          style={{
            width: 1,
            height: 16,
            margin: '0 4px',
            background: 'rgba(236,252,245,0.24)',
          }}
        />
        <button
          className="board-zoom-btn"
          title="Zoom in"
          onMouseEnter={() => setHoveredZoom('in')}
          onMouseLeave={() => setHoveredZoom(null)}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            applyZoomStep(0.12);
          }}
          style={{
            padding: '4px 8px',
            color: 'rgba(200,220,215,0.7)',
            fontSize: '0.9rem',
            lineHeight: 1,
            background: hoveredZoom === 'in' ? 'rgba(255,255,255,0.08)' : 'none',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            borderRadius: 8,
          }}
        >
          +
        </button>
      </div>
    </div>
  );
}

export default Board;
