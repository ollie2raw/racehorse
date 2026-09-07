import { describe, expect, it } from 'vitest';
import { computeOptimisticPassState, computeOptimisticPlayState } from './optimisticPlay';
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
    const r = computeOptimisticPlayState(state(), YOU, { low: 6, high: 6 }, 'left');
    expect(r).not.toBeNull();
    expect(r!.nextState.players[YOU].hand).toEqual([{ low: 1, high: 2 }]);
    expect(r!.nextState.board).not.toBeNull();
    expect(r!.nextState.sequence).toBe(5);
  });

  it("returns null when it is not the actor's turn", () => {
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

  // Step 2: a scoring/double play that keeps the turn returns the correct
  // continued-turn legal moves immediately — no ~1-RTT blank.
  it('a continued-turn (double) play returns the actor\'s next legal moves, not []', () => {
    const s = state({
      players: {
        [YOU]: { id: YOU, hand: [{ low: 6, high: 6 }, { low: 3, high: 6 }], score: 0 },
        [OPP]: { id: OPP, hand: [], score: 0 },
      },
    });
    const r = computeOptimisticPlayState(s, YOU, { low: 6, high: 6 }, 'left');
    expect(r).not.toBeNull();
    // turn stayed with YOU after opening a double
    expect(r!.nextState.playerIds[r!.nextState.currentPlayerIndex]).toBe(YOU);
    expect(r!.turnRetained).toBe(true);
    // 3|6 is now playable on the open 6 — the actor can continue with no wait
    expect(r!.nextLegalMoves.length).toBeGreaterThan(0);
    expect(
      r!.nextLegalMoves.every(
        (m) => m.type === 'play' && m.tile && (m.tile.low === 3 || m.tile.high === 3),
      ),
    ).toBe(true);
  });

  it('a normal (turn-passing) play returns [] for the actor', () => {
    // 1|4 board, YOU plays 4|4 (scores 8? 4+4=8, not %5 -> no score, not on empty
    // board... use a non-empty board). Board [1,4], YOU holds [4,5].
    const s = state({
      handOpen: true,
      board: {
        mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' }],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        [YOU]: { id: YOU, hand: [{ low: 4, high: 5 }, { low: 6, high: 6 }], score: 0 },
        [OPP]: { id: OPP, hand: [{ low: 0, high: 0 }], score: 0 },
      },
    });
    const r = computeOptimisticPlayState(s, YOU, { low: 4, high: 5 }, 'right');
    expect(r).not.toBeNull();
    expect(r!.nextState.playerIds[r!.nextState.currentPlayerIndex]).toBe(OPP);
    expect(r!.turnRetained).toBe(false);
    expect(r!.nextLegalMoves).toEqual([]);
    expect(r!.nextCanDraw).toBe(false);
  });
});

describe('computeOptimisticPassState (MP-JIT-2)', () => {
  function passState(): GameState {
    // YOU is blocked: board ends are 6/6, YOU holds only 2|3 and 1|4, boneyard locked.
    return state({
      handOpen: true,
      board: {
        mainLine: [{ tile: { low: 6, high: 6 }, orientation: 'vertical-normal' }],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [],
      },
      players: {
        [YOU]: { id: YOU, hand: [{ low: 2, high: 3 }, { low: 1, high: 4 }], score: 0 },
        [OPP]: { id: OPP, hand: [{ low: 0, high: 0 }], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });
  }

  it('applies a legal pass: turn hands to the opponent, sequence bumps, actor legalMoves []', () => {
    const r = computeOptimisticPassState(passState(), YOU);
    expect(r).not.toBeNull();
    expect(r!.nextState.playerIds[r!.nextState.currentPlayerIndex]).toBe(OPP);
    expect(r!.nextState.sequence).toBe(5);
    expect(r!.nextLegalMoves).toEqual([]);
  });

  it('returns null when a legal play exists (engine rejects the pass)', () => {
    const s = passState();
    s.players[YOU].hand = [{ low: 6, high: 3 }]; // 6|3 plays on the open 6
    expect(computeOptimisticPassState(s, YOU)).toBeNull();
  });

  it("returns null when it is not the actor's turn / hand over", () => {
    expect(computeOptimisticPassState({ ...passState(), currentPlayerIndex: 1 }, YOU)).toBeNull();
    expect(computeOptimisticPassState({ ...passState(), handOver: true }, YOU)).toBeNull();
  });
});
