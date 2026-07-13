import type { BoardState, BranchArm, HubDouble, PlacedTile, PlacementPosition } from './types';
import { isDouble } from './types';

const IS_DEV = false;

export interface OpenEndsAuditIssue {
  code:
    | 'empty_branch_object'
    | 'empty_branch_open_end'
    | 'is_crossed_metadata_mismatch'
    | 'mainline_end_metadata_mismatch'
    | 'branch_tip_metadata_mismatch';
  message: string;
  hubId?: number;
  armIndex?: number;
}

export interface OpenEndsContribution {
  source: 'mainline-left' | 'mainline-right' | 'open-double' | 'single-open-end';
  position: PlacementPosition;
  tile?: string;
  pip?: number;
  value: number;
  reason: string;
}

export function hubIdAt(hub: HubDouble, fallbackIdx: number): number {
  return hub.hubId ?? fallbackIdx;
}

export function endpointPipFromOrientation(placed: PlacedTile, side: 'left' | 'right'): number {
  const tile = placed.tile;
  if (isDouble(tile)) return tile.high;
  if (side === 'left') {
    return placed.orientation === 'horizontal-normal' ? tile.low : tile.high;
  }
  return placed.orientation === 'horizontal-normal' ? tile.high : tile.low;
}

/** Exposed pip at the tip of a populated branch arm (geometry only). */
export function branchTipPipFromGeometry(hubValue: number, branch: BranchArm): number {
  if (branch.tiles.length === 0) return hubValue;
  const lastPlaced = branch.tiles[branch.tiles.length - 1];
  const tile = lastPlaced.tile;
  if (isDouble(tile)) return tile.high;

  const penult =
    branch.tiles.length > 1
      ? branch.tiles[branch.tiles.length - 2].tile
      : { low: hubValue, high: hubValue };

  const lowMatches = tile.low === penult.low || tile.low === penult.high;
  return lowMatches ? tile.high : tile.low;
}

export function isMainlineHubCrossedGeometrically(
  hub: HubDouble,
  mainLineLength: number,
): boolean {
  const idx = hub.mainlineIndex ?? hub.tileIndex;
  return idx > 0 && idx < mainLineLength - 1;
}

export function isBranchHubCrossedGeometrically(
  hub: HubDouble,
  branchTiles: readonly PlacedTile[],
): boolean {
  const depth = hub.branchDepth ?? 0;
  const leftSideFilled = depth === 0 ? true : depth > 0 && Boolean(branchTiles[depth - 1]);
  const rightSideFilled = Boolean(branchTiles[depth + 1]);
  return leftSideFilled && rightSideFilled;
}

function parseBranchLaneRef(laneRef: string): { hubId: number; armIndex: number } | null {
  const m = /^branch-(\d+)-(\d+)$/.exec(laneRef);
  if (!m) return null;
  return { hubId: Number(m[1]), armIndex: Number(m[2]) };
}

export function findHubById(board: BoardState, hubId: number): HubDouble | null {
  const idx = board.hubDoubles.findIndex((h, i) => hubIdAt(h, i) === hubId);
  return idx >= 0 ? board.hubDoubles[idx] : null;
}

export function isHubCrossedGeometrically(hub: HubDouble, board: BoardState): boolean {
  if (hub.laneType === 'branch') {
    if (!hub.laneRef) return false;
    const parsed = parseBranchLaneRef(hub.laneRef);
    if (!parsed) return false;
    const parent = findHubById(board, parsed.hubId);
    if (!parent) return false;
    const branch = parent.branches[parsed.armIndex];
    if (!branch?.tiles.length) return false;
    return isBranchHubCrossedGeometrically(hub, branch.tiles);
  }
  return isMainlineHubCrossedGeometrically(hub, board.mainLine.length);
}

export function branchHasPlayableTiles(branch: BranchArm | null | undefined): branch is BranchArm {
  return Boolean(branch && branch.tiles.length > 0);
}

function pipContribution(pip: number, tipIsDouble: boolean): number {
  return tipIsDouble ? pip * 2 : pip;
}

function formatTile(tile: { low: number; high: number }): string {
  return `[${tile.low}|${tile.high}]`;
}

function mainlineEndContribution(board: BoardState, side: 'left' | 'right'): number {
  const mainLine = board.mainLine;
  const placed = side === 'left' ? mainLine[0] : mainLine[mainLine.length - 1];
  const pip = endpointPipFromOrientation(placed, side);
  return pipContribution(pip, isDouble(placed.tile));
}

function describeContribution(args: {
  position: PlacementPosition;
  tile?: { low: number; high: number };
  pip: number;
  isDoubleOpenEnd: boolean;
  side: 'mainline-left' | 'mainline-right' | 'branch';
}): OpenEndsContribution {
  const { position, tile, pip, isDoubleOpenEnd, side } = args;
  if (isDoubleOpenEnd) {
    return {
      source: 'open-double',
      position,
      tile: tile ? formatTile(tile) : undefined,
      pip,
      value: pip * 2,
      reason: 'open double contributes full tile value',
    };
  }
  return {
    source: side === 'mainline-left' || side === 'mainline-right' ? side : 'single-open-end',
    position,
    pip,
    value: pip,
    reason: 'single open end',
  };
}

interface LaneScoringUnit {
  position: PlacementPosition;
  tile: BoardState['mainLine'][number]['tile'];
  pip: number;
  doubled: boolean;
}

function getBranchLaneHubs(
  board: BoardState,
  laneRef: string,
): Array<{ hub: HubDouble; hubId: number }> {
  return board.hubDoubles
    .map((hub, idx) => ({ hub, hubId: hubIdAt(hub, idx) }))
    .filter(
      ({ hub }) =>
        hub.laneType === 'branch' &&
        hub.laneRef === laneRef &&
        typeof hub.branchDepth === 'number',
    )
    .sort((a, b) => (a.hub.branchDepth ?? 0) - (b.hub.branchDepth ?? 0));
}

function collectBranchLaneScoringUnits(
  board: BoardState,
  laneRef: string,
  hubValue: number,
  branch: BranchArm,
): LaneScoringUnit[] {
  const last = branch.tiles[branch.tiles.length - 1];
  const units: LaneScoringUnit[] = [
    {
      position: laneRef as PlacementPosition,
      tile: last.tile,
      pip: branchTipPipFromGeometry(hubValue, branch),
      doubled: isDouble(last.tile),
    },
  ];

  for (const { hub, hubId } of getBranchLaneHubs(board, laneRef)) {
    if (!isBranchHubCrossedGeometrically(hub, branch.tiles)) continue;
    for (let arm = 0; arm < 2; arm++) {
      const nestedBranch = hub.branches[arm];
      if (!branchHasPlayableTiles(nestedBranch)) continue;
      units.push(
        ...collectBranchLaneScoringUnits(
          board,
          `branch-${hubId}-${arm}`,
          hub.hubValue,
          nestedBranch,
        ),
      );
    }
  }

  return units;
}

/** Scoring contribution from one populated mainline hub branch arm. */
export function scoreBranchArm(
  board: BoardState,
  parentHub: HubDouble,
  parentHubId: number,
  armIndex: number,
): number {
  const branch = parentHub.branches[armIndex];
  if (!branchHasPlayableTiles(branch)) return 0;

  return collectBranchLaneScoringUnits(
    board,
    `branch-${parentHubId}-${armIndex}`,
    parentHub.hubValue,
    branch,
  ).reduce((sum, unit) => sum + pipContribution(unit.pip, unit.doubled), 0);
}

function explainBranchArm(
  board: BoardState,
  parentHub: HubDouble,
  parentHubId: number,
  armIndex: number,
): OpenEndsContribution[] {
  const branch = parentHub.branches[armIndex];
  if (!branchHasPlayableTiles(branch)) return [];

  return collectBranchLaneScoringUnits(
    board,
    `branch-${parentHubId}-${armIndex}`,
    parentHub.hubValue,
    branch,
  ).map((unit) =>
    describeContribution({
      position: unit.position,
      tile: unit.tile,
      pip: unit.pip,
      isDoubleOpenEnd: unit.doubled,
      side: 'branch',
    }),
  );
}

function getBranchArmScoringPips(
  board: BoardState,
  parentHub: HubDouble,
  parentHubId: number,
  armIndex: number,
): number[] {
  const branch = parentHub.branches[armIndex];
  if (!branchHasPlayableTiles(branch)) return [];

  const pips: number[] = [];
  for (const unit of collectBranchLaneScoringUnits(
    board,
    `branch-${parentHubId}-${armIndex}`,
    parentHub.hubValue,
    branch,
  )) {
    pips.push(unit.pip);
    if (unit.doubled) pips.push(unit.pip);
  }
  return pips;
}

/**
 * Canonical open-ends total from board geometry.
 * Ignores stale leftEnd/rightEnd/openEnd/isCrossed metadata when scoring.
 */
export function computeOpenEndsSum(board: BoardState): number {
  if (board.mainLine.length === 0) return 0;
  if (board.mainLine.length === 1) {
    const t = board.mainLine[0].tile;
    return t.low + t.high;
  }

  let sum = mainlineEndContribution(board, 'left') + mainlineEndContribution(board, 'right');

  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    if (hub.laneType === 'branch') continue;
    if (!isMainlineHubCrossedGeometrically(hub, board.mainLine.length)) continue;
    const id = hubIdAt(hub, hubIdx);
    sum += scoreBranchArm(board, hub, id, 0);
    sum += scoreBranchArm(board, hub, id, 1);
  }

  return sum;
}

export function explainOpenEndsSum(board: BoardState): OpenEndsContribution[] {
  if (board.mainLine.length === 0) return [];
  if (board.mainLine.length === 1) {
    const tile = board.mainLine[0].tile;
    return [
      describeContribution({
        position: 'left',
        tile,
        pip: tile.low,
        isDoubleOpenEnd: false,
        side: 'mainline-left',
      }),
      describeContribution({
        position: 'right',
        tile,
        pip: tile.high,
        isDoubleOpenEnd: false,
        side: 'mainline-right',
      }),
    ];
  }

  const contributions: OpenEndsContribution[] = [];
  const leftPlaced = board.mainLine[0];
  const rightPlaced = board.mainLine[board.mainLine.length - 1];
  contributions.push(
    describeContribution({
      position: 'left',
      tile: leftPlaced.tile,
      pip: endpointPipFromOrientation(leftPlaced, 'left'),
      isDoubleOpenEnd: isDouble(leftPlaced.tile),
      side: 'mainline-left',
    }),
  );
  contributions.push(
    describeContribution({
      position: 'right',
      tile: rightPlaced.tile,
      pip: endpointPipFromOrientation(rightPlaced, 'right'),
      isDoubleOpenEnd: isDouble(rightPlaced.tile),
      side: 'mainline-right',
    }),
  );

  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    if (hub.laneType === 'branch') continue;
    if (!isMainlineHubCrossedGeometrically(hub, board.mainLine.length)) continue;
    const id = hubIdAt(hub, hubIdx);
    for (let arm = 0; arm < 2; arm++) {
      contributions.push(...explainBranchArm(board, hub, id, arm));
    }
  }

  return contributions;
}

/** Per-pip scoring contributions (for audits; sum equals computeOpenEndsSum). */
export function getScoringOpenEndPips(board: BoardState): number[] {
  if (board.mainLine.length === 0) return [];
  if (board.mainLine.length === 1) {
    const t = board.mainLine[0].tile;
    return [t.low, t.high];
  }

  const pips: number[] = [];
  const pushEnd = (pip: number, doubled: boolean) => {
    pips.push(pip);
    if (doubled) pips.push(pip);
  };

  const leftPlaced = board.mainLine[0];
  const rightPlaced = board.mainLine[board.mainLine.length - 1];
  pushEnd(endpointPipFromOrientation(leftPlaced, 'left'), isDouble(leftPlaced.tile));
  pushEnd(endpointPipFromOrientation(rightPlaced, 'right'), isDouble(rightPlaced.tile));

  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    if (hub.laneType === 'branch') continue;
    if (!isMainlineHubCrossedGeometrically(hub, board.mainLine.length)) continue;
    const id = hubIdAt(hub, hubIdx);
    for (let arm = 0; arm < 2; arm++) {
      for (const pip of getBranchArmScoringPips(board, hub, id, arm)) {
        pips.push(pip);
      }
    }
  }

  return pips;
}

export function sanitizeBoardBranchSlots(board: BoardState): BoardState {
  return {
    ...board,
    hubDoubles: board.hubDoubles.map((hub) => ({
      ...hub,
      branches: [0, 1].map((armIdx) => {
        const branch = hub.branches[armIdx];
        if (!branch || branch.tiles.length === 0) return null;
        return branch;
      }),
    })),
  };
}

/** Refresh metadata from geometry (for hydration paths). */
export function reconcileBoardOpenEndsMetadata(board: BoardState): BoardState {
  const mainLine = board.mainLine;
  if (!mainLine.length) return sanitizeBoardBranchSlots(board);

  const leftEnd = endpointPipFromOrientation(mainLine[0], 'left');
  const rightEnd = endpointPipFromOrientation(mainLine[mainLine.length - 1], 'right');

  const hubDoubles = board.hubDoubles.map((hub, hubIdx) => {
    const geoCrossed = isHubCrossedGeometrically(hub, board);
    const branches = [0, 1].map((armIdx) => {
      const branch = hub.branches[armIdx];
      if (!branchHasPlayableTiles(branch)) return null;
      const openEnd = branchTipPipFromGeometry(hub.hubValue, branch);
      const last = branch.tiles[branch.tiles.length - 1];
      return {
        ...branch,
        openEnd,
        openEndIsDouble: isDouble(last.tile),
      };
    });

    return {
      ...hub,
      hubId: hubIdAt(hub, hubIdx),
      isCrossed: geoCrossed,
      branches,
    };
  });

  return sanitizeBoardBranchSlots({
    ...board,
    leftEnd,
    rightEnd,
    leftEndIsDouble: isDouble(mainLine[0].tile),
    rightEndIsDouble: isDouble(mainLine[mainLine.length - 1].tile),
    hubDoubles,
  });
}

/** Hydrate boards from snapshots, puzzles, lessons, or replay (geometry wins over stale metadata). */
export function hydrateBoardForOpenEnds(board: BoardState): BoardState {
  const hydrated = reconcileBoardOpenEndsMetadata(sanitizeBoardBranchSlots(board));
  assertOpenEndsSumConsistent(hydrated, 'hydrateBoardForOpenEnds');
  return hydrated;
}

export function auditOpenEndsBoard(board: BoardState): OpenEndsAuditIssue[] {
  const issues: OpenEndsAuditIssue[] = [];
  const mainLine = board.mainLine;

  if (mainLine.length >= 2) {
    const geoLeft = endpointPipFromOrientation(mainLine[0], 'left');
    const geoRight = endpointPipFromOrientation(mainLine[mainLine.length - 1], 'right');
    const geoLeftDouble = isDouble(mainLine[0].tile);
    const geoRightDouble = isDouble(mainLine[mainLine.length - 1].tile);

    if (board.leftEnd !== geoLeft || board.leftEndIsDouble !== geoLeftDouble) {
      issues.push({
        code: 'mainline_end_metadata_mismatch',
        message: `leftEnd metadata (${board.leftEnd}, double=${board.leftEndIsDouble}) != geometry (${geoLeft}, double=${geoLeftDouble})`,
      });
    }
    if (board.rightEnd !== geoRight || board.rightEndIsDouble !== geoRightDouble) {
      issues.push({
        code: 'mainline_end_metadata_mismatch',
        message: `rightEnd metadata (${board.rightEnd}, double=${board.rightEndIsDouble}) != geometry (${geoRight}, double=${geoRightDouble})`,
      });
    }
  }

  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    const id = hubIdAt(hub, hubIdx);
    const geoCrossed = isHubCrossedGeometrically(hub, board);
    if (hub.isCrossed !== geoCrossed) {
      issues.push({
        code: 'is_crossed_metadata_mismatch',
        message: `hub ${id} isCrossed=${hub.isCrossed} but geometry says ${geoCrossed}`,
        hubId: id,
      });
    }

    for (let armIdx = 0; armIdx < 2; armIdx++) {
      const branch = hub.branches[armIdx];
      if (!branch) continue;
      if (branch.tiles.length === 0) {
        issues.push({
          code: 'empty_branch_object',
          message: `hub ${id} arm ${armIdx} has branch object with tiles.length === 0`,
          hubId: id,
          armIndex: armIdx,
        });
        if (typeof branch.openEnd === 'number') {
          issues.push({
            code: 'empty_branch_open_end',
            message: `hub ${id} arm ${armIdx} empty branch still has openEnd=${branch.openEnd}`,
            hubId: id,
            armIndex: armIdx,
          });
        }
        continue;
      }

      const geoTip = branchTipPipFromGeometry(hub.hubValue, branch);
      const geoDouble = isDouble(branch.tiles[branch.tiles.length - 1].tile);
      if (branch.openEnd !== geoTip || branch.openEndIsDouble !== geoDouble) {
        issues.push({
          code: 'branch_tip_metadata_mismatch',
          message: `hub ${id} arm ${armIdx} tip metadata (${branch.openEnd}, double=${branch.openEndIsDouble}) != geometry (${geoTip}, double=${geoDouble})`,
          hubId: id,
          armIndex: armIdx,
        });
      }
    }
  }

  return issues;
}

export function warnOpenEndsBoardIssues(board: BoardState, context = 'board'): void {
  if (!IS_DEV) return;
  const issues = auditOpenEndsBoard(board);
  if (issues.length === 0) return;
  console.warn(`[open-ends:${context}]`, issues);
}

export function assertOpenEndsSumConsistent(board: BoardState, context = 'board'): void {
  if (!IS_DEV) return;
  const sum = computeOpenEndsSum(board);
  const pipSum = getScoringOpenEndPips(board).reduce((a, b) => a + b, 0);
  if (sum !== pipSum) {
    console.error(`[open-ends:${context}] computeOpenEndsSum=${sum} != pip breakdown ${pipSum}`);
  }
  warnOpenEndsBoardIssues(board, context);
}
