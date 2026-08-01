import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  areEquivalentEmptyBranchFritzPlays,
  chooseOfficialFritzDecision,
  chooseOfficialFritzDecisionForVersion,
  FRITZ_POLICY_VERSION,
  getFritzPolicyContract,
  isOptimalOfficialFritzPlay,
  listOptimalOfficialFritzPlays,
  simulatePlacement,
  type BoardState,
  type GameState,
  type Tile,
} from '../index';

function state(input: {
  hand: Tile[];
  board?: BoardState | null;
  boneyard?: Tile[];
  deadTiles?: Tile[];
}): GameState {
  return {
    config: DEFAULT_CONFIG,
    playerIds: ['player', 'fritz'],
    players: {
      player: { id: 'player', hand: [{ low: 1, high: 1 }], score: 0 },
      fritz: { id: 'fritz', hand: input.hand, score: 0 },
    },
    board: input.board ?? null,
    boneyard: input.boneyard ?? [],
    deadTiles: input.deadTiles ?? [],
    currentPlayerIndex: 1,
    handNumber: 1,
    handOpen: input.board != null,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

function decide(game: GameState, tier: 'rookie' | 'standard' | 'elite' | 'master' = 'standard') {
  return chooseOfficialFritzDecision({
    state: game,
    participantId: 'fritz',
    tier,
  });
}

describe('official deterministic Fritz fixed vectors', () => {
  it('keeps current selection pinned to the explicit v2 implementation', () => {
    const game = state({ hand: [{ low: 0, high: 5 }, { low: 1, high: 4 }] });
    expect(chooseOfficialFritzDecision({ state: game, participantId: 'fritz', tier: 'elite' }))
      .toEqual(chooseOfficialFritzDecisionForVersion({
        version: FRITZ_POLICY_VERSION,
        state: game,
        participantId: 'fritz',
        tier: 'elite',
      }));
    expect(getFritzPolicyContract(1)).not.toBe(getFritzPolicyContract(2));
  });
  it('takes the immediate scoring opening instead of a non-scoring double', () => {
    expect(decide(state({ hand: [{ low: 6, high: 6 }, { low: 0, high: 5 }] }))).toEqual({
      kind: 'play',
      tile: { low: 0, high: 5 },
      position: 'left',
    });
  });

  it('selects the only matching placement on an open board', () => {
    const board: BoardState = {
      mainLine: [{ tile: { low: 2, high: 4 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    };
    expect(decide(state({ hand: [{ low: 4, high: 6 }, { low: 0, high: 1 }], board }))).toEqual({
      kind: 'play',
      tile: { low: 4, high: 6 },
      position: 'right',
    });
  });

  it('draws while drawable tiles remain and passes only after they lock', () => {
    const blocked = [{ low: 1, high: 2 }];
    expect(decide(state({
      hand: blocked,
      boneyard: [{ low: 3, high: 4 }, { low: 0, high: 0 }, { low: 0, high: 1 }],
      deadTiles: [{ low: 0, high: 0 }, { low: 0, high: 1 }],
    }))).toEqual({ kind: 'draw' });
    expect(decide(state({
      hand: blocked,
      boneyard: [{ low: 0, high: 0 }, { low: 0, high: 1 }],
      deadTiles: [{ low: 0, high: 0 }, { low: 0, high: 1 }],
    }))).toEqual({ kind: 'pass' });
  });

  it('is stable for identical state and tier', () => {
    const game = state({ hand: [{ low: 0, high: 5 }, { low: 1, high: 4 }] });
    for (const tier of ['rookie', 'standard', 'elite', 'master'] as const) {
      expect(decide(game, tier)).toEqual(decide(game, tier));
    }
  });

  it('prefers the lower empty branch arm when both arms are open for the same tile', () => {
    let board = simulatePlacement(null, { low: 5, high: 5 }, 'left');
    board = simulatePlacement(board, { low: 3, high: 5 }, 'right');
    board = simulatePlacement(board, { low: 2, high: 5 }, 'left');
    // Crossed [5|5] with both branch arms empty; only matching tile is 1|5.
    const decision = decide(state({
      hand: [{ low: 1, high: 5 }],
      board,
    }), 'elite');
    expect(decision).toEqual({
      kind: 'play',
      tile: { low: 1, high: 5 },
      position: 'branch-0-0',
    });
  });

  it('treats empty sibling branch arms as equivalent Fritz plays', () => {
    let board = simulatePlacement(null, { low: 5, high: 5 }, 'left');
    board = simulatePlacement(board, { low: 3, high: 5 }, 'right');
    board = simulatePlacement(board, { low: 2, high: 5 }, 'left');
    const game = state({ hand: [{ low: 1, high: 5 }], board });
    expect(
      areEquivalentEmptyBranchFritzPlays(
        game,
        { kind: 'play', tile: { low: 1, high: 5 }, position: 'branch-0-1' },
        { kind: 'play', tile: { low: 1, high: 5 }, position: 'branch-0-0' },
      ),
    ).toBe(true);
  });

  it('lists both empty sibling arms as optimal for verification', () => {
    let board = simulatePlacement(null, { low: 5, high: 5 }, 'left');
    board = simulatePlacement(board, { low: 3, high: 5 }, 'right');
    board = simulatePlacement(board, { low: 2, high: 5 }, 'left');
    const game = state({ hand: [{ low: 1, high: 5 }], board });
    const optimal = listOptimalOfficialFritzPlays({
      state: game,
      participantId: 'fritz',
      tier: 'elite',
    });
    expect(optimal.map((move) => move.position).sort()).toEqual(['branch-0-0', 'branch-0-1']);
    expect(isOptimalOfficialFritzPlay({
      state: game,
      participantId: 'fritz',
      tier: 'elite',
      tile: { low: 1, high: 5 },
      position: 'branch-0-1',
    })).toBe(true);
  });

  it('prefers right when it uniquely outscores empty branch opens', () => {
    // right=0, hub1=5; 0|5 scores better on the mainline end than opening a branch.
    let board = simulatePlacement(null, { low: 6, high: 6 }, 'left');
    board = simulatePlacement(board, { low: 6, high: 1 }, 'left');
    board = simulatePlacement(board, { low: 6, high: 2 }, 'right');
    board = simulatePlacement(board, { low: 2, high: 5 }, 'right');
    board = simulatePlacement(board, { low: 5, high: 5 }, 'right');
    board = simulatePlacement(board, { low: 5, high: 0 }, 'right');
    const game = state({ hand: [{ low: 0, high: 5 }], board });
    expect(decide(game, 'elite')).toEqual({
      kind: 'play',
      tile: { low: 0, high: 5 },
      position: 'right',
    });
    expect(isOptimalOfficialFritzPlay({
      state: game,
      participantId: 'fritz',
      tier: 'elite',
      tile: { low: 0, high: 5 },
      position: 'branch-1-1',
    })).toBe(false);
  });
});
