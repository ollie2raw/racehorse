import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardState, GameState, Tile } from '../game/types';
import { DEFAULT_CONFIG } from '../game/types';
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
});
