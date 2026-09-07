import { describe, expect, it } from 'vitest';
import { computeOptimisticPlayState } from './optimisticPlay';
import type { GameState } from '../../../types';

const YOU = 'you';
const OPP = 'opp';

function state(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: [YOU, OPP],
    players: {
      [YOU]: { id: YOU, hand: [{ low: 6, high: 6 }, { low: 1, high: 2 }], score: 0 },
      [OPP]: { id: OPP, hand: [], score: 0 },
    },
    board: null,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 4,
    ...overrides,
  };
}

describe('computeOptimisticPlayState (MP-JIT-2)', () => {
  it('applies a legal opening double: tile leaves the hand, board opens, sequence bumps', () => {
    const next = computeOptimisticPlayState(state(), YOU, { low: 6, high: 6 }, 'left');
    expect(next).not.toBeNull();
    expect(next!.players[YOU].hand).toEqual([{ low: 1, high: 2 }]);
    expect(next!.board).not.toBeNull();
    expect(next!.sequence).toBe(5);
  });

  it('returns null when it is not the actor\'s turn', () => {
    expect(
      computeOptimisticPlayState(state({ currentPlayerIndex: 1 }), YOU, { low: 6, high: 6 }, 'left'),
    ).toBeNull();
  });

  it('returns null when the hand or game is over', () => {
    expect(computeOptimisticPlayState(state({ handOver: true }), YOU, { low: 6, high: 6 }, 'left')).toBeNull();
    expect(computeOptimisticPlayState(state({ gameOver: true }), YOU, { low: 6, high: 6 }, 'left')).toBeNull();
  });

  it('returns null when the engine rejects the move (illegal open with a non-scoring non-double)', () => {
    expect(computeOptimisticPlayState(state(), YOU, { low: 1, high: 2 }, 'left')).toBeNull();
  });

  it('does not mutate the input state', () => {
    const s = state();
    const handRef = s.players[YOU].hand;
    computeOptimisticPlayState(s, YOU, { low: 6, high: 6 }, 'left');
    expect(s.players[YOU].hand).toBe(handRef);
    expect(s.players[YOU].hand).toHaveLength(2);
    expect(s.sequence).toBe(4);
    expect(s.board).toBeNull();
  });
});
