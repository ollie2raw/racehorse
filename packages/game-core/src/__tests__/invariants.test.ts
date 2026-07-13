import { describe, it, expect } from 'vitest';
import { createInitialState, startNewHand } from '../engine';
import {
  collectGameStateViolations,
  assertValidGameState,
  tilesOnBoard,
  boardTileCount,
  tileKey,
  isValidTile,
  assertUniquePhysicalTiles,
  collectPhysicalTilesFromBoard,
} from '../invariants';
import { GameState, BoardState, Tile, PlacedTile, DEFAULT_CONFIG } from '../types';

// ─── Helpers ───────────────────────────────────────────────────────────────

function t(low: number, high: number): Tile {
  return { low, high };
}

function pt(low: number, high: number): PlacedTile {
  const tile = t(low, high);
  return { tile, orientation: low === high ? 'vertical-normal' : 'horizontal-normal' };
}

/** Build a fresh, validly-dealt 2-player state. */
function freshState(): GameState {
  return startNewHand(createInitialState(['A', 'B']));
}

/**
 * Produce a minimal valid GameState with no hand dealt yet.
 * Useful for constructing custom tile layouts without fighting the engine.
 *
 * Tile accounting formula (the ONLY correct one):
 *   sum(hand sizes) + boneyard.length + boardTileCount(board)
 *   === totalTilesInSet(maxPips)   [28 for double-six]
 *
 * deadTiles are the protected tail of boneyard and must NOT be added again.
 */
function makeState(overrides: Partial<GameState>): GameState {
  const base = createInitialState(['A', 'B']);
  return { ...base, ...overrides } as GameState;
}

it('validates tile bounds and physical board enumeration', () => {
  expect(isValidTile({ low: 0, high: 6 })).toBe(true);
  expect(isValidTile({ low: -1, high: 6 })).toBe(false);
  expect(isValidTile({ low: 0.5, high: 6 })).toBe(false);
  const board: BoardState = {
    mainLine: [pt(2, 2), pt(2, 5)],
    leftEnd: 2,
    rightEnd: 5,
    leftEndIsDouble: false,
    rightEndIsDouble: false,
    hubDoubles: [{
      hubId: 0,
      tileIndex: 0,
      hubValue: 2,
      isCrossed: true,
      branches: [{
        tiles: [pt(2, 4)],
        openEnd: 4,
        openEndIsDouble: false,
      }, null],
    }],
  };
  expect(collectPhysicalTilesFromBoard(board)).toHaveLength(3);
  expect(() => assertUniquePhysicalTiles([{ low: 1, high: 2 }, { low: 2, high: 1 }])).toThrow(/duplicate/i);
});

// ─── Helper unit tests ─────────────────────────────────────────────────────

describe('tileKey', () => {
  it('returns canonical low|high form regardless of input order', () => {
    expect(tileKey({ low: 3, high: 6 })).toBe('3|6');
    expect(tileKey({ low: 6, high: 3 })).toBe('3|6');
    expect(tileKey({ low: 0, high: 0 })).toBe('0|0');
  });
});

describe('isValidTile', () => {
  it('accepts tiles within range', () => {
    expect(isValidTile(t(0, 6), 6)).toBe(true);
    expect(isValidTile(t(3, 3), 6)).toBe(true);
  });
  it('rejects pip above maxPips', () => {
    expect(isValidTile(t(0, 7), 6)).toBe(false);
  });
  it('rejects negative pip', () => {
    expect(isValidTile(t(-1, 3), 6)).toBe(false);
  });
});

describe('tilesOnBoard / boardTileCount', () => {
  it('returns empty for null board', () => {
    expect(tilesOnBoard(null)).toEqual([]);
    expect(boardTileCount(null)).toBe(0);
  });

  it('counts mainLine tiles only when no branches', () => {
    const board: BoardState = {
      mainLine: [pt(1, 2), pt(2, 5)],
      leftEnd: 1,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    };
    expect(boardTileCount(board)).toBe(2);
    expect(tilesOnBoard(board).length).toBe(2);
  });

  it('counts branch arm tiles separately from mainLine hub tile', () => {
    // Hub double [3|3] is in mainLine at index 1.
    // It has 1 branch arm with 1 tile — that branch tile is additional.
    const board: BoardState = {
      mainLine: [pt(0, 3), pt(3, 3), pt(3, 5)],
      leftEnd: 0,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [
        {
          tileIndex: 1,
          hubValue: 3,
          isCrossed: true,
          leftSideFilled: true,
          rightSideFilled: true,
          branches: [
            {
              tiles: [pt(3, 4)],
              openEnd: 4,
              openEndIsDouble: false,
            },
          ],
        },
      ],
    };
    // mainLine: 3 tiles + branch arm: 1 tile = 4 total
    expect(boardTileCount(board)).toBe(4);
    expect(tilesOnBoard(board).length).toBe(4);
  });

  it('counts tiles in two branch arms on the same hub', () => {
    const board: BoardState = {
      mainLine: [pt(0, 3), pt(3, 3), pt(3, 5)],
      leftEnd: 0,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [
        {
          tileIndex: 1,
          hubValue: 3,
          isCrossed: true,
          leftSideFilled: true,
          rightSideFilled: true,
          branches: [
            { tiles: [pt(3, 4)], openEnd: 4, openEndIsDouble: false },
            { tiles: [pt(3, 1)], openEnd: 1, openEndIsDouble: false },
          ],
        },
      ],
    };
    // mainLine: 3 + arm0: 1 + arm1: 1 = 5
    expect(boardTileCount(board)).toBe(5);
  });
});

// ─── collectGameStateViolations ────────────────────────────────────────────

describe('collectGameStateViolations', () => {

  // ── Valid states ──────────────────────────────────────────────────────────

  it('passes for a fresh dealt hand (canonical valid state)', () => {
    const state = freshState();
    // Confirm the correct accounting: hands + boneyard + board = 28
    // deadTiles are already inside boneyard — do NOT add again.
    const handTotal = state.players['A'].hand.length + state.players['B'].hand.length;
    expect(handTotal + state.boneyard.length + boardTileCount(state.board)).toBe(28);
    expect(collectGameStateViolations(state)).toEqual([]);
  });

  it('passes after multiple fresh deals (handNumber increments)', () => {
    let state = freshState();
    // Simulate hand over so we can call startNewHand again
    state = { ...state, handOver: true };
    state = startNewHand(state);
    expect(collectGameStateViolations(state)).toEqual([]);
  });

  it('passes for a valid gameOver state', () => {
    const state = freshState();
    const validGameOver: GameState = {
      ...state,
      handOver: true,
      gameOver: true,
      winnerId: 'A',
      players: {
        A: { ...state.players['A'], score: 60 },
        B: { ...state.players['B'], score: 30 },
      },
    };
    expect(collectGameStateViolations(validGameOver)).toEqual([]);
  });

  it('passes for a blocked-hand state (handOver, no winner, no gameOver)', () => {
    const state = freshState();
    const blocked: GameState = {
      ...state,
      handOver: true,
      gameOver: false,
      winnerId: null,
      consecutivePasses: 2,
    };
    expect(collectGameStateViolations(blocked)).toEqual([]);
  });

  // ── Duplicate tile ────────────────────────────────────────────────────────

  it('fails when a tile appears in two hands', () => {
    const state = freshState();
    // Inject duplicate: give A and B the same [0|1] tile, remove one from B to keep total consistent
    const dupTile = t(0, 1);
    const handA = [dupTile, ...state.players['A'].hand.slice(1)];
    const handB = [dupTile, ...state.players['B'].hand.slice(1)];
    // Remove one tile from boneyard to keep total=28
    const boneyard = state.boneyard.slice(1);
    const broken: GameState = {
      ...state,
      players: {
        A: { ...state.players['A'], hand: handA },
        B: { ...state.players['B'], hand: handB },
      },
      boneyard,
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('duplicate tile') && s.includes('0|1'))).toBe(true);
  });

  it('fails when a board tile duplicates a hand tile', () => {
    const state = freshState();
    // Take first tile from A's hand and put it on the board too (without removing it from hand)
    const stolen = state.players['A'].hand[0];
    const board: BoardState = {
      mainLine: [{ tile: stolen, orientation: 'horizontal-normal' }],
      leftEnd: stolen.low,
      rightEnd: stolen.high,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    };
    // Remove one tile from boneyard to keep total plausible but the dup should still fire
    const broken: GameState = {
      ...state,
      board,
      handOpen: true,
      boneyard: state.boneyard.slice(1),
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('duplicate tile'))).toBe(true);
  });

  // ── Wrong total tile count ────────────────────────────────────────────────

  it('fails when one tile is missing (total = 27)', () => {
    const state = freshState();
    // Remove a tile from boneyard
    const broken: GameState = {
      ...state,
      boneyard: state.boneyard.slice(1),
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('tile count mismatch'))).toBe(true);
  });

  it('fails when an extra tile is injected (total = 29)', () => {
    const state = freshState();
    // Add a tile to A's hand that doesn't change the hand array's real size correctly
    const extra = state.players['A'].hand[0]; // already exists — this creates a dup + count issue
    const broken: GameState = {
      ...state,
      players: {
        ...state.players,
        A: { ...state.players['A'], hand: [extra, ...state.players['A'].hand] },
      },
    };
    const v = collectGameStateViolations(broken);
    // Should report either a tile count mismatch or a duplicate
    expect(v.length).toBeGreaterThan(0);
  });

  // ── deadTiles are NOT double-counted ─────────────────────────────────────

  it('does not flag a valid state as a duplicate due to deadTiles being in boneyard', () => {
    // deadTiles are the protected tail of boneyard.
    // The checker must NOT add deadTiles to the tile pool again.
    const state = freshState();
    // Sanity: deadTiles are the last N elements of boneyard
    const { boneyard, deadTiles, config } = state;
    const boneyardTail = boneyard.slice(boneyard.length - config.deadTileCount);
    // They should overlap (same tile objects or same values)
    for (let i = 0; i < config.deadTileCount; i++) {
      expect(tileKey(boneyardTail[i])).toBe(tileKey(deadTiles[i]));
    }
    // And the state should still be valid — no false duplicate errors
    expect(collectGameStateViolations(state)).toEqual([]);
  });

  // ── Invalid pip values ────────────────────────────────────────────────────

  it('fails when a hand tile has pip > maxPips', () => {
    const state = freshState();
    const badHand = [t(0, 9), ...state.players['A'].hand.slice(1)];
    const broken: GameState = {
      ...state,
      players: { ...state.players, A: { ...state.players['A'], hand: badHand } },
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('invalid pips'))).toBe(true);
  });

  it('fails when a boneyard tile has a negative pip', () => {
    const state = freshState();
    const badBoneyard = [t(-1, 3), ...state.boneyard.slice(1)];
    const broken: GameState = { ...state, boneyard: badBoneyard };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('invalid pips'))).toBe(true);
  });

  // ── currentPlayerIndex out of bounds ─────────────────────────────────────

  it('fails when currentPlayerIndex is out of bounds', () => {
    const state = freshState();
    const broken: GameState = { ...state, currentPlayerIndex: 5 };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('currentPlayerIndex') && s.includes('out of bounds'))).toBe(true);
  });

  it('fails when currentPlayerIndex is negative', () => {
    const state = freshState();
    const broken: GameState = { ...state, currentPlayerIndex: -1 };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('currentPlayerIndex') && s.includes('out of bounds'))).toBe(true);
  });

  // ── Missing player state ──────────────────────────────────────────────────

  it('fails when a playerId has no player state', () => {
    const state = freshState();
    const { A: _removed, ...rest } = state.players as Record<string, unknown>;
    const broken: GameState = { ...state, players: rest as typeof state.players };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('player state missing') && s.includes('"A"'))).toBe(true);
  });

  // ── Negative score ────────────────────────────────────────────────────────

  it('fails when a player has a negative score', () => {
    const state = freshState();
    const broken: GameState = {
      ...state,
      players: { ...state.players, A: { ...state.players['A'], score: -5 } },
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('"A"') && s.includes('invalid score'))).toBe(true);
  });

  // ── gameOver without winnerId ─────────────────────────────────────────────

  it('fails when gameOver=true but winnerId=null', () => {
    const state = freshState();
    const broken: GameState = {
      ...state,
      handOver: true,
      gameOver: true,
      winnerId: null,
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('gameOver is true but winnerId is null'))).toBe(true);
  });

  // ── gameOver with winnerId not in playerIds ───────────────────────────────

  it('fails when gameOver=true and winnerId is not in playerIds', () => {
    const state = freshState();
    const broken: GameState = {
      ...state,
      handOver: true,
      gameOver: true,
      winnerId: 'X',
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('winnerId') && s.includes('"X"'))).toBe(true);
  });

  // ── gameOver without handOver ─────────────────────────────────────────────

  it('fails when gameOver=true but handOver=false', () => {
    const state = freshState();
    const broken: GameState = {
      ...state,
      handOver: false,
      gameOver: true,
      winnerId: 'A',
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('gameOver is true but handOver is false'))).toBe(true);
  });

  // ── boneyard shorter than deadTileCount ───────────────────────────────────

  it('fails when boneyard.length < deadTileCount', () => {
    const state = freshState();
    // Drain boneyard to just 1 tile (deadTileCount=2 → violation)
    const broken: GameState = {
      ...state,
      boneyard: state.boneyard.slice(0, 1),
    };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('below deadTileCount'))).toBe(true);
  });

  // ── branch tile counted correctly ─────────────────────────────────────────

  it('counts branch tiles in total and does not report mismatch for a valid board with branches', () => {
    // Build a 28-tile state manually: 5 tiles on board (3 mainLine + 2 branch arm tiles),
    // 7 in A's hand, 7 in B's hand, and 9 in boneyard = 5+7+7+9 = 28.
    const base = createInitialState(['A', 'B']);

    // Generate 28 unique tiles for a double-6 set
    const allTiles: Tile[] = [];
    for (let hi = 0; hi <= 6; hi++) {
      for (let lo = 0; lo <= hi; lo++) {
        allTiles.push(t(lo, hi));
      }
    }

    const boardTiles = allTiles.slice(0, 5);  // [0|0],[0|1],[0|2],[0|3],[0|4]
    const handA = allTiles.slice(5, 12);       // 7 tiles
    const handB = allTiles.slice(12, 19);      // 7 tiles
    const boneyard = allTiles.slice(19);       // 9 tiles

    const board: BoardState = {
      mainLine: [
        { tile: boardTiles[0], orientation: 'vertical-normal' },
        { tile: boardTiles[1], orientation: 'horizontal-normal' },
        { tile: boardTiles[2], orientation: 'horizontal-normal' },
      ],
      leftEnd: boardTiles[0].low,
      rightEnd: boardTiles[2].high,
      leftEndIsDouble: true,
      rightEndIsDouble: false,
      hubDoubles: [
        {
          tileIndex: 0,
          hubValue: 0,
          isCrossed: true,
          leftSideFilled: true,
          rightSideFilled: true,
          branches: [
            {
              tiles: [
                { tile: boardTiles[3], orientation: 'vertical-normal' },
                { tile: boardTiles[4], orientation: 'horizontal-normal' },
              ],
              openEnd: boardTiles[4].high,
              openEndIsDouble: false,
            },
          ],
        },
      ],
    };

    const state: GameState = {
      ...base,
      handNumber: 1,
      board,
      handOpen: true,
      players: {
        A: { id: 'A', hand: handA, score: 0 },
        B: { id: 'B', hand: handB, score: 0 },
      },
      boneyard,
      deadTiles: boneyard.slice(boneyard.length - 2), // last 2 of boneyard
    };

    expect(boardTileCount(state.board)).toBe(5);
    expect(collectGameStateViolations(state)).toEqual([]);
  });

  // ── sequence ──────────────────────────────────────────────────────────────

  it('fails when sequence is negative', () => {
    const state = freshState();
    const broken: GameState = { ...state, sequence: -1 };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('sequence'))).toBe(true);
  });

  it('fails when sequence is not finite', () => {
    const state = freshState();
    const broken: GameState = { ...state, sequence: Infinity };
    const v = collectGameStateViolations(broken);
    expect(v.some((s) => s.includes('sequence'))).toBe(true);
  });
});

// ─── assertValidGameState ──────────────────────────────────────────────────

describe('assertValidGameState', () => {
  it('does not throw for a valid state', () => {
    const state = freshState();
    expect(() => assertValidGameState(state, 'test')).not.toThrow();
  });

  it('throws in non-production with a message containing all violations and context', () => {
    // NODE_ENV is 'test' in vitest — not 'production', so it should throw.
    const state = freshState();
    const broken: GameState = {
      ...state,
      sequence: -1,
      gameOver: true,        // gameOver=true but…
      handOver: false,       //   handOver=false  (INV-18)
      winnerId: null,        //   and winnerId=null (INV-14)
    };
    expect(() => assertValidGameState(broken, 'myContext')).toThrowError(/myContext/);
    expect(() => assertValidGameState(broken, 'myContext')).toThrowError(/violation/);
  });
});
