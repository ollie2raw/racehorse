import {
  BoardState,
  Config,
  Tile,
  PlacedTile,
  TileOrientation,
  DEFAULT_CONFIG,
  PlacementPosition,
  BranchArm,
  isDouble,
  parseBranchPosition,
  tileMatchesEnd,
} from './types';

function hubIdAt(hub: BoardState['hubDoubles'][number], fallbackIdx: number): number {
  return hub.hubId ?? fallbackIdx;
}

function nextHubId(board: BoardState): number {
  if (board.hubDoubles.length === 0) return 0;
  return Math.max(...board.hubDoubles.map((h, idx) => hubIdAt(h, idx))) + 1;
}

function recomputeBranchLaneHubStates(
  hubDoubles: BoardState['hubDoubles'],
  laneRef: string,
  branchTiles: readonly PlacedTile[]
): BoardState['hubDoubles'] {
  return hubDoubles.map(h => {
    if (h.laneType !== 'branch' || h.laneRef !== laneRef || typeof h.branchDepth !== 'number') {
      return h;
    }
    const depth = h.branchDepth;
    const leftSideFilled = depth === 0 ? true : depth > 0 && Boolean(branchTiles[depth - 1]);
    const rightSideFilled = Boolean(branchTiles[depth + 1]);
    return {
      ...h,
      leftSideFilled,
      rightSideFilled,
      isCrossed: leftSideFilled && rightSideFilled,
    };
  });
}

// ─── Orientation Helpers ─────────────────────────────────────

/**
 * Determine the orientation of a tile being placed.
 * - Doubles are always vertical (perpendicular to the line)
 * - Non-doubles are horizontal, with the matching end facing the board
 */
function getPlacementOrientation(
  tile: Tile,
  matchValue: number,
  placementSide: 'left' | 'right' | 'branch'
): TileOrientation {
  // Doubles are always vertical
  if (isDouble(tile)) {
    return 'vertical-normal';
  }

  // For non-doubles, determine which end faces the board
  if (placementSide === 'left') {
    // Placing on left: high end should face right (toward board)
    return tile.high === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  } else if (placementSide === 'right') {
    // Placing on right: low end should face left (toward board)
    return tile.low === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  } else {
    // Branch: depends on which end matches the hub
    return tile.high === matchValue ? 'vertical-flipped' : 'vertical-normal';
  }
}

/**
 * Given a tile being placed and the value it must match,
 * return the pip value that will be exposed (the "other" end).
 */
function exposedPip(tile: Tile, matchValue: number): number {
  if (tile.high === matchValue) return tile.low;
  if (tile.low === matchValue) return tile.high;
  // Fallback (shouldn't happen if tile matches)
  return tile.high;
}

// ─── Open Ends Sum ───────────────────────────────────────────

/**
 * Compute the sum of all open ends on the board.
 *
 * IMPORTANT: Doubles at open ends count as 2*value (both pips are exposed).
 *
 * Open ends include:
 * - The main line left end
 * - The main line right end
 * - Each branch arm's open end
 *
 * Special case: If the board has only 1 tile (a double),
 * that tile counts as both ends (2 * value).
 */
export function computeOpenEndsSum(board: BoardState): number {
  // Single tile case
  if (board.mainLine.length === 1) {
    const t = board.mainLine[0].tile;
    // A single double counts as 2*value (both ends open)
    // A single non-double counts as high + low
    return t.high + t.low;
  }

  // Main line ends - doubles count twice
  let sum = 0;

  if (board.leftEndIsDouble) {
    sum += board.leftEnd * 2;
  } else {
    sum += board.leftEnd;
  }

  if (board.rightEndIsDouble) {
    sum += board.rightEnd * 2;
  } else {
    sum += board.rightEnd;
  }

  // Branch ends - doubles count twice
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (!branch) continue;
      if (branch.openEndIsDouble) {
        sum += branch.openEnd * 2;
      } else {
        sum += branch.openEnd;
      }
    }
  }

  return sum;
}

// ─── Scoring ─────────────────────────────────────────────────

/**
 * POINTS scoring:
 * if sum divisible by scoringMultiple (5), points = sum / 5, else 0
 */
export function computePlayScore(
  board: BoardState,
  config: Config = DEFAULT_CONFIG
): number {
  const sum = computeOpenEndsSum(board);
  return sum % config.scoringMultiple === 0 ? sum / config.scoringMultiple : 0;
}

/**
 * Hand penalty for end-of-hand bonus calculation.
 * Sum of pips rounded UP to nearest scoringMultiple.
 */
export function computeHandPenalty(
  hand: readonly Tile[],
  config: Config = DEFAULT_CONFIG
): number {
  const total = hand.reduce((sum, t) => sum + t.high + t.low, 0);
  const multiple = config.scoringMultiple;
  return Math.ceil(total / multiple) * multiple;
}

/**
 * Go-out bonus points:
 * sum opponent pips, divide by scoringMultiple, round to nearest integer points.
 */
export function computeGoOutBonusPoints(
  hand: readonly Tile[],
  config: Config = DEFAULT_CONFIG
): number {
  const total = hand.reduce((sum, t) => sum + t.high + t.low, 0);
  return Math.round(total / config.scoringMultiple);
}

// ─── Board Placement ─────────────────────────────────────────

/**
 * Simulate placing a tile at a position and return the new board state.
 *
 * Placement rules:
 * - 'left': prepend to main line, update leftEnd
 * - 'right': append to main line, update rightEnd
 * - 'branch-H-A': extend branch arm A on hub H (or create it)
 *
 * Crossing a double:
 * When a tile is played through a double (extending the main line past it),
 * that double becomes "crossed" and can spawn branches.
 */
export function simulatePlacement(
  board: BoardState | null,
  tile: Tile,
  position: PlacementPosition
): BoardState {
  // ─── First tile on empty board ───
  if (board === null) {
    const placedTile: PlacedTile = {
      tile,
      orientation: isDouble(tile) ? 'vertical-normal' : 'horizontal-normal',
    };

    const newBoard: BoardState = {
      mainLine: [placedTile],
      leftEnd: tile.low,
      rightEnd: tile.high,
      leftEndIsDouble: isDouble(tile),
      rightEndIsDouble: isDouble(tile),
      hubDoubles: [],
    };

    // If the first tile is a double, register it as a potential hub
    if (isDouble(tile)) {
      const hubId = nextHubId(newBoard);
      return {
        ...newBoard,
        hubDoubles: [{
          hubId,
          laneType: 'mainline',
          laneRef: 'mainline',
          tileIndex: 0,
          mainlineIndex: 0,
          hubValue: tile.high,
          isCrossed: false,
          leftSideFilled: false,
          rightSideFilled: false,
          branches: [],
        }],
      };
    }

    return newBoard;
  }

  // ─── Branch placement ───
  const branchPos = parseBranchPosition(position);
  if (branchPos !== null) {
    return placeTileOnBranch(board, tile, branchPos.hubIndex, branchPos.armIndex);
  }

  // ─── Main line placement ───
  return placeTileOnMainLine(board, tile, position as 'left' | 'right');
}

/**
 * Place a tile on the main line (left or right end).
 */
function placeTileOnMainLine(
  board: BoardState,
  tile: Tile,
  end: 'left' | 'right'
): BoardState {
  const matchValue = end === 'left' ? board.leftEnd : board.rightEnd;
  const newExposedEnd = exposedPip(tile, matchValue);
  const tileIsDouble = isDouble(tile);

  // Create placed tile with orientation
  const placedTile: PlacedTile = {
    tile,
    orientation: getPlacementOrientation(tile, matchValue, end),
  };

  // Update main line
  const newMainLine = end === 'left'
    ? [placedTile, ...board.mainLine]
    : [...board.mainLine, placedTile];

  const newLeftEnd = end === 'left' ? newExposedEnd : board.leftEnd;
  const newRightEnd = end === 'right' ? newExposedEnd : board.rightEnd;
  const newLeftEndIsDouble = end === 'left' ? tileIsDouble : board.leftEndIsDouble;
  const newRightEndIsDouble = end === 'right' ? tileIsDouble : board.rightEndIsDouble;

  // Update side-fill state for endpoint hubs before index shifts.
  let newHubDoubles = [...board.hubDoubles];
  const endpointIndex = end === 'left' ? 0 : board.mainLine.length - 1;
  newHubDoubles = newHubDoubles.map((hub, idx) => {
    const hubIndex = hub.mainlineIndex ?? hub.tileIndex;
    if (hubIndex !== endpointIndex) return hub;
    const leftSideFilled = hub.leftSideFilled ?? false;
    const rightSideFilled = hub.rightSideFilled ?? false;
    const updatedLeft = end === 'left' ? true : leftSideFilled;
    const updatedRight = end === 'right' ? true : rightSideFilled;
    return {
      ...hub,
      leftSideFilled: updatedLeft,
      rightSideFilled: updatedRight,
      isCrossed: updatedLeft && updatedRight,
    };
  });

  // Adjust hub indices if we prepended to the left
  if (end === 'left') {
    newHubDoubles = newHubDoubles.map(h => {
      const nextIndex = (h.mainlineIndex ?? h.tileIndex) + 1;
      return {
        ...h,
        tileIndex: nextIndex,
        mainlineIndex: nextIndex,
      };
    });
  } else {
    newHubDoubles = newHubDoubles.map(h => ({
      ...h,
      mainlineIndex: h.mainlineIndex ?? h.tileIndex,
    }));
  }

  // If the new tile is a double, register it as a pending hub (uncrossed)
  if (tileIsDouble) {
    const newHubIndex = end === 'left' ? 0 : newMainLine.length - 1;
    const hubId = nextHubId({ ...board, hubDoubles: newHubDoubles });
    const leftSideFilled = end === 'right';
    const rightSideFilled = end === 'left';
    newHubDoubles.push({
      hubId,
      laneType: 'mainline',
      laneRef: 'mainline',
      tileIndex: newHubIndex,
      mainlineIndex: newHubIndex,
      hubValue: tile.high,
      isCrossed: leftSideFilled && rightSideFilled,
      leftSideFilled,
      rightSideFilled,
      branches: [],
    });
  }

  return {
    mainLine: newMainLine,
    leftEnd: newLeftEnd,
    rightEnd: newRightEnd,
    leftEndIsDouble: newLeftEndIsDouble,
    rightEndIsDouble: newRightEndIsDouble,
    hubDoubles: newHubDoubles,
  };
}

/**
 * Place a tile on a branch arm of a hub double.
 */
function placeTileOnBranch(
  board: BoardState,
  tile: Tile,
  hubRef: number,
  armIndex: number
): BoardState {
  const hubIndex = board.hubDoubles.findIndex((h, idx) => hubIdAt(h, idx) === hubRef);
  const hub = hubIndex >= 0 ? board.hubDoubles[hubIndex] : null;
  if (!hub) {
    throw new Error(`Invalid hub id: ${hubRef}`);
  }

  if (!hub.isCrossed) {
    throw new Error(`Cannot branch from hub ${hubRef} - it is not crossed yet`);
  }

  if (armIndex >= 2) {
    throw new Error(`Invalid arm index: ${armIndex}. Max 2 branches per hub.`);
  }

  const tileIsDouble = isDouble(tile);
  const laneRef = `branch-${hubRef}-${armIndex}`;
  let newBranches: BranchArm[];
  let newHubDoubles = [...board.hubDoubles];

  if (hub.branches[armIndex]) {
    // Extend existing branch
    const existingBranch = hub.branches[armIndex];
    const branchMatchValue = existingBranch.openEnd;
    const branchNewEnd = exposedPip(tile, branchMatchValue);
    const depthBeforeAppend = existingBranch.tiles.length;

    const placedTile: PlacedTile = {
      tile,
      orientation: getPlacementOrientation(tile, branchMatchValue, 'branch'),
    };

    newBranches = hub.branches.map((b, i) =>
      i === armIndex
        ? {
            tiles: [...b.tiles, placedTile],
            openEnd: branchNewEnd,
            openEndIsDouble: tileIsDouble,
          }
        : b
    );

    // A new double at the branch tip becomes a new branch-lane hub.
    if (tileIsDouble) {
      const newHubId = nextHubId({ ...board, hubDoubles: newHubDoubles });
      newHubDoubles.push({
        hubId: newHubId,
        laneType: 'branch',
        laneRef,
        branchDepth: depthBeforeAppend,
        tileIndex: -1,
        mainlineIndex: undefined,
        hubValue: tile.high,
        leftSideFilled: true,
        rightSideFilled: false,
        isCrossed: false,
        branches: [],
      });
    }

    newHubDoubles = [...recomputeBranchLaneHubStates(newHubDoubles, laneRef, newBranches[armIndex]?.tiles ?? [])];
  } else if (armIndex === 0 || armIndex === 1) {
    // Create requested arm directly (0 or 1) while preserving existing sibling arm if any.
    const matchValue = hub.hubValue;
    const newExposedEnd = exposedPip(tile, matchValue);

    const placedTile: PlacedTile = {
      tile,
      orientation: getPlacementOrientation(tile, matchValue, 'branch'),
    };

    newBranches = [...hub.branches];
    newBranches[armIndex] = {
      tiles: [placedTile],
      openEnd: newExposedEnd,
      openEndIsDouble: tileIsDouble,
    };

    if (tileIsDouble) {
      const newHubId = nextHubId({ ...board, hubDoubles: newHubDoubles });
      newHubDoubles.push({
        hubId: newHubId,
        laneType: 'branch',
        laneRef,
        branchDepth: 0,
        tileIndex: -1,
        mainlineIndex: undefined,
        hubValue: tile.high,
        leftSideFilled: true,
        rightSideFilled: false,
        isCrossed: false,
        branches: [],
      });
    }

    newHubDoubles = [...recomputeBranchLaneHubStates(newHubDoubles, laneRef, newBranches[armIndex]?.tiles ?? [])];
  } else {
    throw new Error(`Cannot create branch ${armIndex}`);
  }

  newHubDoubles = newHubDoubles.map((h, i) =>
    i === hubIndex ? { ...h, branches: newBranches } : h
  );

  return {
    ...board,
    hubDoubles: newHubDoubles,
  };
}

/**
 * Get all open ends where a tile could potentially be placed.
 */
export interface OpenEnd {
  position: PlacementPosition;
  matchValue: number;
}

/**
 * Get all open ends where a tile could potentially be placed.
 */
export function getOpenEnds(board: BoardState | null): OpenEnd[] {
  if (board === null) {
    return [{ position: 'left', matchValue: -1 }];
  }

  const ends: OpenEnd[] = [
    { position: 'left', matchValue: board.leftEnd },
    { position: 'right', matchValue: board.rightEnd },
  ];

  // Add branch ends
  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    const hubId = hubIdAt(hub, hubIdx);

    if (hub.isCrossed) {
      // Expose both branch arms on crossed hubs.
      for (let armIdx = 0; armIdx < 2; armIdx++) {
        const branch = hub.branches[armIdx];
        ends.push({
          position: `branch-${hubId}-${armIdx}`,
          matchValue: branch ? branch.openEnd : hub.hubValue,
        });
      }
    }
  }

  return ends;
}

/**
 * Check if a tile can be placed at a given position.
 */
export function canPlaceTileAt(
  board: BoardState | null,
  tile: Tile,
  position: PlacementPosition
): boolean {
  const ends = getOpenEnds(board);
  const end = ends.find(e => e.position === position);

  if (!end) return false;
  if (end.matchValue === -1) return true;

  return tileMatchesEnd(tile, end.matchValue);
}
