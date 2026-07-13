/**
 * Golden-scenario conformance tests for server/src/game/engine.ts.
 * Mirror scenarios live in client/src/bot/engineParity.behaviorTests.ts.
 * Intentional differences (tournament race-to-30, blockedHandRule config) are documented in docs/fritz-trust-guardrails.md.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  canDraw,
  drawOne,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
} from '../engine';
import { computePlayScore, simulatePlacement } from '../scoring';
import {
  DEFAULT_CONFIG,
  type BoardState,
  type GameState,
  type PlacedTile,
  type Tile,
} from '../types';

function t(a: number, b: number): Tile {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function pt(a: number, b: number): PlacedTile {
  return { tile: t(a, b), orientation: 'horizontal-normal' };
}

function setupState(overrides: Partial<GameState> & { board?: BoardState | null }): GameState {
  return {
    playerIds: ['A', 'B'],
    players: {
      A: { id: 'A', hand: [], score: 0 },
      B: { id: 'B', hand: [], score: 0 },
    },
    board: null,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: overrides.board != null,
    handOver: false,
    gameOver: false,
    consecutivePasses: 0,
    sequence: 0,
    turnIndex: 0,
    config: DEFAULT_CONFIG,
    winnerId: null,
    ...overrides,
  } as GameState;
}

function moveKeys(moves: ReturnType<typeof getLegalMoves>): string[] {
  return moves.map((m) => {
    if (m.type === 'pass') return 'pass';
    return `${m.tile!.low}-${m.tile!.high}@${m.position ?? 'open'}`;
  });
}

describe('engine parity golden scenarios (server authoritative)', () => {
  it('parity-legal-moves: open hand lists matching placements only', () => {
    const state = setupState({
      board: {
        mainLine: [pt(3, 5)],
        leftEnd: 3,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(3, 4), t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 2)], score: 0 },
      },
      boneyard: [t(6, 6)],
      deadTiles: [],
    });

    const keys = moveKeys(getLegalMoves(state, 'A'));
    expect(keys).toContain('3-4@left');
    expect(keys).not.toContain('0-1@left');
    expect(keys).not.toContain('0-1@right');
    expect(keys).not.toContain('pass');
  });

  it('parity-forced-draw: blocked player can draw, not pass', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(4, 5), t(1, 2), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    expect(canDraw(state, 'A')).toBe(true);
    expect(getLegalMoves(state, 'A').some((m) => m.type === 'pass')).toBe(false);
  });

  it('parity-boneyard-lock: last two tiles are dead and not drawable', () => {
    const state = setupState({
      board: {
        mainLine: [pt(5, 6)],
        leftEnd: 5,
        rightEnd: 6,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(1, 4)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    expect(canDraw(state, 'A')).toBe(false);
    expect(getLegalMoves(state, 'A')).toEqual([{ type: 'pass' }]);
  });

  it('parity-pass: legal only when blocked and boneyard locked', () => {
    const blocked = setupState({
      board: {
        mainLine: [pt(5, 6)],
        leftEnd: 5,
        rightEnd: 6,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(1, 4)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { state: afterPass } = applyMove(blocked, 'A', { type: 'pass' });
    expect(afterPass.currentPlayerIndex).toBe(1);
    expect(afterPass.consecutivePasses).toBe(1);
    expect(afterPass.handOver).toBe(false);
  });

  it('parity-blocked-hand: lowest pips wins bonus', () => {
    const blocked = setupState({
      board: {
        mainLine: [pt(5, 6)],
        leftEnd: 5,
        rightEnd: 6,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(1, 4)], score: 10 },
        B: { id: 'B', hand: [t(0, 1)], score: 12 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      consecutivePasses: 1,
      currentPlayerIndex: 1,
      config: { ...DEFAULT_CONFIG, deadTileCount: 2, blockedHandRule: 'lowestPips' },
    });

    const { state: resolved } = applyMove(blocked, 'B', { type: 'pass' });
    expect(resolved.handOver).toBe(true);
    expect(resolved.players.B.score).toBe(13);
    expect(resolved.players.A.score).toBe(10);
  });

  it('parity-blocked-tie: equal pips yields no hand winner', () => {
    const blocked = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(1, 2)], score: 10 },
        B: { id: 'B', hand: [t(0, 3)], score: 12 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      consecutivePasses: 1,
      currentPlayerIndex: 1,
      config: { ...DEFAULT_CONFIG, deadTileCount: 2, blockedHandRule: 'lowestPips' },
    });

    const { state: resolved } = applyMove(blocked, 'B', { type: 'pass' });
    expect(resolved.handOver).toBe(true);
    expect(resolved.players.A.score).toBe(10);
    expect(resolved.players.B.score).toBe(12);
  });

  it('parity-multiples-of-five: open ends sum 10 awards 2 points', () => {
    const board = simulatePlacement(null, t(4, 6), 'left');
    const scored = computePlayScore(board!, DEFAULT_CONFIG);
    expect(scored).toBe(2);
  });

  it('parity-end-of-hand-pips: go-out bonus rounds opponent pips / 5', () => {
    const state = setupState({
      board: {
        mainLine: [pt(3, 5)],
        leftEnd: 3,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(3, 4)], score: 20 },
        B: { id: 'B', hand: [t(1, 2), t(0, 0)], score: 18 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { state: after } = applyMove(state, 'A', { type: 'play', tile: t(3, 4), position: 'left' });
    expect(after.handOver).toBe(true);
    expect(after.players.A.score).toBe(21);
  });

  it('parity-61-61: tied leaders at target continue without game winner', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(2, 2)], score: 61 },
        B: { id: 'B', hand: [t(3, 3)], score: 61 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2, blockedHandRule: 'noScore' },
    });

    let next = applyMove(state, 'A', { type: 'pass' }).state;
    next = applyMove(next, 'B', { type: 'pass' }).state;
    expect(next.players.A.score).toBe(61);
    expect(next.players.B.score).toBe(61);
    expect(next.handOver).toBe(true);
    expect(next.gameOver).toBe(false);
    expect(next.winnerId).toBeNull();
  });

  it('parity-winner-detection: strict leader above target wins', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(1, 6), t(0, 0)], score: 58 },
        B: { id: 'B', hand: [t(4, 5)], score: 65 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { state: afterA } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });
    expect(afterA.players.A.score).toBe(60);
    expect(afterA.handOver).toBe(false);

    const { state: afterB } = applyMove({ ...afterA, currentPlayerIndex: 1 }, 'B', {
      type: 'play',
      tile: t(4, 5),
      position: 'right',
    });
    expect(afterB.handOver).toBe(true);
    expect(afterB.gameOver).toBe(true);
    expect(afterB.winnerId).toBe('B');
  });

  it('parity-fifo-draw: drawOne takes the front of the boneyard', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(4, 5), t(1, 2), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { drew, state: after } = drawOne(state, 'A');
    expect(drew).toEqual(t(4, 5));
    expect(after.boneyard[0]).toEqual(t(1, 2));
    expect(after.players.A.hand).toContainEqual(t(4, 5));
  });

  it('parity-draw-until-playable: FIFO chain stops on first playable tile', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(4, 5), t(6, 6), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { state: after } = drawUntilPlayableOrEmpty(state, 'A');
    expect(after.players.A.hand.some((tile) => tile.low === 6 && tile.high === 6)).toBe(true);
    expect(after.boneyard.length).toBe(2);
  });
});
