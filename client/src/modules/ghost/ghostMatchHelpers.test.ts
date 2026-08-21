import { describe, expect, it } from 'vitest';
import { simulatePlacement } from '@racehorse/game-core';
import { snapshotBoardState, cloneBoardState, type MoveEntry } from '../../game/moveLogger.ts';
import type { BoardState } from '../../types.ts';
import { moveEntriesToGhostMoveLog } from './ghostMatchHelpers.ts';

/**
 * The match runtime snapshots the board BEFORE applying the move
 * (collectPlayerMoveSnapshot -> applyPlayMove in usePlayerPlacementHandler.ts),
 * so MoveEntry.boardState never contains the tile that MoveEntry.position
 * describes. moveEntriesToGhostMoveLog must therefore use MoveEntry.position.
 */
function buildEntry(
  boardBefore: BoardState | null,
  tile: [number, number],
  position: 'left' | 'right',
): MoveEntry {
  return {
    moveNumber: 2,
    handNumber: 1,
    player: 'you',
    action: 'place',
    tile,
    position,
    boardEnds: [boardBefore?.leftEnd ?? -1, boardBefore?.rightEnd ?? -1],
    handBefore: [tile],
    validMoves: [tile],
    pipDelta: tile[0] + tile[1],
    pointsScored: 0,
    boardState: snapshotBoardState(boardBefore as never),
    boardRenderState: cloneBoardState(boardBefore as never),
    handSnapshot: [tile],
    engineBestMove: null,
  };
}

describe('moveEntriesToGhostMoveLog — placement side fidelity', () => {
  it('keeps a right-end placement labelled right (non-double)', () => {
    // Board: [2|3] opened, left=2 right=3. Player plays [1|3] on the RIGHT.
    const board = simulatePlacement(null, { low: 2, high: 3 }, 'left') as unknown as BoardState;
    expect([board.leftEnd, board.rightEnd]).toEqual([2, 3]);

    const [entry] = moveEntriesToGhostMoveLog([buildEntry(board, [1, 3], 'right')]);
    expect(entry.branch).toBe('right');
  });

  it('keeps a right-end double placement labelled right', () => {
    // Board: [6|5], left=6 right=5. Player plays the double [5|5] on the RIGHT.
    const board = simulatePlacement(null, { low: 5, high: 6 }, 'left') as unknown as BoardState;
    const board2 = simulatePlacement(
      board as never,
      { low: 5, high: 6 },
      'left',
    ) as unknown as BoardState;
    void board2;

    const [entry] = moveEntriesToGhostMoveLog([buildEntry(board, [5, 5], 'right')]);
    expect(entry.branch).toBe('right');
  });

  it('keeps a branch placement labelled with its branch position', () => {
    const board = simulatePlacement(null, { low: 5, high: 5 }, 'left') as unknown as BoardState;
    const entry = buildEntry(board, [3, 5], 'left');
    (entry as { position: string }).position = 'branch-1-0';
    const [converted] = moveEntriesToGhostMoveLog([entry]);
    expect(converted.branch).toBe('branch-1-0');
  });
});
