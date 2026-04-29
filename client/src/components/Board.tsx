// client/src/components/Board.tsx
import { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { DominoTile } from './DominoTile';
import type { Tile, BoardState, PlacementPosition, Move } from '../types';
import { isDouble } from '../bot/botEngine';
import { useRenderProfiler } from '../debug/renderProfiler';

type DailyFritzMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

function traceDailyFritzBoardEvent(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  const timestamp =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Number(performance.now().toFixed(2))
      : Date.now();
  const entry = { tag, timestamp, ...payload };
  const win = window as typeof window & {
    __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
  };
  const bucket = (win.__dailyFritzInteractionTrace ??= []);
  bucket.push(entry);
  if (bucket.length > 400) {
    bucket.splice(0, bucket.length - 400);
  }
  console.log(tag, entry);
}

function traceCameraDebug(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem('BOARD_CAMERA_DEBUG') !== '1') return;
  } catch {
    return;
  }
  const timestamp =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Number(performance.now().toFixed(2))
      : Date.now();
  console.log(tag, { ...payload, timestamp });
}

function recordDailyFritzBoardMetric(
  name: 'boardRenderCount' | 'computeLayout',
  value: number,
): void {
  if (typeof window === 'undefined') return;
  const win = window as typeof window & {
    __dailyFritzProfileActive?: boolean;
    __dailyFritzProfile?: {
      boardRenderCount?: number;
      metrics?: Record<string, DailyFritzMetric>;
    };
  };
  if (!win.__dailyFritzProfileActive) return;
  const profile = (win.__dailyFritzProfile ??= {});
  if (name === 'boardRenderCount') {
    profile.boardRenderCount = (profile.boardRenderCount ?? 0) + value;
    return;
  }
  const metrics = (profile.metrics ??= {});
  const current = metrics[name] ?? { count: 0, totalMs: 0, maxMs: 0 };
  current.count += 1;
  current.totalMs += value;
  current.maxMs = Math.max(current.maxMs, value);
  metrics[name] = current;
}

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

function tileEquals(a: Tile | null | undefined, b: Tile | null | undefined): boolean {
  if (!a || !b) return false;
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
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
      key: `main-${i}-${pt.tile.high}-${pt.tile.low}`,
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
          key: `branch-${hubId}-${armIdx}-${i}-${branch.tiles[i].tile.high}-${branch.tiles[i].tile.low}`,
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

function BoardComponent({
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
}: BoardProps) {
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
  const [hoveredZoom, setHoveredZoom] = useState<'in' | 'out' | null>(null);
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

  const isResettingBoard = handOver || !board || board.mainLine.length === 0;

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
  const cameraFitPositions = useMemo(
    () => (selectedTile != null || showOpenEndGlow ? openEndPositions : []),
    [openEndPositions, selectedTile, showOpenEndGlow],
  );

  const logLayoutDebug = useCallback(
    (validPositionsCount: number, selectedTileKey: string | null, layout: BoardLayout) => {
      if (typeof window === 'undefined') return;
      const timestamp =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? Number(performance.now().toFixed(2))
          : Date.now();
      const entry = {
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
      };
      const win = window as typeof window & {
        __dailyFritzLayoutDebug?: Array<Record<string, unknown>>;
      };
      const bucket = (win.__dailyFritzLayoutDebug ??= []);
      bucket.push(entry);
      if (bucket.length > 300) {
        bucket.splice(0, bucket.length - 300);
      }
      console.log('[layout-debug]', entry);
    },
    [boardTileCount, camera.scale, gameOver, handNumber, handOver, openEndPositions],
  );

  // Get valid positions for the selected tile
  const validPositions = useMemo((): PlacementPosition[] => {
    if (!selectedTile) return [];
    return legalMoves
      .filter((m) => m.type === 'play' && m.tile && tileEquals(m.tile, selectedTile))
      .map((m) => m.position!)
      .filter(Boolean);
  }, [selectedTile, legalMoves]);

  // Keep the camera/layout stable when the player selects a tile.
  const layout = useMemo(() => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    traceCameraDebug('[camera-debug] computeLayout input', {
      boardTileCount,
      openEndPositions: cameraFitPositions,
      validPositions,
      selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
    });
    const nextLayout = computeLayout(isResettingBoard ? null : board, cameraFitPositions);
    traceCameraDebug('[camera-debug] computeLayout output', {
      minX: Number(nextLayout.minX.toFixed(2)),
      maxX: Number(nextLayout.maxX.toFixed(2)),
      minY: Number(nextLayout.minY.toFixed(2)),
      maxY: Number(nextLayout.maxY.toFixed(2)),
      scale: Number(camera.scale.toFixed(3)),
    });
    if (profileDailyFritz) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordDailyFritzBoardMetric('computeLayout', end - start);
      logLayoutDebug(validPositions.length, selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null, nextLayout);
    }
    return nextLayout;
  }, [board, cameraFitPositions, profileDailyFritz, logLayoutDebug, selectedTile, validPositions.length, isResettingBoard]);
  const placementZones = useMemo(() => {
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const zones = computeLayout(board, validPositions).zones;
    if (profileDailyFritz) {
      const end = typeof performance !== 'undefined' ? performance.now() : Date.now();
      recordDailyFritzBoardMetric('computeLayout', end - start);
      traceDailyFritzBoardEvent('[render] placementZones', {
        count: zones.length,
        selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      });
    }
    return zones;
  }, [board, validPositions, profileDailyFritz, selectedTile]);

  useEffect(() => {
    if (!profileDailyFritz) return;
    traceDailyFritzBoardEvent('[render] Board props', {
      selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      legalMovesCount: legalMoves.length,
    });
  }, [profileDailyFritz, selectedTile, legalMoves.length]);

  const glowLayout = useMemo(() => {
    if (!showOpenEndGlow) return null;
    return computeLayout(isResettingBoard ? null : board, openEndPositions);
  }, [showOpenEndGlow, board, openEndPositions, isResettingBoard]);

  const resetSignature = useMemo(
    () => `${handNumber}:${handOver}:${gameOver}:${isResettingBoard}`,
    [gameOver, handNumber, handOver, isResettingBoard],
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
    setCamera({ x: 0, y: 0, scale: 1 });
  }, [resetSignature]);

  // Convert layout units to pixels
  const unitToPixels = tileSize;
  // Calculate board center offset
  const centerX = (layout.minX + layout.maxX) / 2;
  const centerY = (layout.minY + layout.maxY) / 2;
  const markManualCamera = useCallback(() => {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    manualCameraRef.current = true;
    manualCameraUntilRef.current = now + 1500;
  }, []);

  function fitCameraToContainer(reason: string, width?: number, height?: number, force = false) {
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
          fitCameraToContainer('retry');
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
    const fitScale = Math.min(1.45, Math.max(0.22, Math.min(scaleX, scaleY)));

    traceCameraDebug('[camera-debug] setCamera', {
      reason,
      x: 0,
      y: 0,
      scale: Number(fitScale.toFixed(3)),
    });
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
      fitCameraToContainer('resize-observer');
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
    markManualCamera();
    setCamera((cam) => ({
      ...cam,
      scale: (() => {
        const nextScale = Math.min(1.8, Math.max(0.22, cam.scale * delta));
        traceCameraDebug('[camera-debug] setCamera', {
          reason: 'wheel',
          x: Number(cam.x.toFixed(2)),
          y: Number(cam.y.toFixed(2)),
          scale: Number(nextScale.toFixed(3)),
        });
        return nextScale;
      })(),
    }));
  }, [markManualCamera]);

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
  }, [layout, unitToPixels]);

  const applyZoomStep = useCallback((delta: number) => {
    markManualCamera();
    setCamera((cam) => ({
      ...cam,
      scale: (() => {
        const nextScale = Math.min(1.8, Math.max(0.22, cam.scale + delta));
        traceCameraDebug('[camera-debug] setCamera', {
          reason: 'manual-zoom',
          x: Number(cam.x.toFixed(2)),
          y: Number(cam.y.toFixed(2)),
          scale: Number(nextScale.toFixed(3)),
        });
        return nextScale;
      })(),
    }));
  }, [markManualCamera]);

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
        {layout.tiles.map((lt) => {
          if (!lt.tile) return null;
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
        {placementZones.map((zone) => {
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
              className={`placement-zone active${showTargetDebug ? ' debug' : ''}${highlightedPosition === zone.position ? ' highlighted' : ''}`}
              style={{
                position: 'absolute',
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                width,
                height,
                transform: 'translate(-50%, -50%)',
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                const target = e.target instanceof HTMLElement ? e.target : null;
                const currentTarget = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
                console.log('[board-zone-click]', {
                  position: zone.position,
                  selectedTile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
                  hasOnPositionClick: typeof onPositionClick === 'function',
                  pointerTargetInfo: {
                    targetTag: target?.tagName ?? null,
                    targetClass: target?.className ?? null,
                    currentTargetTag: currentTarget?.tagName ?? null,
                    currentTargetClass: currentTarget?.className ?? null,
                    targetPointerEvents:
                      target && typeof window !== 'undefined' ? window.getComputedStyle(target).pointerEvents : null,
                    currentTargetPointerEvents:
                      currentTarget && typeof window !== 'undefined'
                        ? window.getComputedStyle(currentTarget).pointerEvents
                        : null,
                  },
                });
                if (profileDailyFritz) {
                  traceDailyFritzBoardEvent('[input] placement click', {
                    position: zone.position,
                  });
                }
                if (typeof onPositionClick !== 'function') {
                  console.log('[board-zone-blocked] reason = missing-onPositionClick');
                  return;
                }
                console.log('[board-zone-forward]', { position: zone.position });
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
          bottom: 12,
          left: 12,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 999,
          padding: '6px 10px',
          border: '1.5px solid rgba(236,252,245,0.28)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
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
            traceCameraDebug('[camera-debug] manual zoom click', {
              direction: 'out',
              beforeScale: Number(camera.scale.toFixed(3)),
              afterScale: Number(Math.min(1.8, Math.max(0.22, camera.scale - 0.12)).toFixed(3)),
            });
            applyZoomStep(-0.12);
          }}
          style={{
            padding: '6px 10px',
            color: 'rgba(232,245,240,0.95)',
            fontSize: '1.2rem',
            fontWeight: 800,
            lineHeight: 1,
            background: hoveredZoom === 'out' ? 'rgba(255,255,255,0.1)' : 'none',
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
            width: 1.5,
            height: 20,
            margin: '0 6px',
            background: 'rgba(236,252,245,0.28)',
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
            traceCameraDebug('[camera-debug] manual zoom click', {
              direction: 'in',
              beforeScale: Number(camera.scale.toFixed(3)),
              afterScale: Number(Math.min(1.8, Math.max(0.22, camera.scale + 0.12)).toFixed(3)),
            });
            applyZoomStep(0.12);
          }}
          style={{
            padding: '6px 10px',
            color: 'rgba(232,245,240,0.95)',
            fontSize: '1.2rem',
            fontWeight: 800,
            lineHeight: 1,
            background: hoveredZoom === 'in' ? 'rgba(255,255,255,0.1)' : 'none',
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

function areBoardPropsEqual(prev: BoardProps, next: BoardProps): boolean {
  return (
    prev.board === next.board &&
    prev.legalMoves === next.legalMoves &&
    tileEquals(prev.selectedTile, next.selectedTile) &&
    tileEquals(prev.lastPlayedTile, next.lastPlayedTile) &&
    prev.highlightedPosition === next.highlightedPosition &&
    highlightedEndsEqual(prev.highlightedEnds, next.highlightedEnds) &&
    prev.onPositionClick === next.onPositionClick &&
    prev.tileSize === next.tileSize &&
    prev.showOpenEndGlow === next.showOpenEndGlow &&
    prev.profileDailyFritz === next.profileDailyFritz
  );
}

export const Board = memo(BoardComponent, areBoardPropsEqual);

export default Board;
