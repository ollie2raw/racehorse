import type { BoardState, PlacementPosition, Tile } from '../types';

export type TileTuple = [number, number];

export type EngineBestMove = {
  tile: TileTuple;
  position?: PlacementPosition;
  score: number;
  breakdown?: {
    immediate: number;
    doubleBias: number;
    mobility: number;
    denial: number;
    unload: number;
    replyRisk: number;
  };
};

export type BoardSnapshotEntry = {
  tile: TileTuple;
  position: PlacementPosition;
  source: 'mainline' | 'branch';
};

export type MoveEntry = {
  moveNumber: number;
  player: 'you' | 'opponent';
  action: 'place' | 'draw' | 'pass';
  tile?: TileTuple;
  boardEnds: [number, number];
  handBefore: TileTuple[];
  validMoves: TileTuple[];
  pipDelta: number;
  pointsScored: number;
  boardState: BoardSnapshotEntry[];
  boardRenderState: BoardState | null;
  handSnapshot: TileTuple[];
  engineBestMove: EngineBestMove | null;
};

export function toTileTuple(tile: Tile): TileTuple {
  return [tile.low, tile.high];
}

function keyOf(tile: TileTuple): string {
  const a = Math.min(tile[0], tile[1]);
  const b = Math.max(tile[0], tile[1]);
  return `${a}|${b}`;
}

export function sameTileTuple(a?: TileTuple, b?: TileTuple): boolean {
  if (!a || !b) return false;
  return keyOf(a) === keyOf(b);
}

export function cloneBoardState(board: BoardState | null): BoardState | null {
  return board ? (JSON.parse(JSON.stringify(board)) as BoardState) : null;
}

export function snapshotBoardState(board: BoardState | null): BoardSnapshotEntry[] {
  if (!board) return [];
  const mainLine: BoardSnapshotEntry[] = board.mainLine.map((placed, idx) => ({
    tile: [placed.tile.low, placed.tile.high],
    position:
      idx === 0
        ? 'left'
        : idx === board.mainLine.length - 1
          ? 'right'
          : 'right',
    source: 'mainline',
  }));

  const branches: BoardSnapshotEntry[] = [];
  for (const hub of board.hubDoubles) {
    const hubId = hub.hubId ?? hub.tileIndex ?? 0;
    for (let armIdx = 0; armIdx < hub.branches.length; armIdx++) {
      const arm = hub.branches[armIdx];
      if (!arm) continue;
      for (const placed of arm.tiles ?? []) {
        branches.push({
          tile: [placed.tile.low, placed.tile.high],
          position: `branch-${hubId}-${armIdx}`,
          source: 'branch',
        });
      }
    }
  }

  return [...mainLine, ...branches];
}

function immediatePoints(ends: [number, number]): number {
  return (ends[0] + ends[1]) / 5;
}

export function nextEndsForTile(tile: TileTuple, boardEnds: [number, number]): Array<[number, number]> {
  const [left, right] = boardEnds;
  if (left < 0 || right < 0) return [[tile[0], tile[1]]];

  const out: Array<[number, number]> = [];
  if (tile[0] === left) out.push([tile[1], right]);
  if (tile[1] === left) out.push([tile[0], right]);
  if (tile[0] === right) out.push([left, tile[1]]);
  if (tile[1] === right) out.push([left, tile[0]]);
  return out;
}

export function setupScore(remaining: TileTuple[], ends: [number, number]): number {
  let score = 0;
  for (const tile of remaining) {
    const matchesLeft = tile[0] === ends[0] || tile[1] === ends[0];
    const matchesRight = tile[0] === ends[1] || tile[1] === ends[1];
    if (matchesLeft || matchesRight) score += 1;
    if (matchesLeft && matchesRight) score += 1;
  }
  return score;
}

export function remainingHandAfterPlay(handBefore: TileTuple[], played: TileTuple): TileTuple[] {
  const playedKey = keyOf(played);
  let removed = false;
  return handBefore.filter((tile) => {
    if (!removed && keyOf(tile) === playedKey) {
      removed = true;
      return false;
    }
    return true;
  });
}

export function valueForTile(
  tile: TileTuple,
  boardEnds: [number, number],
  handBefore: TileTuple[],
): number {
  const possibilities = nextEndsForTile(tile, boardEnds);
  if (possibilities.length === 0) return Number.NEGATIVE_INFINITY;
  const remaining = remainingHandAfterPlay(handBefore, tile);
  let best = Number.NEGATIVE_INFINITY;
  for (const ends of possibilities) {
    const points = immediatePoints(ends);
    const future = setupScore(remaining, ends);
    best = Math.max(best, points * 3 + future * 2);
  }
  return best;
}

export function pickEngineBestMove(
  legalMoves: Array<{ tile: TileTuple; position?: PlacementPosition }>,
  boardEnds: [number, number],
  handSnapshot: TileTuple[],
): EngineBestMove | null {
  if (legalMoves.length === 0) return null;
  let best = legalMoves[0];
  let bestScore = valueForTile(best.tile, boardEnds, handSnapshot);
  for (const candidate of legalMoves.slice(1)) {
    const score = valueForTile(candidate.tile, boardEnds, handSnapshot);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return {
    tile: best.tile,
    position: best.position,
    score: bestScore,
  };
}
