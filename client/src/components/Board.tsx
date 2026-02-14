// client/src/components/Board.tsx
import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { DominoTile } from "./DominoTile";
import type { Tile, BoardState, PlacementPosition, Move } from "../types";

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

// ─── Layout Engine ───────────────────────────────────────────

function computeLayout(
  board: BoardState | null,
  validPositions: PlacementPosition[]
): BoardLayout {
  const tiles: LayoutTile[] = [];
  const zones: LayoutZone[] = [];

  if (!board) {
    // Empty board - opening placement zone
    if (validPositions.includes("left")) {
      zones.push({
        position: "left",
        x: 0,
        y: 0,
        width: TILE_UNIT * 2,
        height: TILE_UNIT,
        key: "zone-opening",
      });
    }

    return {
      tiles,
      zones,
      minX: -2,
      maxX: 2,
      minY: -2,
      maxY: 2,
    };
  }

  const { mainLine, hubDoubles } = board;

  // Build hub lookup
  const hubsByIndex = new Map<number, typeof hubDoubles[number]>();
  for (const hub of hubDoubles) {
    hubsByIndex.set(hub.tileIndex, hub);
  }

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
    const hub = hubsByIndex.get(i);

    const tileWidth = double ? TILE_UNIT : TILE_UNIT * 2;
    const centerX = currentX + tileWidth / 2;

    // Doubles are perpendicular (90 deg rotation)
    const rotation = double ? 90 : 0;
    const flipped = pt.orientation.endsWith("flipped");

    tiles.push({
      tile: pt.tile,
      x: centerX,
      y: mainY,
      rotation,
      flipped,
      key: `main-${i}`,
    });

    // Layout branches from this hub
    if (hub && hub.isCrossed) {
      const branchResult = layoutBranches(
        hub,
        hubDoubles.indexOf(hub),
        centerX,
        mainY,
        validPositions
      );
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
  if (validPositions.includes("left")) {
    const leftX = -totalWidth / 2 - TILE_GAP - TILE_UNIT;
    zones.push({
      position: "left",
      x: leftX,
      y: mainY,
      width: TILE_UNIT * 2,
      height: TILE_UNIT,
      key: "zone-left",
    });
    minX = Math.min(minX, leftX - TILE_UNIT);
  }

  if (validPositions.includes("right")) {
    const rightX = totalWidth / 2 + TILE_GAP + TILE_UNIT;
    zones.push({
      position: "right",
      x: rightX,
      y: mainY,
      width: TILE_UNIT * 2,
      height: TILE_UNIT,
      key: "zone-right",
    });
    maxX = Math.max(maxX, rightX + TILE_UNIT);
  }

  return {
    tiles,
    zones,
    minX,
    maxX,
    minY,
    maxY,
  };
}

function layoutBranches(
  hub: BoardState["hubDoubles"][number],
  hubIdx: number,
  hubX: number,
  hubY: number,
  validPositions: PlacementPosition[]
): { tiles: LayoutTile[]; zones: LayoutZone[]; minY: number; maxY: number } {
  const tiles: LayoutTile[] = [];
  const zones: LayoutZone[] = [];
  let minY = hubY - TILE_UNIT / 2;
  let maxY = hubY + TILE_UNIT / 2;

  // Branch 0 goes up (negative Y), Branch 1 goes down (positive Y)
  const directions = [-1, 1];

  for (let armIdx = 0; armIdx < 2; armIdx++) {
    const direction = directions[armIdx];
    const branch = hub.branches[armIdx];

    // Start position for branch
    let currentY = hubY + direction * (TILE_UNIT / 2 + DOUBLE_CROSS_GAP);

    if (branch && branch.tiles.length > 0) {
      // Layout branch tiles
      for (let i = 0; i < branch.tiles.length; i++) {
        const pt = branch.tiles[i];
        const double = isDouble(pt.tile);

        // On branches: non-doubles are vertical (90 deg), doubles are horizontal (0 deg)
        const tileHeight = double ? TILE_UNIT : TILE_UNIT * 2;
        const rotation = double ? 0 : 90;
        const flipped = pt.orientation.endsWith("flipped");

        const centerY = currentY + direction * (tileHeight / 2);

        tiles.push({
          tile: pt.tile,
          x: hubX,
          y: centerY,
          rotation,
          flipped,
          key: `branch-${hubIdx}-${armIdx}-${i}`,
        });

        currentY = centerY + direction * (tileHeight / 2 + TILE_GAP);
        minY = Math.min(minY, centerY - tileHeight / 2);
        maxY = Math.max(maxY, centerY + tileHeight / 2);
      }

      // Placement zone at end of branch
      const branchPos: PlacementPosition = `branch-${hubIdx}-${armIdx}`;
      if (validPositions.includes(branchPos)) {
        const zoneY = currentY + direction * TILE_UNIT;
        zones.push({
          position: branchPos,
          x: hubX,
          y: zoneY,
          width: TILE_UNIT,
          height: TILE_UNIT * 2,
          key: `zone-branch-${hubIdx}-${armIdx}`,
        });
        minY = Math.min(minY, zoneY - TILE_UNIT);
        maxY = Math.max(maxY, zoneY + TILE_UNIT);
      }
    } else {
      // No branch yet - show placement zone if valid
      const branchPos: PlacementPosition = `branch-${hubIdx}-${armIdx}`;
      if (validPositions.includes(branchPos)) {
        const zoneY = currentY + direction * TILE_UNIT;
        zones.push({
          position: branchPos,
          x: hubX,
          y: zoneY,
          width: TILE_UNIT,
          height: TILE_UNIT * 2,
          key: `zone-branch-${hubIdx}-${armIdx}`,
        });
        minY = Math.min(minY, zoneY - TILE_UNIT);
        maxY = Math.max(maxY, zoneY + TILE_UNIT);
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
}

export function Board({
  board,
  legalMoves,
  selectedTile,
  onPositionClick,
  tileSize = 60, // Increased from 40 to 60 (1.5x)
}: BoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, camX: 0, camY: 0 });

  // Get valid positions for the selected tile
  const validPositions = useMemo((): PlacementPosition[] => {
    if (!selectedTile) return [];
    return legalMoves
      .filter(m => m.type === "play" && m.tile && tileEquals(m.tile, selectedTile))
      .map(m => m.position!)
      .filter(Boolean);
  }, [selectedTile, legalMoves]);

  // Compute layout
  const layout = useMemo(() => {
    return computeLayout(board, validPositions);
  }, [board, validPositions]);

  // Convert layout units to pixels
  const unitToPixels = tileSize;

  // Auto-fit camera on layout change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const layoutWidth = (layout.maxX - layout.minX) * unitToPixels;
    const layoutHeight = (layout.maxY - layout.minY) * unitToPixels;

    // Calculate scale to fit
    const scaleX = (containerWidth - 40) / layoutWidth;
    const scaleY = (containerHeight - 40) / layoutHeight;
    const fitScale = Math.min(1.2, Math.max(0.6, Math.min(scaleX, scaleY)));

    setCamera({ x: 0, y: 0, scale: fitScale });
  }, [layout, unitToPixels]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setCamera(cam => ({
      ...cam,
      scale: Math.min(1.6, Math.max(0.6, cam.scale * delta)),
    }));
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      camX: camera.x,
      camY: camera.y,
    };
  }, [camera.x, camera.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setCamera(cam => ({
      ...cam,
      x: dragStart.current.camX + dx,
      y: dragStart.current.camY + dy,
    }));
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Double-click to reset
  const handleDoubleClick = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const layoutWidth = (layout.maxX - layout.minX) * unitToPixels;
    const layoutHeight = (layout.maxY - layout.minY) * unitToPixels;

    const scaleX = (containerWidth - 40) / layoutWidth;
    const scaleY = (containerHeight - 40) / layoutHeight;
    const fitScale = Math.min(1.2, Math.max(0.6, Math.min(scaleX, scaleY)));

    setCamera({ x: 0, y: 0, scale: fitScale });
  }, [layout, unitToPixels]);

  // Calculate board center offset
  const centerX = (layout.minX + layout.maxX) / 2;
  const centerY = (layout.minY + layout.maxY) / 2;

  // Check if there are any legal play moves (for showing helpful message)
  const hasLegalPlays = legalMoves.some(m => m.type === "play");

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
      style={{ cursor: isDragging ? "grabbing" : "grab" }}
    >
      {/* Show message when board is empty */}
      {!board && (
        <div className="board-empty-message">
          {hasLegalPlays && !selectedTile
            ? "Select a tile from your hand to play"
            : "No tiles played yet"}
        </div>
      )}

      <div
        className="board-canvas"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: "center center",
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
                position: "absolute",
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: "translate(-50%, -50%)",
              }}
            >
              <DominoTile
                tile={lt.tile}
                size={tileSize}
                rotation={lt.rotation}
                flipped={lt.flipped}
                disabled
                className={`board-tile ${tileIsDouble ? "hub-double" : ""}`}
              />
            </div>
          );
        })}

        {/* Render placement zones */}
        {layout.zones.map((zone) => {
          const x = (zone.x - centerX) * unitToPixels;
          const y = (zone.y - centerY) * unitToPixels;
          const width = zone.width * unitToPixels;
          const height = zone.height * unitToPixels;

          // Determine arrow direction
          let arrow = "+";
          if (zone.position === "left") arrow = "←";
          else if (zone.position === "right") arrow = "→";
          else if (zone.position.includes("-0")) arrow = "↑";
          else if (zone.position.includes("-1")) arrow = "↓";

          return (
            <div
              key={zone.key}
              className="placement-zone active"
              style={{
                position: "absolute",
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                width,
                height,
                transform: "translate(-50%, -50%)",
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPositionClick(zone.position);
              }}
            >
              <span className="placement-arrow">{arrow}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Board;
