import { computeOpenEndsSum, simulatePlacement } from '../../bot/botEngine';
import type { BoardState, PlacementPosition, Tile } from '../../types';
import type { LearnBoardState } from '../engine/types';

function tile(low: number, high: number): Tile {
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

export function boardStateToLearnFixture(board: BoardState): LearnBoardState {
  return {
    mainLine: board.mainLine.map((placement) => ({
      tile: [placement.tile.low, placement.tile.high] as [number, number],
      orientation: placement.orientation,
    })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble ?? false,
    rightEndIsDouble: board.rightEndIsDouble ?? false,
    hubDoubles: board.hubDoubles,
    openEndsSum: computeOpenEndsSum(board),
  };
}

function resolveBranchPosition(board: BoardState, play: Tile): PlacementPosition {
  const candidates: PlacementPosition[] = ['branch-0-0', 'branch-0-1', 'branch-1-0', 'branch-1-1'];
  for (const position of candidates) {
    try {
      simulatePlacement(board, play, position);
      return position;
    } catch {
      // try next branch slot
    }
  }
  throw new Error('No legal branch position for doubles tempo stage 3');
}

/** Image 1 → 2 → 3 boards: double-1 | 1-4 | double-4, then +4-3, then +5-4 on branch. */
export function buildDoublesTempoBoards() {
  let stage1Board = simulatePlacement(null, tile(1, 1), 'left');
  stage1Board = simulatePlacement(stage1Board, tile(1, 4), 'right');
  stage1Board = simulatePlacement(stage1Board, tile(4, 4), 'right');

  const stage2Board = simulatePlacement(stage1Board, tile(4, 3), 'right');
  const branchPosition = resolveBranchPosition(stage2Board, tile(5, 4));
  const stage3Board = simulatePlacement(stage2Board, tile(5, 4), branchPosition);

  return {
    boards: {
      stage1: boardStateToLearnFixture(stage1Board),
      stage2: boardStateToLearnFixture(stage2Board),
      stage3: boardStateToLearnFixture(stage3Board),
    },
    openCounts: {
      stage1: computeOpenEndsSum(stage1Board),
      stage2: computeOpenEndsSum(stage2Board),
      stage3: computeOpenEndsSum(stage3Board),
      branchPosition,
    },
  };
}

const BUILT = buildDoublesTempoBoards();

export const DOUBLES_TEMPO_BOARD_STAGE_1 = BUILT.boards.stage1;
export const DOUBLES_TEMPO_BOARD_STAGE_2 = BUILT.boards.stage2;
export const DOUBLES_TEMPO_BOARD_STAGE_3 = BUILT.boards.stage3;
export const DOUBLES_TEMPO_OPEN_COUNTS = BUILT.openCounts;
