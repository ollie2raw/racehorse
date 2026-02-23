import type {
  Tile,
  BoardState,
  BranchArm,
  PlacedTile,
  PlacementPosition,
  Move,
  TileOrientation,
} from '../types';

export interface NoBrainerPracticeState {
  status: 'playing' | 'won' | 'failed';
  message: string;
  handOpen: boolean;
  remainingHand: Tile[];
  board: BoardState | null;
  openEnds: number[];
  openSum: number;
  scored: boolean;
  mustContinue: boolean;
  legalMoves: Move[];
}

export interface PracticeHint {
  tile: Tile;
  position: PlacementPosition;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function isDouble(tile: Tile): boolean {
  return tile.high === tile.low;
}

function tileMatchesEnd(tile: Tile, endValue: number): boolean {
  return tile.high === endValue || tile.low === endValue;
}

function removeTileOnce(hand: Tile[], tile: Tile): Tile[] {
  const idx = hand.findIndex((t) => tileEquals(t, tile));
  if (idx === -1) return [...hand];
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

function parseBranchPosition(
  pos: PlacementPosition,
): { hubIndex: number; armIndex: number } | null {
  if (pos === 'left' || pos === 'right') return null;
  const match = pos.match(/^branch-(\d+)-(\d+)$/);
  if (!match) return null;
  return { hubIndex: Number(match[1]), armIndex: Number(match[2]) };
}

function hubIdAt(hub: BoardState['hubDoubles'][number], fallbackIdx: number): number {
  return hub.hubId ?? fallbackIdx;
}

function nextHubId(board: BoardState): number {
  if (board.hubDoubles.length === 0) return 0;
  return Math.max(...board.hubDoubles.map((h, idx) => hubIdAt(h, idx))) + 1;
}

function getPlacementOrientation(
  tile: Tile,
  matchValue: number,
  placementSide: 'left' | 'right' | 'branch',
): TileOrientation {
  if (isDouble(tile)) {
    return 'vertical-normal';
  }
  if (placementSide === 'left') {
    return tile.high === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  }
  if (placementSide === 'right') {
    return tile.low === matchValue ? 'horizontal-normal' : 'horizontal-flipped';
  }
  return tile.high === matchValue ? 'vertical-flipped' : 'vertical-normal';
}

function exposedPip(tile: Tile, matchValue: number): number {
  if (tile.high === matchValue) return tile.low;
  if (tile.low === matchValue) return tile.high;
  return tile.high;
}

function recomputeBranchLaneHubStates(
  hubDoubles: BoardState['hubDoubles'],
  laneRef: string,
  branchTiles: readonly PlacedTile[],
): BoardState['hubDoubles'] {
  return hubDoubles.map((h) => {
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

function placeTileOnMainLine(board: BoardState, tile: Tile, end: 'left' | 'right'): BoardState {
  const matchValue = end === 'left' ? board.leftEnd : board.rightEnd;
  const newExposedEnd = exposedPip(tile, matchValue);
  const tileIsDouble = isDouble(tile);

  const placedTile: PlacedTile = {
    tile,
    orientation: getPlacementOrientation(tile, matchValue, end),
  };

  const newMainLine =
    end === 'left' ? [placedTile, ...board.mainLine] : [...board.mainLine, placedTile];

  const newLeftEnd = end === 'left' ? newExposedEnd : board.leftEnd;
  const newRightEnd = end === 'right' ? newExposedEnd : board.rightEnd;
  const newLeftEndIsDouble = end === 'left' ? tileIsDouble : board.leftEndIsDouble;
  const newRightEndIsDouble = end === 'right' ? tileIsDouble : board.rightEndIsDouble;

  let newHubDoubles = [...board.hubDoubles];
  const endpointIndex = end === 'left' ? 0 : board.mainLine.length - 1;
  newHubDoubles = newHubDoubles.map((hub) => {
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

  if (end === 'left') {
    newHubDoubles = newHubDoubles.map((h) => {
      const nextIndex = (h.mainlineIndex ?? h.tileIndex) + 1;
      return {
        ...h,
        tileIndex: nextIndex,
        mainlineIndex: nextIndex,
      };
    });
  } else {
    newHubDoubles = newHubDoubles.map((h) => ({
      ...h,
      mainlineIndex: h.mainlineIndex ?? h.tileIndex,
    }));
  }

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

function placeTileOnBranch(
  board: BoardState,
  tile: Tile,
  hubRef: number,
  armIndex: number,
): BoardState {
  const hubIndex = board.hubDoubles.findIndex((h, idx) => hubIdAt(h, idx) === hubRef);
  const hub = hubIndex >= 0 ? board.hubDoubles[hubIndex] : null;
  if (!hub || !hub.isCrossed || armIndex >= 2) {
    throw new Error('Invalid branch placement.');
  }

  const tileIsDouble = isDouble(tile);
  const laneRef = `branch-${hubRef}-${armIndex}`;
  let newBranches: BranchArm[];
  let newHubDoubles = [...board.hubDoubles];

  if (hub.branches[armIndex]) {
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
        : b,
    );

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

    newHubDoubles = [
      ...recomputeBranchLaneHubStates(newHubDoubles, laneRef, newBranches[armIndex]?.tiles ?? []),
    ];
  } else {
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

    newHubDoubles = [
      ...recomputeBranchLaneHubStates(newHubDoubles, laneRef, newBranches[armIndex]?.tiles ?? []),
    ];
  }

  newHubDoubles = newHubDoubles.map((h, i) =>
    i === hubIndex ? { ...h, branches: newBranches } : h,
  );

  return {
    ...board,
    hubDoubles: newHubDoubles,
  };
}

function simulatePlacement(
  board: BoardState | null,
  tile: Tile,
  position: PlacementPosition,
): BoardState {
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
    if (isDouble(tile)) {
      const hubId = nextHubId(newBoard);
      return {
        ...newBoard,
        hubDoubles: [
          {
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
          },
        ],
      };
    }
    return newBoard;
  }

  const branchPos = parseBranchPosition(position);
  if (branchPos !== null) {
    return placeTileOnBranch(board, tile, branchPos.hubIndex, branchPos.armIndex);
  }
  return placeTileOnMainLine(board, tile, position as 'left' | 'right');
}

function getOpenEnds(
  board: BoardState | null,
): Array<{ position: PlacementPosition; matchValue: number }> {
  if (board === null) {
    return [{ position: 'left', matchValue: -1 }];
  }

  const ends: Array<{ position: PlacementPosition; matchValue: number }> = [
    { position: 'left', matchValue: board.leftEnd },
    { position: 'right', matchValue: board.rightEnd },
  ];

  for (let hubIdx = 0; hubIdx < board.hubDoubles.length; hubIdx++) {
    const hub = board.hubDoubles[hubIdx];
    const hubId = hubIdAt(hub, hubIdx);
    if (!hub.isCrossed) continue;
    for (let armIdx = 0; armIdx < 2; armIdx++) {
      const branch = hub.branches[armIdx];
      ends.push({
        position: `branch-${hubId}-${armIdx}`,
        matchValue: branch ? branch.openEnd : hub.hubValue,
      });
    }
  }

  return ends;
}

function endpointMatchFromOrientation(board: BoardState, side: 'left' | 'right'): number {
  const placed = side === 'left' ? board.mainLine[0] : board.mainLine[board.mainLine.length - 1];
  if (!placed) return side === 'left' ? board.leftEnd : board.rightEnd;
  const tile = placed.tile;
  if (isDouble(tile)) return tile.high;
  if (placed.orientation === 'horizontal-normal') {
    return side === 'left' ? tile.low : tile.high;
  }
  if (placed.orientation === 'horizontal-flipped') {
    return side === 'left' ? tile.high : tile.low;
  }
  return side === 'left' ? board.leftEnd : board.rightEnd;
}

function getMatchableOpenEnds(
  board: BoardState | null,
): Array<{ position: PlacementPosition; matchValue: number }> {
  const openEndsRaw = getOpenEnds(board);
  if (!board) return openEndsRaw;
  return openEndsRaw.map((end) => {
    if (end.position === 'left') {
      return { ...end, matchValue: endpointMatchFromOrientation(board, 'left') };
    }
    if (end.position === 'right') {
      return { ...end, matchValue: endpointMatchFromOrientation(board, 'right') };
    }
    return end;
  });
}

function computeOpenEndsSum(board: BoardState): number {
  if (board.mainLine.length === 1) {
    const t = board.mainLine[0].tile;
    return t.high + t.low;
  }

  let sum = 0;
  sum += board.leftEndIsDouble ? board.leftEnd * 2 : board.leftEnd;
  sum += board.rightEndIsDouble ? board.rightEnd * 2 : board.rightEnd;

  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (!branch) continue;
      sum += branch.openEndIsDouble ? branch.openEnd * 2 : branch.openEnd;
    }
  }
  return sum;
}

function computePlayScore(board: BoardState): number {
  const sum = computeOpenEndsSum(board);
  return sum % 5 === 0 ? sum / 5 : 0;
}

function getLegalMovesForState(
  remainingHand: Tile[],
  board: BoardState | null,
  handOpen: boolean,
): Move[] {
  const moves: Move[] = [];

  if (!handOpen) {
    for (const tile of remainingHand) {
      const simBoard = simulatePlacement(null, tile, 'left');
      const scores = computePlayScore(simBoard) > 0;
      const double = isDouble(tile);
      if (double || scores) {
        moves.push({ type: 'play', tile, position: 'left' });
      }
    }
    return moves;
  }

  const openEnds = getMatchableOpenEnds(board);
  for (const tile of remainingHand) {
    const matchingPositions: PlacementPosition[] = [];
    for (const end of openEnds) {
      if (tileMatchesEnd(tile, end.matchValue)) {
        matchingPositions.push(end.position);
      }
    }
    const uniquePositions = [...new Set(matchingPositions)];
    for (const position of uniquePositions) {
      moves.push({ type: 'play', tile, position });
    }
  }
  return moves;
}

function toDerived(board: BoardState | null) {
  if (!board) {
    return { openEnds: [], openSum: 0 };
  }
  const openEnds = getMatchableOpenEnds(board).map((end) => end.matchValue);
  const openSum = computeOpenEndsSum(board);
  return { openEnds, openSum };
}

export function createPracticeState(hand: Tile[]): NoBrainerPracticeState {
  const remainingHand = [...hand];
  const board: BoardState | null = null;
  const legalMoves = getLegalMovesForState(remainingHand, board, false);

  if (legalMoves.length === 0) {
    return {
      status: 'failed',
      message: 'No legal opening move (must open with a double or scoring tile).',
      handOpen: false,
      remainingHand,
      board,
      openEnds: [],
      openSum: 0,
      scored: false,
      mustContinue: false,
      legalMoves,
    };
  }

  return {
    status: 'playing',
    message: 'Play all 7 tiles in one turn. Doubles or scoring plays let you continue.',
    handOpen: false,
    remainingHand,
    board,
    openEnds: [],
    openSum: 0,
    scored: false,
    mustContinue: false,
    legalMoves,
  };
}

export function playPracticeMove(
  state: NoBrainerPracticeState,
  tile: Tile,
  position: PlacementPosition,
): NoBrainerPracticeState {
  if (state.status !== 'playing') return state;

  const isLegal = state.legalMoves.some(
    (move) =>
      move.type === 'play' &&
      move.position === position &&
      move.tile &&
      tileEquals(move.tile, tile),
  );
  if (!isLegal) {
    return { ...state, message: 'Illegal move for selected position.' };
  }

  const nextBoard = simulatePlacement(state.board, tile, position);
  const nextHand = removeTileOnce(state.remainingHand, tile);
  const scoredPoints = computePlayScore(nextBoard);
  const scored = scoredPoints > 0;
  const playedDouble = isDouble(tile);
  const mustContinue = playedDouble || scored;
  const derived = toDerived(nextBoard);

  if (nextHand.length === 0) {
    if (playedDouble || scored) {
      return {
        ...state,
        status: 'failed',
        message: 'Final tile cannot be a double or scoring tile.',
        handOpen: true,
        remainingHand: nextHand,
        board: nextBoard,
        openEnds: derived.openEnds,
        openSum: derived.openSum,
        scored,
        mustContinue,
        legalMoves: [],
      };
    }
    return {
      ...state,
      status: 'won',
      message: 'Perfect run. Hand cleared legally.',
      handOpen: true,
      remainingHand: nextHand,
      board: nextBoard,
      openEnds: derived.openEnds,
      openSum: derived.openSum,
      scored,
      mustContinue: false,
      legalMoves: [],
    };
  }

  if (!mustContinue) {
    return {
      ...state,
      status: 'failed',
      message: 'Turn ended: move was neither a double nor a scoring play.',
      handOpen: true,
      remainingHand: nextHand,
      board: nextBoard,
      openEnds: derived.openEnds,
      openSum: derived.openSum,
      scored,
      mustContinue: false,
      legalMoves: [],
    };
  }

  const legalMoves = getLegalMovesForState(nextHand, nextBoard, true);
  if (legalMoves.length === 0) {
    return {
      ...state,
      status: 'failed',
      message: 'No legal continuation move available.',
      handOpen: true,
      remainingHand: nextHand,
      board: nextBoard,
      openEnds: derived.openEnds,
      openSum: derived.openSum,
      scored,
      mustContinue: true,
      legalMoves: [],
    };
  }

  return {
    ...state,
    status: 'playing',
    message: playedDouble ? 'Double played. Continue your turn.' : 'Scored! Continue your turn.',
    handOpen: true,
    remainingHand: nextHand,
    board: nextBoard,
    openEnds: derived.openEnds,
    openSum: derived.openSum,
    scored,
    mustContinue,
    legalMoves,
  };
}

export function hintForState(state: NoBrainerPracticeState, example: Tile[]): PracticeHint | null {
  if (state.status !== 'playing') return null;
  for (const candidate of example) {
    const inHand = state.remainingHand.some((t) => tileEquals(t, candidate));
    if (!inHand) continue;
    const legal = state.legalMoves.find(
      (move) => move.type === 'play' && move.tile && tileEquals(move.tile, candidate),
    );
    if (legal && legal.position) {
      return { tile: legal.tile!, position: legal.position };
    }
  }
  return null;
}
