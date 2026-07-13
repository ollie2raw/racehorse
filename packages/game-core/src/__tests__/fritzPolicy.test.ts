import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  chooseOfficialFritzDecision,
  createDeterministicRandom,
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
    random: createDeterministicRandom('fixed-vector'),
  });
}

describe('official deterministic Fritz fixed vectors', () => {
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

  it('is stable for identical state, tier, and seed', () => {
    const game = state({ hand: [{ low: 0, high: 5 }, { low: 1, high: 4 }] });
    for (const tier of ['rookie', 'standard', 'elite', 'master'] as const) {
      expect(decide(game, tier)).toEqual(decide(game, tier));
    }
  });
});
