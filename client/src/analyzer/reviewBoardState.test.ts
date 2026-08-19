import { describe, expect, it } from 'vitest';
import { simulatePlacement } from '@racehorse/game-core';
import type { BoardState, PlacementPosition, Tile } from '../types.ts';
import {
  normalizeBoardRenderState,
  snapshotBoardState,
  type MoveEntry,
} from '../game/moveLogger.ts';
import { analyzeMoveLog } from './moveAnalyzer.ts';

type Placement = {
  handNumber: number;
  player: MoveEntry['player'];
  tile: Tile;
  position: PlacementPosition;
};

function tuple(tile: Tile): [number, number] {
  return [tile.low, tile.high];
}

function boardEnds(board: BoardState | null): [number, number] {
  return board ? [board.leftEnd, board.rightEnd] : [-1, -1];
}

describe('Game Review post-move board projection', () => {
  it('renders every selected player move after exactly that action across branches and hand resets', () => {
    const placements: Placement[] = [
      { handNumber: 1, player: 'you', tile: { low: 5, high: 5 }, position: 'left' },
      { handNumber: 1, player: 'opponent', tile: { low: 4, high: 5 }, position: 'right' },
      { handNumber: 1, player: 'you', tile: { low: 3, high: 5 }, position: 'left' },
      { handNumber: 1, player: 'opponent', tile: { low: 2, high: 5 }, position: 'branch-0-0' },
      { handNumber: 1, player: 'you', tile: { low: 1, high: 5 }, position: 'branch-0-1' },
      { handNumber: 2, player: 'opponent', tile: { low: 6, high: 6 }, position: 'left' },
      { handNumber: 2, player: 'you', tile: { low: 4, high: 6 }, position: 'right' },
      { handNumber: 2, player: 'you', tile: { low: 3, high: 4 }, position: 'right' },
    ];

    let board: BoardState | null = null;
    let activeHand = placements[0].handNumber;
    const entries: MoveEntry[] = [];
    const expectedAfterPlayerMove = new Map<number, BoardState>();

    placements.forEach((placement, index) => {
      if (placement.handNumber !== activeHand) {
        activeHand = placement.handNumber;
        board = null;
      }

      const before = board;
      const moveNumber = index + 1;
      entries.push({
        moveNumber,
        handNumber: placement.handNumber,
        player: placement.player,
        action: 'place',
        tile: tuple(placement.tile),
        position: placement.position,
        boardEnds: boardEnds(before),
        handBefore: [tuple(placement.tile)],
        validMoves: [tuple(placement.tile)],
        pipDelta: placement.tile.low + placement.tile.high,
        pointsScored: 0,
        boardState: snapshotBoardState(before),
        boardRenderState: before,
        handSnapshot: [tuple(placement.tile)],
        engineBestMove: null,
      });

      board = simulatePlacement(before, placement.tile, placement.position) as unknown as BoardState;
      if (placement.player === 'you') {
        expectedAfterPlayerMove.set(moveNumber, normalizeBoardRenderState(board)!);
      }
    });

    const analysis = analyzeMoveLog(entries);
    expect(analysis.hands.map((hand) => hand.handNumber)).toEqual([1, 2]);
    expect(analysis.analyzedMoves.map((move) => move.moveNumber)).toEqual([1, 3, 5, 7, 8]);

    for (const move of analysis.analyzedMoves) {
      expect(move.boardRenderStateAfterMove, `global move #${move.moveNumber}`).toEqual(
        expectedAfterPlayerMove.get(move.moveNumber),
      );
    }

    expect(analysis.analyzedMoves[0].boardRenderState).toBeNull();
    expect(analysis.hands[1].analyzedMoves[0].boardRenderStateAfterMove?.mainLine).toHaveLength(2);
  });
});
