// client/src/components/board/boardLayout.ts
//
// Pure board-layout geometry, extracted from Board.tsx (D2 Tier-0). No React —
// walks a BoardState into positioned tiles + open-end zones, and fits a camera
// scale to a viewport. Exercised directly by Board.reviewContainment.test.tsx.

import type { Tile, BoardState, PlacementPosition, PlacedTile } from '../../types';
import { isDouble } from '../../game/openEndsGeometry';
import { isRenderableNonNullBoard } from '../../multiplayer/boardSnapshotGuards';

// ─── Layout Constants ────────────────────────────────────────

// Tile dimensions in layout units (1 unit = 1 pip half)
const TILE_UNIT = 1;
const TILE_GAP = 0.15;
const DOUBLE_CROSS_GAP = 0.2;

// ─── Types ───────────────────────────────────────────────────

export interface BoardLayoutTile {
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

export interface BoardLayout {
  tiles: BoardLayoutTile[];
  zones: LayoutZone[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ─── Helpers ─────────────────────────────────────────────────

interface HubLookup {
  byMainIndex: Map<number, BoardState['hubDoubles'][number]>;
  byLaneDepth: Map<string, number>;
  byId: Map<number, BoardState['hubDoubles'][number]>;
}

// ─── Layout Engine ───────────────────────────────────────────

export function computeBoardLayout(
  board: BoardState | null,
  validPositions: PlacementPosition[] = [],
): BoardLayout {
  const tiles: BoardLayoutTile[] = [];
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
      // Frame like a one-tile main line so auto-fit zoom matches end placement zones.
      const virtualLineWidth = TILE_UNIT * 2;
      const halfLine = virtualLineWidth / 2;
      const layoutPadX = 3;
      const layoutPadY = 2.5;
      return {
        tiles,
        zones,
        minX: -halfLine - layoutPadX,
        maxX: halfLine + layoutPadX,
        minY: -TILE_UNIT - layoutPadY,
        maxY: TILE_UNIT + layoutPadY,
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

  if (!isRenderableNonNullBoard(board)) {
    return computeBoardLayout(null, validPositions);
  }

  const { mainLine, hubDoubles } = board;

  for (const pt of mainLine) {
    if (!pt?.tile || typeof pt.orientation !== 'string') {
      return computeBoardLayout(null, validPositions);
    }
  }

  // Build hub lookup
  const hubLookup: HubLookup = {
    byMainIndex: new Map<number, BoardState['hubDoubles'][number]>(),
    byLaneDepth: new Map<string, number>(),
    byId: new Map<number, BoardState['hubDoubles'][number]>(),
  };
  for (let idx = 0; idx < hubDoubles.length; idx++) {
    const hub = hubDoubles[idx];
    if (!hub) continue;
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
      return {
        tiles: [] as BoardLayoutTile[],
        zones: [] as LayoutZone[],
        minX: hubX,
        maxX: hubX,
        minY: hubY,
        maxY: hubY,
      };
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
  let minX = currentX - 3;
  let maxX = -currentX + 3;
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
      key: `main-${i}-${pt.tile.high}-${pt.tile.low}`,
    });

    // Layout branches from this hub
    if (hub && hub.isCrossed && typeof hub.hubId === 'number') {
      // Mainline is horizontal.
      const branchResult = layoutHubBranches(hub, hub.hubId, centerX, mainY, true);
      const bt = branchResult.tiles ?? [];
      const bz = branchResult.zones ?? [];
      tiles.push(...bt);
      zones.push(...bz);
      minX = Math.min(minX, branchResult.minX);
      maxX = Math.max(maxX, branchResult.maxX);
      minY = Math.min(minY, branchResult.minY ?? minY);
      maxY = Math.max(maxY, branchResult.maxY ?? maxY);
    }

    currentX += tileWidth + TILE_GAP;
  }

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

export function calculateBoardFitScale(input: {
  layout: Pick<BoardLayout, 'minX' | 'maxX' | 'minY' | 'maxY'>;
  tileSize: number;
  viewportWidth: number;
  viewportHeight: number;
  targetFill: number;
  minScale: number;
  maxScale: number;
  multiplier?: number;
}): number {
  const layoutWidth = (input.layout.maxX - input.layout.minX) * input.tileSize;
  const layoutHeight = (input.layout.maxY - input.layout.minY) * input.tileSize;
  if (layoutWidth <= 0 || layoutHeight <= 0) return 1;

  const scaleX = (input.viewportWidth * input.targetFill) / layoutWidth;
  const scaleY = (input.viewportHeight * input.targetFill) / layoutHeight;
  const rawFit = Math.min(scaleX, scaleY) * (input.multiplier ?? 1);
  return Math.min(input.maxScale, Math.max(input.minScale, rawFit));
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
  ) => {
    tiles: BoardLayoutTile[];
    zones: LayoutZone[];
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  },
  laneHorizontal: boolean,
): {
  tiles: BoardLayoutTile[];
  zones: LayoutZone[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const tiles: BoardLayoutTile[] = [];
  const zones: LayoutZone[] = [];
  let minY = hubY - TILE_UNIT / 2;
  let maxY = hubY + TILE_UNIT / 2;
  let minX = hubX - TILE_UNIT / 2;
  let maxX = hubX + TILE_UNIT / 2;

  if (!hub || typeof hub !== 'object') {
    return { tiles, zones, minX, maxX, minY, maxY };
  }

  // Branch arms are always perpendicular to the lane this hub is on.
  const verticalArms = laneHorizontal;

  // arm 0: up (horizontal lane) / left (vertical lane)
  // arm 1: down (horizontal lane) / right (vertical lane)
  const directions = [-1, 1];

  for (let armIdx = 0; armIdx < 2; armIdx++) {
    const direction = directions[armIdx];
    const branchesArray = Array.isArray(hub.branches) ? hub.branches : [];
    const branchArm = branchesArray[armIdx];
    let branchTiles: PlacedTile[] = [];
    const rawTiles =
      branchArm && typeof branchArm === 'object' ? (branchArm as { tiles?: unknown }).tiles : undefined;
    if (Array.isArray(rawTiles)) {
      branchTiles = rawTiles as PlacedTile[];
    }

    // Start position for branch
    let currentX = hubX + (verticalArms ? 0 : direction * (TILE_UNIT + DOUBLE_CROSS_GAP));
    let currentY = hubY + (verticalArms ? direction * (TILE_UNIT + DOUBLE_CROSS_GAP) : 0);

    if (branchTiles.length > 0) {
      // Layout branch tiles
      for (let i = 0; i < branchTiles.length; i++) {
        const pt = branchTiles[i];
        if (!pt?.tile || typeof pt.orientation !== 'string') continue;

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
          key: `branch-${hubId}-${armIdx}-${i}-${pt.tile.high}-${pt.tile.low}`,
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
              const nt = nested.tiles ?? [];
              const nz = nested.zones ?? [];
              tiles.push(...nt);
              zones.push(...nz);
              minX =
                nt.length > 0
                  ? Math.min(minX, ...nt.map((t) => t.x))
                  : minX;
              maxX =
                nt.length > 0
                  ? Math.max(maxX, ...nt.map((t) => t.x))
                  : maxX;
              minX = Math.min(minX, nested.minX);
              maxX = Math.max(maxX, nested.maxX);
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
      }
    }
  }

  return { tiles, zones, minX, maxX, minY, maxY };
}

