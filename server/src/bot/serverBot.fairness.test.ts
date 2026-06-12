import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardState, GameState, Tile } from '../game/types';
import { DEFAULT_CONFIG } from '../game/types';
import { getLegalMoves } from '../game/engine';
import { chooseBotMoveServer } from './serverBot';

const t = (low: number, high: number): Tile => ({ low, high });

function mkBoard(left: number, right: number): BoardState {
  return {
    mainLine: [{ tile: t(Math.min(left, right), Math.max(left, right)), orientation: 'horizontal-normal' }],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  };
}

function mkEndgameState(humanHand: Tile[]): GameState {
  const botId = 'bot-seat';
  const humanId = 'human-seat';
  return {
    config: DEFAULT_CONFIG,
    playerIds: [botId, humanId],
    currentPlayerIndex: 0,
    players: {
      [botId]: { id: botId, hand: [t(2, 5), t(5, 6)], score: 10 },
      [humanId]: { id: humanId, hand: humanHand, score: 8 },
    },
    board: mkBoard(2, 5),
    boneyard: [t(0, 1), t(1, 2), t(3, 3)],
    deadTiles: [t(4, 4), t(6, 6)],
    handOpen: true,
    handNumber: 4,
    turnIndex: 12,
    consecutivePasses: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
  };
}

function moveKey(move: ReturnType<typeof chooseBotMoveServer>): string {
  if (move.type !== 'play' || !move.tile) return move.type;
  return `${move.tile.low}-${move.tile.high}@${move.position ?? 'open'}`;
}

describe('chooseBotMoveServer fairness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('endgame move does not depend on the real hidden human hand', () => {
    let roll = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      roll = (roll + 0.137) % 1;
      return roll;
    });

    const oracleTrap = mkEndgameState([t(6, 6)]);
    const benignHand = mkEndgameState([t(0, 0)]);

    const trapMove = chooseBotMoveServer(oracleTrap, 'bot-seat', new Set(), 'master');
    const benignMove = chooseBotMoveServer(benignHand, 'bot-seat', new Set(), 'master');

    expect(trapMove.type).toBe('play');
    expect(benignMove.type).toBe('play');
    expect(moveKey(trapMove)).toBe(moveKey(benignMove));
  });

  it('returns a legal play move in endgame without freezing', () => {
    const state = mkEndgameState([t(1, 3)]);
    const move = chooseBotMoveServer(state, 'bot-seat', new Set(), 'elite');
    expect(move.type).toBe('play');
    expect(move.tile).toBeTruthy();
  });

  it('returns pass only when no play moves exist', () => {
    const botId = 'bot-seat';
    const humanId = 'human-seat';
    const blocked: GameState = {
      ...mkEndgameState([t(0, 0)]),
      players: {
        [botId]: { id: botId, hand: [t(1, 4)], score: 0 },
        [humanId]: { id: humanId, hand: [t(2, 3)], score: 0 },
      },
      board: mkBoard(5, 6),
      boneyard: [],
      deadTiles: [t(6, 6), t(4, 5)],
    };
    const move = chooseBotMoveServer(blocked, botId, new Set(), 'standard');
    expect(move.type).toBe('pass');
  });

  it('endgame move does not depend on boneyard stack order', () => {
    let roll = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      roll = (roll + 0.137) % 1;
      return roll;
    });

    const yard: Tile[] = [t(0, 1), t(3, 4), t(5, 6), t(2, 2), t(1, 3)];
    const forward: GameState = {
      ...mkEndgameState([t(0, 0)]),
      boneyard: yard,
      players: {
        'bot-seat': { id: 'bot-seat', hand: [t(2, 5), t(4, 5), t(5, 5)], score: 0 },
        'human-seat': { id: 'human-seat', hand: [t(0, 0), t(1, 1)], score: 0 },
      },
    };
    const reversed: GameState = { ...forward, boneyard: [...yard].reverse() };

    const forwardMove = chooseBotMoveServer(forward, 'bot-seat', new Set(), 'elite');
    const reversedMove = chooseBotMoveServer(reversed, 'bot-seat', new Set(), 'elite');
    expect(moveKey(forwardMove)).toBe(moveKey(reversedMove));
  });

  it('never returns an illegal move across tournament tiers', () => {
    const botId = 'bot-seat';
    const scenarios: GameState[] = [
      mkEndgameState([t(6, 6)]),
      mkEndgameState([t(1, 3)]),
      {
        ...mkEndgameState([t(0, 0)]),
        board: mkBoard(5, 6),
        players: {
          [botId]: { id: botId, hand: [t(1, 4)], score: 0 },
          'human-seat': { id: 'human-seat', hand: [t(2, 3)], score: 0 },
        },
        boneyard: [],
        deadTiles: [t(6, 6), t(4, 5)],
      },
    ];

    for (const state of scenarios) {
      for (const tier of ['standard', 'elite', 'master'] as const) {
        const move = chooseBotMoveServer(state, botId, new Set(), tier);
        const legal = getLegalMoves(state, botId);
        if (move.type === 'pass') {
          expect(legal.every((m) => m.type !== 'play')).toBe(true);
          continue;
        }
        expect(
          legal.some(
            (m) =>
              m.type === 'play' &&
              m.tile &&
              move.tile &&
              m.tile.low === move.tile.low &&
              m.tile.high === move.tile.high,
          ),
        ).toBe(true);
      }
    }
  });

  it('returns play when legal moves exist (never pass while playable)', () => {
    const state = mkEndgameState([t(1, 3)]);
    const move = chooseBotMoveServer(state, 'bot-seat', new Set(), 'master');
    expect(move.type).toBe('play');
  });
});
