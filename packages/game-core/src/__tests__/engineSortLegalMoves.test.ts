/**
 * GC-8 (HARDENING_PLAN §7.3): `getLegalMoves` output order is a load-bearing
 * contract (Fritz policy-v1 tie selection + every replay's move enumeration
 * depend on it). This pins it for a fixed position.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  getLegalMoves,
  type BoardState,
  type GameState,
  type Move,
  type Tile,
} from '../index';

function key(move: Move): string {
  if (move.type === 'pass') return 'pass';
  const lo = Math.min(move.tile.low, move.tile.high);
  const hi = Math.max(move.tile.low, move.tile.high);
  return `${lo}|${hi}@${move.position}`;
}

function openState(hand: Tile[], board: BoardState): GameState {
  return {
    config: DEFAULT_CONFIG,
    playerIds: ['a', 'b'],
    players: { a: { id: 'a', hand, score: 0 }, b: { id: 'b', hand: [], score: 0 } },
    board,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

describe('getLegalMoves order is pinned (GC-8)', () => {
  it('sorts plays by canonical tile id (code-unit), then left → right', () => {
    // Board: 3|3 (double) — 3|5. Open ends: left = 3, right = 5.
    const board: BoardState = {
      mainLine: [
        { tile: { low: 3, high: 3 }, orientation: 'vertical-normal' },
        { tile: { low: 3, high: 5 }, orientation: 'horizontal-normal' },
      ],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: true,
      rightEndIsDouble: false,
      hubDoubles: [{
        hubId: 0, laneType: 'mainline', laneRef: 'mainline', tileIndex: 0, mainlineIndex: 0,
        hubValue: 3, isCrossed: false, leftSideFilled: false, rightSideFilled: true, branches: [],
      }],
    };
    // Hand chosen so several tiles match, exercising the tile-id then position sort.
    const hand: Tile[] = [{ low: 5, high: 6 }, { low: 0, high: 3 }, { low: 3, high: 5 }, { low: 1, high: 5 }];
    const moves = getLegalMoves(openState(hand, board), 'a');
    expect(moves.map(key)).toEqual([
      '0|3@left',
      '1|5@right',
      '3|5@left',
      '3|5@right',
      '5|6@right',
    ]);
  });
});
