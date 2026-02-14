// client/src/components/Board.tsx
import { useMemo, useRef, useEffect, useState } from "react";
import { DominoTile } from "./DominoTile";
import type { Tile, BoardState, PlacementPosition, Move } from "../types";

// ─── Layout Constants ────────────────────────────────────────

// Tile dimensions in layout units
const TILE_UNIT = 50;        // Half-size unit (one pip-half)
const TILE_GAP = 6;          // Gap between tiles
const DOUBLE_CROSS_GAP = 8;  // Extra gap for doubles (perpendicular)

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
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
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
      width: TILE_UNIT * 4,
      height: TILE_UNIT * 4,
      offsetX: TILE_UNIT * 2,
      offsetY: TILE_UNIT * 2,
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

  // Track bounds for branches
  let minY = -TILE_UNIT;
  let maxY = TILE_UNIT;

  // Second pass: place tiles
  for (let i = 0; i < mainLine.length; i++) {
    const pt = mainLine[i];
    const double = isDouble(pt.tile);
    const hub = hubsByIndex.get(i);

    const tileWidth = double ? TILE_UNIT : TILE_UNIT * 2;
    const centerX = currentX + tileWidth / 2;

    // Determine rotation: doubles are vertical (90 deg)
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
  }

  // Calculate final dimensions with padding
  const padding = TILE_UNIT * 2;
  const width = totalWidth + padding * 2 + TILE_UNIT * 4; // Extra for placement zones
  const height = maxY - minY + padding * 2;

  return {
    tiles,
    zones,
    width,
    height,
    offsetX: width / 2,
    offsetY: -minY + padding,
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
  tileSize = 40,
}: BoardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

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

  // Scale factor from layout units to pixels
  const pixelScale = tileSize / TILE_UNIT;

  // Auto-scale to fit container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const containerWidth = container.clientWidth - 40; // padding
      const containerHeight = container.clientHeight - 40;

      const layoutWidth = layout.width * pixelScale;
      const layoutHeight = layout.height * pixelScale;

      const scaleX = containerWidth / layoutWidth;
      const scaleY = containerHeight / layoutHeight;

      // Use the smaller scale to fit, but cap at 1 (don't zoom in)
      const newScale = Math.min(1, scaleX, scaleY);
      setScale(Math.max(0.3, newScale)); // Minimum 30% scale
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(container);

    return () => observer.disconnect();
  }, [layout, pixelScale]);

  // Empty board with no valid plays
  if (!board && validPositions.length === 0) {
    return (
      <div ref={containerRef} className="board-container">
        <div className="board-canvas empty">
          <div className="board-empty-message">No tiles played yet</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="board-container">
      <div
        className="board-canvas"
        style={{
          width: layout.width * pixelScale,
          height: layout.height * pixelScale,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {/* Render tiles */}
        {layout.tiles.map((lt) => {
          const x = (lt.x + layout.offsetX) * pixelScale;
          const y = (lt.y + layout.offsetY) * pixelScale;
          const double = isDouble(lt.tile);

          return (
            <div
              key={lt.key}
              className="board-tile-wrapper"
              style={{
                position: "absolute",
                left: x,
                top: y,
                transform: "translate(-50%, -50%)",
              }}
            >
              <DominoTile
                tile={lt.tile}
                size={tileSize}
                rotation={lt.rotation}
                flipped={lt.flipped}
                disabled
                className={`board-tile ${double ? "hub-double" : ""}`}
              />
            </div>
          );
        })}

        {/* Render placement zones */}
        {layout.zones.map((zone) => {
          const x = (zone.x + layout.offsetX) * pixelScale;
          const y = (zone.y + layout.offsetY) * pixelScale;
          const width = zone.width * pixelScale;
          const height = zone.height * pixelScale;

          // Determine arrow direction
          let arrow = "↔";
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
                left: x,
                top: y,
                width,
                height,
                transform: "translate(-50%, -50%)",
              }}
              onClick={() => onPositionClick(zone.position)}
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
