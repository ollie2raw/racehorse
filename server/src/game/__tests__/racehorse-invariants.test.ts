import { describe, it, expect } from 'vitest';
import {
  getLegalMoves,
  applyMove,
  canDraw,
  drawOne,
  drawUntilPlayableOrEmpty,
} from '../engine';
import { computePlayScore, simulatePlacement } from '../scoring';
import {
  Tile,
  PlacedTile,
  GameState,
  BoardState,
  DEFAULT_CONFIG,
  isDouble,
} from '../types';

function t(a: number, b: number): Tile {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

function pt(a: number, b: number): PlacedTile {
  const tile = t(a, b);
  return {
    tile,
    orientation: isDouble(tile) ? 'vertical-normal' : 'horizontal-normal',
  };
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
    config: DEFAULT_CONFIG,
    ...overrides,
  } as GameState;
}

describe('Racehorse draw/pass invariants (authoritative engine)', () => {
  it('rejects drawOne while a legal play exists', () => {
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
        A: { id: 'A', hand: [t(3, 4)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [t(6, 6), t(0, 2), t(1, 1)],
      deadTiles: [t(9, 9), t(8, 8)],
    });

    expect(canDraw(state, 'A')).toBe(false);
    expect(() => drawOne(state, 'A')).toThrow(/Cannot draw while a legal play is available/i);
  });

  it('rejects PASS while a legal play exists', () => {
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
        A: { id: 'A', hand: [t(3, 4)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    expect(() => applyMove(state, 'A', { type: 'pass' })).toThrow(/Cannot pass when you have a legal play/i);
  });

  it('rejects PASS while drawable boneyard tiles remain', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{ tileIndex: 0, hubValue: 6, isCrossed: false, branches: [] }],
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
    expect(() => applyMove(state, 'A', { type: 'pass' })).toThrow(/Cannot pass while there are drawable tiles/i);
  });

  it('forced draw is available only when blocked with drawable tiles', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{ tileIndex: 0, hubValue: 6, isCrossed: false, branches: [] }],
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

  it('drawUntilPlayableOrEmpty resolves a multi-tile chain in one call', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{ tileIndex: 0, hubValue: 6, isCrossed: false, branches: [] }],
      },
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(0, 2), t(6, 4), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { state: next, drew } = drawUntilPlayableOrEmpty(state, 'A');
    expect(drew).toBe(2);
    expect(getLegalMoves(next, 'A').some((m) => m.type === 'play')).toBe(true);
    expect(canDraw(next, 'A')).toBe(false);
  });

  it('drawUntilPlayableOrEmpty stops as soon as a playable tile is drawn', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{ tileIndex: 0, hubValue: 6, isCrossed: false, branches: [] }],
      },
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      // First draw is useless; second tile [6|4] becomes playable on the 6 end.
      boneyard: [t(0, 2), t(6, 4), t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const { state: next, drew } = drawUntilPlayableOrEmpty(state, 'A');
    expect(drew).toBe(2);
    expect(getLegalMoves(next, 'A').some((m) => m.type === 'play')).toBe(true);
    expect(next.boneyard.length).toBe(2); // dead tail only
  });

  it('pass is legal only when blocked and drawable boneyard count is zero', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{ tileIndex: 0, hubValue: 6, isCrossed: false, branches: [] }],
      },
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    const moves = getLegalMoves(state, 'A');
    expect(moves.every((m) => m.type === 'pass')).toBe(true);
    expect(canDraw(state, 'A')).toBe(false);
  });

  it('boneyard locked means final deadTileCount tiles are not drawable', () => {
    const state = setupState({
      board: null,
      handOpen: false,
      players: {
        A: { id: 'A', hand: [t(1, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [t(9, 9), t(8, 8)],
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    });

    expect(canDraw(state, 'A')).toBe(false);
    const { drew } = drawUntilPlayableOrEmpty(state, 'A');
    expect(drew).toBe(0);
  });
});

describe('Racehorse opening and continuation invariants', () => {
  it('opening draw chain continues until a scoring or double opener is drawable', () => {
    const state = setupState({
      board: null,
      handOpen: false,
      players: {
        A: { id: 'A', hand: [t(1, 2), t(3, 4)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [t(0, 1), t(2, 3), t(5, 5)],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    expect(getLegalMoves(state, 'A').some((m) => m.type === 'play')).toBe(false);
    expect(canDraw(state, 'A')).toBe(true);

    const { state: next, drew } = drawUntilPlayableOrEmpty(state, 'A');
    expect(drew).toBeGreaterThan(0);
    const openers = getLegalMoves(next, 'A').filter((m) => m.type === 'play');
    expect(openers.length).toBeGreaterThan(0);
    for (const move of openers) {
      if (move.type !== 'play') continue;
      const sim = simulatePlacement(null, move.tile, 'left');
      const validOpener = isDouble(move.tile) || computePlayScore(sim, next.config) > 0;
      expect(validOpener).toBe(true);
    }
  });

  it('scoring play keeps the turn and forced-draws when no follow-up play exists', () => {
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
        A: { id: 'A', hand: [t(1, 6)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [t(2, 2)],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });

    expect(forcedDraw).not.toBeNull();
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.handOver).toBe(false);
    expect(next.players.A.hand.length).toBe(1);
  });

  it('double play keeps the turn when another tile remains in hand', () => {
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
        A: { id: 'A', hand: [t(5, 5), t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(5, 5),
      position: 'right',
    });

    expect(next.currentPlayerIndex).toBe(0);
    expect(next.players.A.hand.length).toBe(1);
  });

  it('continuation with no playable tile and drawable boneyard seeds forced draw after last-tile score', () => {
    const state = setupState({
      board: {
        mainLine: [pt(8, 3), pt(3, 2)],
        leftEnd: 8,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(3, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [t(5, 5)],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const { state: afterLastScore, forcedDraw: lastForced } = applyMove(state, 'A', {
      type: 'play',
      tile: t(3, 2),
      position: 'left',
    });

    expect(lastForced).not.toBeNull();
    expect(afterLastScore.handOver).toBe(false);
    expect(afterLastScore.currentPlayerIndex).toBe(0);
  });
});

describe('Racehorse last-tile scoring/double legality (regression)', () => {
  function lastTile32State(boneyard: Tile[]) {
    return setupState({
      board: {
        mainLine: [pt(8, 3), pt(3, 2)],
        leftEnd: 8,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      players: {
        A: { id: 'A', hand: [t(3, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard,
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });
  }

  it('includes scoring and non-scoring last-tile placements in getLegalMoves', () => {
    const state = lastTile32State([t(5, 5)]);
    const positions = getLegalMoves(state, 'A')
      .filter((m) => m.type === 'play')
      .map((m) => (m.type === 'play' ? m.position : ''));
    expect(positions).toContain('left');
    expect(positions).toContain('right');
  });

  it('last-tile scoring with drawable boneyard applies forced draw', () => {
    const { forcedDraw, state: next } = applyMove(lastTile32State([t(5, 5)]), 'A', {
      type: 'play',
      tile: t(3, 2),
      position: 'left',
    });
    expect(forcedDraw).not.toBeNull();
    expect(next.handOver).toBe(false);
    expect(next.players.A.hand.length).toBe(1);
  });

  it('last-tile scoring with locked boneyard ends the hand', () => {
    const locked = {
      ...lastTile32State([t(9, 9), t(8, 8)]),
      deadTiles: [t(9, 9), t(8, 8)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
    };
    const { forcedDraw, state: next } = applyMove(locked, 'A', {
      type: 'play',
      tile: t(3, 2),
      position: 'left',
    });
    expect(forcedDraw).toBeNull();
    expect(next.handOver).toBe(true);
  });
});
