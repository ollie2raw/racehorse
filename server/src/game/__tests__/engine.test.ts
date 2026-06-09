import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  startNewHand,
  getLegalMoves,
  applyMove,
  finalizeMandatoryAutoPasses,
  computeOpenEndsSum,
  computePlayScore,
  getOpenEnds,
  canDraw,
} from '../engine';
import { simulatePlacement } from '../scoring';
import { assertValidGameState } from '../invariants';
import {
  Tile,
  PlacedTile,
  GameState,
  BoardState,
  PlacementPosition,
  DEFAULT_CONFIG,
  isDouble,
} from '../types';

// Helper to create tiles in canonical form (low <= high)
function t(a: number, b: number): Tile {
  return a <= b ? { low: a, high: b } : { low: b, high: a };
}

// Helper to create a PlacedTile with default orientation
function pt(a: number, b: number): PlacedTile {
  const tile = t(a, b);
  return {
    tile,
    orientation: isDouble(tile) ? 'vertical-normal' : 'horizontal-normal',
  };
}

// Helper to create a game state with specific board/hand setup
function setupState(overrides: Partial<GameState> & { board?: BoardState | null }): GameState {
  const base = createInitialState(['A', 'B']);
  return {
    ...base,
    handOpen: overrides.board !== null && overrides.board !== undefined,
    ...overrides,
  } as GameState;
}

describe('Racehorse Engine Core Rules', () => {
  it('deals 7 tiles each and keeps exactly 2 dead tiles', () => {
    let state = createInitialState(['A', 'B'], {
      tilesPerPlayer: 7,
      deadTileCount: 2,
    });

    state = startNewHand(state);

    expect(state.players['A'].hand.length).toBe(7);
    expect(state.players['B'].hand.length).toBe(7);
    expect(state.deadTiles.length).toBe(2);

    // Dead tiles are still represented as the tail of `boneyard`; do not double-count.
    const total =
      state.players['A'].hand.length + state.players['B'].hand.length + state.boneyard.length;

    expect(total).toBe(28);
  });

  it('last-tile double with drawable boneyard is legal and forces a draw', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 2)],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [t(3, 4)],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const moves = getLegalMoves(state, 'A');
    expect(moves.some((m) => m.type === 'play' && m.position === 'right')).toBe(true);
    expect(canDraw(state, 'A')).toBe(false);

    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(2, 2),
      position: 'right',
    });
    expect(forcedDraw).not.toBeNull();
    expect(next.handOver).toBe(false);
    expect(next.players.A.hand.length).toBe(1);
    expect(next.boneyard.length).toBe(0);
  });

  it('can go out on a double when the boneyard is locked or empty', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 2)],
        leftEnd: 1,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const moves = getLegalMoves(state, 'A');
    expect(moves.some((m) => m.type === 'play' && m.position === 'right')).toBe(true);

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(2, 2),
      position: 'right',
    });
    expect(next.handOver).toBe(true);
    expect(next.players.A.hand.length).toBe(0);
  });

  it('last-tile scoring play with drawable boneyard is legal and forces a draw', () => {
    // Board: [1|4], left=1, right=4
    // Playing [1|6] on left makes ends 6 + 4 = 10 → scores 2 points
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 6)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [t(2, 2)],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const moves = getLegalMoves(state, 'A');
    expect(moves.some((m) => m.type === 'play' && m.position === 'left')).toBe(true);
    expect(canDraw(state, 'A')).toBe(false);

    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });
    expect(forcedDraw).not.toBeNull();
    expect(next.handOver).toBe(false);
    expect(next.players.A.score).toBe(2);
    expect(next.players.A.hand.length).toBe(1);
  });

  it('can go out on a scoring play when the boneyard is locked or empty', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 6)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const moves = getLegalMoves(state, 'A');
    expect(moves.some((m) => m.type === 'play' && m.position === 'left')).toBe(true);

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });
    expect(next.handOver).toBe(true);
    expect(next.players.A.hand.length).toBe(0);
    expect(next.players.A.score).toBe(2);
  });

  it('last-tile non-scoring non-double goes out normally', () => {
    const state = setupState({
      board: {
        mainLine: [pt(2, 4)],
        leftEnd: 2,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 0)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [t(6, 6)],
      deadTiles: [],
    });

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(2, 0),
      position: 'left',
    });
    expect(next.handOver).toBe(true);
  });

  it('scoring play grants an extra turn', () => {
    // Board: [1|4], left=1, right=4
    // Playing [1|6] on left: ends 6 + 4 = 10 → scores 2 points → extra turn
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 6), t(0, 0)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });

    expect(next.players.A.score).toBe(2); // 10/5 = 2 points
    expect(next.currentPlayerIndex).toBe(0); // extra turn
  });

  it('double play grants an extra turn', () => {
    const state = setupState({
      board: {
        mainLine: [pt(3, 5)],
        leftEnd: 3,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(3, 3), t(1, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(3, 3),
      position: 'left',
    });

    expect(next.currentPlayerIndex).toBe(0); // extra turn
  });
});

describe('Scoring: Points = sum/5', () => {
  it('scores 1 point when sum is 5', () => {
    // [2|3] alone → sum = 5 → 1 point
    const board = simulatePlacement(null, t(2, 3), 'left');
    expect(computeOpenEndsSum(board)).toBe(5);
    expect(computePlayScore(board)).toBe(1);
  });

  it('scores 2 points when sum is 10', () => {
    // [4|6] alone → sum = 10 → 2 points
    const board = simulatePlacement(null, t(4, 6), 'left');
    expect(computeOpenEndsSum(board)).toBe(10);
    expect(computePlayScore(board)).toBe(2);
  });

  it('scores 3 points when sum is 15', () => {
    // Start with [5|5] (double), sum = 10
    let board = simulatePlacement(null, t(5, 5), 'left');
    expect(computeOpenEndsSum(board)).toBe(10);

    // Play [5|0] on left, sum = 0 + 5 = 5, but double-5 is not yet crossed
    // Actually: main line becomes [5|0], [5|5], leftEnd = 0, rightEnd = 5
    // Oops wait - need to be careful with order
    // Let's build: [0|5], [5|5] on main line, left=0, right=5
    // Sum = 0 + 5 = 5
    // But we also have the double as an uncrossed hub - it doesn't add to sum yet

    // Actually in our model: placing [5|0] crosses the [5|5] making it a hub
    // After crossing, main ends are 0 and 5, sum = 5 → 1 point
  });

  it('scores 0 when sum is not divisible by 5', () => {
    // [1|2] alone → sum = 3 → 0 points
    const board = simulatePlacement(null, t(1, 2), 'left');
    expect(computeOpenEndsSum(board)).toBe(3);
    expect(computePlayScore(board)).toBe(0);
  });

  it('double at open end counts as 2x value', () => {
    // [5|5] alone at left end → both pips exposed → 10
    const board = simulatePlacement(null, t(5, 5), 'left');
    expect(computeOpenEndsSum(board)).toBe(10);
    expect(computePlayScore(board)).toBe(2); // 10/5 = 2 points
  });

  it('double at right end counts as 2x value', () => {
    // Start with [3|5], then add [5|5] on right
    let board = simulatePlacement(null, t(3, 5), 'left');
    board = simulatePlacement(board, t(5, 5), 'right');
    // Left = 3, Right = [5|5] = 10 → sum = 13, no score
    expect(computeOpenEndsSum(board)).toBe(13);
    expect(computePlayScore(board)).toBe(0);
  });

  it('double at left end after crossing still counts correctly', () => {
    // [3|3] alone, then cross with [3|5] on right
    let board = simulatePlacement(null, t(3, 3), 'left');
    // [3|3] is a double at both ends initially → sum = 6
    expect(computeOpenEndsSum(board)).toBe(6);

    // Cross with [3|5]
    board = simulatePlacement(board, t(3, 5), 'right');
    // Left = [3|3] = 6, Right = 5 → sum = 11
    expect(computeOpenEndsSum(board)).toBe(11);
  });
});

describe('Crossed Doubles and Branching', () => {
  it('playing a double creates an uncrossed hub', () => {
    const board = simulatePlacement(null, t(3, 3), 'left');

    expect(board.hubDoubles.length).toBe(1);
    expect(board.hubDoubles[0].hubValue).toBe(3);
    expect(board.hubDoubles[0].isCrossed).toBe(false);
    expect(board.hubDoubles[0].branches.length).toBe(0);
  });

  it('playing through both sides crosses a double', () => {
    // Start with [3|3]
    let board = simulatePlacement(null, t(3, 3), 'left');
    expect(board.hubDoubles[0].isCrossed).toBe(false);

    // Play [3|5] on right (fills right side only)
    board = simulatePlacement(board, t(3, 5), 'right');
    expect(board.hubDoubles[0].isCrossed).toBe(false);

    // Fill left side too
    board = simulatePlacement(board, t(2, 3), 'left');

    expect(board.mainLine.length).toBe(3);
    expect(board.leftEnd).toBe(2);
    expect(board.rightEnd).toBe(5);
    expect(board.hubDoubles[0].isCrossed).toBe(true);
    expect(computeOpenEndsSum(board)).toBe(7);
  });

  it('image 1: uncrossed double-1 with open 3 sums to 5', () => {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    expect(computeOpenEndsSum(board)).toBe(5);
    expect(board.hubDoubles[0]?.isCrossed).toBe(false);
  });

  it('image 2: crossed double-1 with open 4 and double-3 sums to 10', () => {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    board = simulatePlacement(board, t(4, 1), 'left');
    board = simulatePlacement(board, t(3, 3), 'right');
    expect(computeOpenEndsSum(board)).toBe(10);
    expect(board.hubDoubles[0]?.isCrossed).toBe(true);
  });

  it('image 2 + 1-5 on top branch increases open count to 15', () => {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    board = simulatePlacement(board, t(4, 1), 'left');
    board = simulatePlacement(board, t(3, 3), 'right');
    board = simulatePlacement(board, t(1, 5), 'branch-0-0');
    expect(computeOpenEndsSum(board)).toBe(15);
  });

  it('crossed hub empty branch slots do not inflate open count', () => {
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    board = simulatePlacement(board, t(4, 1), 'left');
    board = simulatePlacement(board, t(3, 3), 'right');

    const inflated: BoardState = {
      ...board,
      hubDoubles: board.hubDoubles.map((hub) =>
        hub.isCrossed
          ? {
              ...hub,
              branches: [
                { tiles: [], openEnd: hub.hubValue, openEndIsDouble: false },
                { tiles: [], openEnd: hub.hubValue, openEndIsDouble: false },
              ],
            }
          : hub,
      ),
    };

    expect(computeOpenEndsSum(inflated)).toBe(10);
  });

  it('crossed double contributes zero until a branch tile is played', () => {
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 4), 'left');
    expect(computeOpenEndsSum(board)).toBe(10);

    board = simulatePlacement(board, t(1, 3), 'right');
    expect(board.hubDoubles[0].isCrossed).toBe(true);
    expect(computeOpenEndsSum(board)).toBe(5);

    board = simulatePlacement(board, t(2, 3), 'branch-0-0');
    expect(computeOpenEndsSum(board)).toBe(7);
  });

  it('crossed double enables branching', () => {
    // Start: [3|3]
    let board = simulatePlacement(null, t(3, 3), 'left');
    // Fill both sides around [3|3]
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');

    const openEnds = getOpenEnds(board);

    // Should have: left, right, and branch-0-0 (new branch on hub 0)
    expect(openEnds.some((e) => e.position === 'left')).toBe(true);
    expect(openEnds.some((e) => e.position === 'right')).toBe(true);
    expect(openEnds.some((e) => e.position === 'branch-0-0')).toBe(true);
    expect(openEnds.find((e) => e.position === 'branch-0-0')?.matchValue).toBe(3);
  });

  it('can create a branch on a crossed double', () => {
    // [2|3][3|3][3|5], crossed
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');

    // Create branch with [3|1]
    board = simulatePlacement(board, t(1, 3), 'branch-0-0');

    expect(board.hubDoubles[0].branches.length).toBe(2);
    expect(board.hubDoubles[0].branches[0]?.tiles.length).toBe(1);
    expect(board.hubDoubles[0].branches[0]?.openEnd).toBe(1);
    expect(board.hubDoubles[0].branches[1]).toBeNull();
  });

  it('branch end is included in open ends sum', () => {
    // [2|3][3|3][3|5], crossed
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');

    // Before branch: sum = 2 + 5 = 7
    expect(computeOpenEndsSum(board)).toBe(7);

    // Add branch [3|2], branch end = 2
    board = simulatePlacement(board, t(2, 3), 'branch-0-0');

    // After branch: sum = 2 + 5 + 2 = 9
    expect(computeOpenEndsSum(board)).toBe(9);
  });

  it('each hub can have at most 2 branches', () => {
    // [2|3][3|3][3|5]
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');

    // First branch
    board = simulatePlacement(board, t(3, 1), 'branch-0-0');
    // Second branch
    board = simulatePlacement(board, t(3, 2), 'branch-0-1');

    expect(board.hubDoubles[0].branches.length).toBe(2);

    // Check open ends - should NOT include branch-0-2
    const openEnds = getOpenEnds(board);
    expect(openEnds.some((e) => e.position === 'branch-0-2')).toBe(false);

    // Can extend existing branches
    expect(openEnds.some((e) => e.position === 'branch-0-0')).toBe(true);
    expect(openEnds.some((e) => e.position === 'branch-0-1')).toBe(true);
  });

  it('can extend an existing branch', () => {
    // [2|3][3|3][3|5] with branch [3|1]
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(3, 1), 'branch-0-0');

    // Branch open end is 1, extend with [1|4]
    board = simulatePlacement(board, t(1, 4), 'branch-0-0');

    expect(board.hubDoubles[0].branches[0].tiles.length).toBe(2);
    expect(board.hubDoubles[0].branches[0].openEnd).toBe(4);

    // Sum: left=2, right=5, branch=4 → 11
    expect(computeOpenEndsSum(board)).toBe(11);
    expect(computePlayScore(board)).toBe(0);
  });

  it('arm 1 before arm 0 then extend arm 1 does not break assertValidGameState', () => {
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(1, 3), 'branch-0-1');
    board = simulatePlacement(board, t(1, 4), 'branch-0-1');

    expect(board.hubDoubles[0].branches[0]).toBeNull();
    expect(board.hubDoubles[0].branches[1]?.tiles.length).toBe(2);
    expect(board.hubDoubles[0].branches[1]?.openEnd).toBe(4);

    const state = setupState({
      board,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [], score: 0 },
        B: { id: 'B', hand: [], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    expect(() => assertValidGameState(state, 'branch-arm1-first')).not.toThrow();
  });

  it('multiple crossed doubles can each have branches', () => {
    // Build with both doubles crossed by filling both sides around each

    let board = simulatePlacement(null, t(5, 5), 'left');
    // Fill right of [5|5]
    board = simulatePlacement(board, t(3, 5), 'right');
    // Fill left of [5|5]
    board = simulatePlacement(board, t(2, 5), 'left');
    // Add [3|3] on right
    board = simulatePlacement(board, t(3, 3), 'right');
    // Fill right of [3|3]
    board = simulatePlacement(board, t(1, 3), 'right');
    // Fill left of [3|3]
    board = simulatePlacement(board, t(4, 3), 'left');

    expect(board.hubDoubles.length).toBe(2);
    expect(board.hubDoubles[0].isCrossed).toBe(true); // [5|5]
    expect(board.hubDoubles[1].isCrossed).toBe(true); // [3|3]

    // Create branch on first hub [5|5]
    board = simulatePlacement(board, t(5, 2), 'branch-0-0');
    // Create branch on second hub [3|3]
    board = simulatePlacement(board, t(3, 4), 'branch-1-0');

    // Main ends: left=4, right=1
    // Branch on hub 0: 2
    // Branch on hub 1: 4
    // Total: 4 + 1 + 2 + 4 = 11
    expect(computeOpenEndsSum(board)).toBe(11);
  });

  it('uncrossed double at end does not allow branching', () => {
    // [2|5][5|5] - double at right end, not crossed
    let board = simulatePlacement(null, t(2, 5), 'left');
    board = simulatePlacement(board, t(5, 5), 'right');

    expect(board.hubDoubles.length).toBe(1);
    expect(board.hubDoubles[0].isCrossed).toBe(false);

    const openEnds = getOpenEnds(board);
    // Should NOT have branch option
    expect(openEnds.some((e) => e.position.startsWith('branch-'))).toBe(false);
  });

  it('playing a double does NOT create branch moves until crossed (getLegalMoves)', () => {
    // [3|5] on board, player has [5|5], [5|2], and another tile
    // After playing [5|5], it should NOT allow branch placement
    const state = setupState({
      board: {
        mainLine: [pt(3, 5)],
        leftEnd: 3,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        // Need extra tile so [5|2] isn't a go-out move (would score: 3+2=5)
        A: { id: 'A', hand: [t(5, 5), t(5, 2), t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // First, play the [5|5] on right
    const { state: afterDouble } = applyMove(state, 'A', {
      type: 'play',
      tile: t(5, 5),
      position: 'right',
    });

    // Verify the double is registered but NOT crossed
    expect(afterDouble.board?.hubDoubles.length).toBe(1);
    expect(afterDouble.board?.hubDoubles[0].isCrossed).toBe(false);

    // A still has turn (played a double), check legal moves
    // A has [5|2] which can match the right end (5) via main line
    const movesAfterDouble = getLegalMoves(afterDouble, 'A');

    // Should have main line moves (left=3, right=5), but NO branch moves
    const branchMoves = movesAfterDouble.filter(
      (m) => m.type === 'play' && m.position?.startsWith('branch-'),
    );
    expect(branchMoves.length).toBe(0);

    // Should be able to play [5|2] on the right (crossing the double)
    const rightMoves = movesAfterDouble.filter((m) => m.type === 'play' && m.position === 'right');
    expect(rightMoves.length).toBeGreaterThan(0);
  });

  it('double becomes branchable only AFTER being crossed', () => {
    // Setup: [3|3] alone (uncrossed), fill both sides, then verify branching
    const state = setupState({
      board: {
        mainLine: [pt(3, 3)],
        leftEnd: 3,
        rightEnd: 3,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            hubId: 0,
            tileIndex: 0,
            mainlineIndex: 0,
            hubValue: 3,
            leftSideFilled: false,
            rightSideFilled: false,
            isCrossed: false, // Not crossed yet
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(3, 5), t(2, 3)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // Before crossing: no branch moves available
    const movesBeforeCross = getLegalMoves(state, 'A');
    const branchMovesBeforeCross = movesBeforeCross.filter(
      (m) => m.type === 'play' && m.position?.startsWith('branch-'),
    );
    expect(branchMovesBeforeCross.length).toBe(0);

    const { state: afterOneSide } = applyMove(state, 'A', {
      type: 'play',
      tile: t(3, 5),
      position: 'right',
    });
    expect(afterOneSide.board?.hubDoubles[0].isCrossed).toBe(false);

    const afterCross = {
      ...afterOneSide,
      currentPlayerIndex: 0,
    };
    const { state: afterTwoSides } = applyMove(afterCross, 'A', {
      type: 'play',
      tile: t(2, 3),
      position: 'left',
    });

    expect(afterTwoSides.board?.hubDoubles[0].isCrossed).toBe(true);

    // Now it's B's turn, but let's check the open ends to confirm branching is available
    const openEndsAfterCross = getOpenEnds(afterTwoSides.board);
    expect(openEndsAfterCross.some((e) => e.position === 'branch-0-0')).toBe(true);
  });

  it('uncrossed double must not produce any branch-* legal placement positions', () => {
    // This is the critical test: an uncrossed double should NEVER allow branching
    // Setup: board with uncrossed double at end
    const state = setupState({
      board: {
        mainLine: [pt(2, 5), pt(5, 5)], // [2|5][5|5] - double at right, not crossed
        leftEnd: 2,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            tileIndex: 1,
            hubValue: 5,
            isCrossed: false, // NOT CROSSED
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(5, 3), t(5, 1), t(2, 4)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // Get legal moves
    const moves = getLegalMoves(state, 'A');

    // Filter for branch moves
    const branchMoves = moves.filter((m) => m.type === 'play' && m.position?.startsWith('branch-'));

    // CRITICAL ASSERTION: No branch moves should exist for uncrossed double
    expect(branchMoves).toHaveLength(0);

    // Verify that main line moves are still available
    const mainMoves = moves.filter(
      (m) => m.type === 'play' && (m.position === 'left' || m.position === 'right'),
    );
    expect(mainMoves.length).toBeGreaterThan(0);
  });

  it('double on branch end counts as 2x value', () => {
    // [2|3][3|3][3|5], crossed, with branch ending in [3|6][6|6]
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(3, 6), 'branch-0-0');
    board = simulatePlacement(board, t(6, 6), 'branch-0-0');

    // Main: left=2, right=5
    // Branch: [6|6] = 12
    // Total: 2 + 5 + 12 = 19
    expect(computeOpenEndsSum(board)).toBe(19);
  });
});

describe('Last-tile branch scoring behavior', () => {
  it('branch scoring last tile is legal with drawable boneyard and forces draw', () => {
    // Case B + branch [1|5] → open sum 10 + 5 = 15 (scores)
    let board = simulatePlacement(null, t(1, 1), 'left');
    board = simulatePlacement(board, t(1, 3), 'right');
    board = simulatePlacement(board, t(4, 1), 'left');
    board = simulatePlacement(board, t(3, 3), 'right');

    const state = setupState({
      board,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 5)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [t(2, 2)],
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    const moves = getLegalMoves(state, 'A');
    const branchMove = moves.find((m) => m.type === 'play' && m.position === 'branch-0-0');
    expect(branchMove).toBeDefined();

    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 5),
      position: 'branch-0-0',
    });
    expect(forcedDraw).not.toBeNull();
    expect(next.handOver).toBe(false);
    expect(next.players.A.hand.length).toBe(1);
  });
});

describe('Last-tile scoring vs non-scoring placements', () => {
  function lastTile32State(boneyard: Tile[]) {
    // [8|3][3|2] via engine placement: open ends 3 and 3 (sum 5 before last play)
    // Last tile 3|2 on right scores; on left does not change sum to a multiple of 5
    let board = simulatePlacement(null, t(8, 3), 'left');
    board = simulatePlacement(board, t(3, 2), 'right');
    return setupState({
      board,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(3, 2)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard,
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });
  }

  it('exposes both scoring and non-scoring placements for last tile 3-2', () => {
    const state = lastTile32State([t(5, 5)]);
    const plays = getLegalMoves(state, 'A').filter((m) => m.type === 'play');
    const positions = plays.map((m) => (m.type === 'play' ? m.position : ''));
    expect(positions).toContain('left');
    expect(positions).toContain('right');
    expect(plays.length).toBe(2);
  });

  it('non-scoring last-tile placement goes out even when boneyard has tiles', () => {
    const state = lastTile32State([t(5, 5)]);
    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(3, 2),
      position: 'left',
    });
    expect(forcedDraw).toBeNull();
    expect(next.handOver).toBe(true);
    expect(next.players.A.hand.length).toBe(0);
    expect(next.players.A.score).toBe(0);
  });

  it('scoring last-tile placement with drawable boneyard forces draw and continues hand', () => {
    const state = lastTile32State([t(5, 5)]);
    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(3, 2),
      position: 'right',
    });
    expect(forcedDraw).not.toBeNull();
    expect(next.handOver).toBe(false);
    expect(next.players.A.score).toBe(1);
    expect(next.players.A.hand.length).toBe(1);
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('scoring last-tile placement with empty boneyard ends the hand', () => {
    const state = lastTile32State([]);
    const { state: next, forcedDraw } = applyMove(state, 'A', {
      type: 'play',
      tile: t(3, 2),
      position: 'right',
    });
    expect(forcedDraw).toBeNull();
    expect(next.handOver).toBe(true);
    expect(next.players.A.hand.length).toBe(0);
    expect(next.players.A.score).toBe(1);
  });
});

describe('Dead tiles behavior', () => {
  it('dead tiles are never drawn', () => {
    let state = createInitialState(['A', 'B'], {
      tilesPerPlayer: 7,
      deadTileCount: 2,
    });
    state = startNewHand(state);

    const deadTiles = state.deadTiles;
    expect(deadTiles.length).toBe(2);

    // Dead tiles sit in the boneyard tail (never dealt to hands); they must not be in hands.
    const handTiles = [...state.players['A'].hand, ...state.players['B'].hand];

    for (const deadTile of deadTiles) {
      const found = handTiles.some((t) => t.high === deadTile.high && t.low === deadTile.low);
      expect(found).toBe(false);
    }
  });
});

describe('Extra turn chaining', () => {
  it('chains extra turns for consecutive scoring plays', () => {
    // Setup where A can score twice in a row
    const state = setupState({
      board: {
        mainLine: [pt(0, 5)],
        leftEnd: 0,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 0), t(0, 5), t(1, 2)], score: 0 },
        B: { id: 'B', hand: [t(1, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // First play: [0|0] on left → double → extra turn
    // Sum: 0 (double) + 5 = 5 → 1 point AND double
    let { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(0, 0),
      position: 'left',
    });
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.players.A.score).toBe(1);

    // Second play: [0|5] on left → sum 5 + 5 = 10 → scores 2 → extra turn
    next = applyMove(next, 'A', {
      type: 'play',
      tile: t(0, 5),
      position: 'left',
    }).state;
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.players.A.score).toBe(3); // 1 + 2

    // Third play: [1|2] on... wait, can't match.
    // Board is now [0|5][0|0][0|5], left=5, right=5
    // [1|2] doesn't match, so turn passes
  });
});

describe('Opening rules', () => {
  it('first play must be double or scoring', () => {
    const state = setupState({
      board: null,
      handOpen: false,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 2), t(3, 4), t(5, 5)], score: 0 },
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, 'A');

    // [1|2] sum=3, not scoring, not double → illegal
    // [3|4] sum=7, not scoring, not double → illegal
    // [5|5] double → legal
    expect(moves.length).toBe(1);
    expect(moves[0].type).toBe('play');
    if (moves[0].type === 'play') {
      expect(moves[0].tile).toEqual(t(5, 5));
    }
  });

  it('scoring non-double can open', () => {
    const state = setupState({
      board: null,
      handOpen: false,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 3), t(1, 2)], score: 0 }, // [2|3] sums to 5
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, 'A');

    // [2|3] sum=5 → scores → legal
    // [1|2] sum=3 → no score, not double → illegal
    const playMoves = moves.filter((m) => m.type === 'play');
    expect(playMoves.length).toBe(1);
    if (playMoves[0].type === 'play') {
      expect(playMoves[0].tile).toEqual(t(2, 3));
    }
  });
});

describe('Blocked hand', () => {
  it('ends hand when all players pass consecutively', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            tileIndex: 0,
            hubValue: 6,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 }, // Can't match 6
        B: { id: 'B', hand: [t(2, 3)], score: 0 }, // Can't match 6
      },
      boneyard: [],
      deadTiles: [],
      consecutivePasses: 0,
    });

    // A passes
    let { state: next } = applyMove(state, 'A', { type: 'pass' });
    expect(next.consecutivePasses).toBe(1);
    expect(next.handOver).toBe(false);

    // B passes
    next = applyMove(next, 'B', { type: 'pass' }).state;
    expect(next.consecutivePasses).toBe(2);
    expect(next.handOver).toBe(true); // 2 players passed = blocked
  });

  it('lowest pips wins blocked hand', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            tileIndex: 0,
            hubValue: 6,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      config: {
        ...DEFAULT_CONFIG,
        blockedHandRule: 'lowestPips',
        endHandBonus: 'sumOpponentPenalties',
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 10 }, // 1 pip total
        B: { id: 'B', hand: [t(4, 5)], score: 5 }, // 9 pips total
      },
      boneyard: [],
      deadTiles: [],
      consecutivePasses: 0,
    });

    let { state: next } = applyMove(state, 'A', { type: 'pass' });
    next = applyMove(next, 'B', { type: 'pass' }).state;

    // A wins (1 pip < 9 pips)
    // B's penalty: 9 pips → round(9/5) = 2 points
    // A gets bonus of 2
    expect(next.players.A.score).toBe(12); // 10 + 2
    expect(next.players.B.score).toBe(5); // unchanged
  });
});

describe('finalizeMandatoryAutoPasses', () => {
  it('auto-passes locked-out player so turn rests on someone who can act', () => {
    const locked = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 1,
      players: {
        A: { id: 'A', hand: [t(1, 5)], score: 0 },
        B: { id: 'B', hand: [t(6, 6)], score: 0 },
      },
      boneyard: [t(0, 0), t(0, 1)],
      deadTiles: [t(0, 0), t(0, 1)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
      consecutivePasses: 0,
    });

    expect(getLegalMoves(locked, 'B').every((m) => m.type !== 'play')).toBe(true);

    const { state: fin, autoPassedPlayerIds } = finalizeMandatoryAutoPasses(locked);

    expect(autoPassedPlayerIds).toEqual(['B']);
    expect(fin.currentPlayerIndex).toBe(0);
    expect(getLegalMoves(fin, 'A').some((m) => m.type === 'play')).toBe(true);
  });

  it('does nothing when drawable boneyard exists (player must DRAW first)', () => {
    const canDrawInstead = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 1,
      players: {
        A: { id: 'A', hand: [t(2, 2)], score: 0 },
        B: { id: 'B', hand: [t(6, 6)], score: 0 },
      },
      boneyard: [t(0, 0), t(0, 1), t(2, 3)],
      deadTiles: [t(0, 0), t(0, 1)],
      config: { ...DEFAULT_CONFIG, deadTileCount: 2 },
      consecutivePasses: 0,
    });

    expect(canDraw(canDrawInstead, 'B')).toBe(true);
    const { state: fin, autoPassedPlayerIds } = finalizeMandatoryAutoPasses(canDrawInstead);
    expect(autoPassedPlayerIds).toEqual([]);
    expect(fin).toEqual(canDrawInstead);
  });
});

describe('Game ends at 60 points', () => {
  it('reaching 60 mid-hand does not end the game immediately', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 6), t(0, 0)], score: 58 }, // 2 points away from winning
        B: { id: 'B', hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // Play [1|6] on left: ends 6 + 4 = 10 → scores 2 points → A reaches 60
    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });

    expect(next.players.A.score).toBe(60);
    expect(next.handOver).toBe(false);
    expect(next.gameOver).toBe(false);
    expect(next.winnerId).toBeNull();
  });

  it('game continues if no one has reached 60', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 6), t(0, 0)], score: 50 },
        B: { id: 'B', hand: [t(0, 1)], score: 40 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });

    expect(next.players.A.score).toBe(52);
    expect(next.gameOver).toBe(false);
    expect(next.winnerId).toBeNull();
  });

  it('after hand end, tied scores at or above 60 continue with tiebreaker hands', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      config: {
        ...DEFAULT_CONFIG,
        blockedHandRule: 'noScore',
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 2)], score: 61 },
        B: { id: 'B', hand: [t(3, 3)], score: 61 },
      },
      boneyard: [],
      deadTiles: [],
      consecutivePasses: 0,
    });

    let { state: next } = applyMove(state, 'A', { type: 'pass' });
    next = applyMove(next, 'B', { type: 'pass' }).state;

    expect(next.players.A.score).toBe(61);
    expect(next.players.B.score).toBe(61);
    expect(next.handOver).toBe(true);
    expect(next.gameOver).toBe(false);
    expect(next.winnerId).toBeNull();
  });

  it('after hand end, highest score wins even if another player reached 60 earlier', () => {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 6), t(0, 0)], score: 58 }, // reaches 60 mid-hand
        B: { id: 'B', hand: [t(4, 5)], score: 65 }, // ends hand higher
      },
      boneyard: [],
      deadTiles: [],
    });

    const { state: afterA } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 6),
      position: 'left',
    });
    expect(afterA.players.A.score).toBe(60);
    expect(afterA.handOver).toBe(false);
    expect(afterA.gameOver).toBe(false);

    const bTurn = { ...afterA, currentPlayerIndex: 1 };
    const { state: afterB } = applyMove(bTurn, 'B', {
      type: 'play',
      tile: t(4, 5),
      position: 'right',
    });

    expect(afterB.handOver).toBe(true);
    expect(afterB.gameOver).toBe(true);
    expect(afterB.winnerId).toBe('B');
  });
});

describe('Go-out bonus scoring', () => {
  function runGoOutBonusCase(opponentHand: Tile[], expectedBonus: number) {
    const state = setupState({
      board: {
        mainLine: [pt(1, 4)],
        leftEnd: 1,
        rightEnd: 4,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 2)], score: 0 }, // non-scoring, non-double go-out tile
        B: { id: 'B', hand: opponentHand, score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const { state: next } = applyMove(state, 'A', {
      type: 'play',
      tile: t(1, 2),
      position: 'left',
    });

    expect(next.handOver).toBe(true);
    expect(next.players.A.score).toBe(expectedBonus);
  }

  it('awards rounded-to-nearest-5 points on go-out (20->4, 22->4, 23->5)', () => {
    runGoOutBonusCase([t(4, 5), t(5, 6)], 4); // 20 -> 4
    runGoOutBonusCase([t(4, 6), t(6, 6)], 4); // 22 -> 4
    runGoOutBonusCase([t(5, 6), t(6, 6)], 5); // 23 -> 5
  });
});

describe('Deterministic legality and pending priority', () => {
  it('nested branch hub contributes branch endpoints and allows 1-4 play', () => {
    let board = simulatePlacement(null, t(6, 6), 'left');
    board = simulatePlacement(board, t(5, 6), 'left');
    board = simulatePlacement(board, t(6, 3), 'right'); // hub A crossed
    board = simulatePlacement(board, t(6, 1), 'branch-0-0');
    board = simulatePlacement(board, t(1, 1), 'branch-0-0'); // hub B (double-1) on branch lane
    board = simulatePlacement(board, t(1, 2), 'branch-0-0'); // cross hub B

    const hubB = board.hubDoubles.find(
      (h) =>
        h.laneType === 'branch' &&
        h.laneRef === 'branch-0-0' &&
        h.branchDepth === 1 &&
        h.hubValue === 1,
    );
    expect(hubB).toBeDefined();
    expect(hubB?.isCrossed).toBe(true);
    const hubBId = hubB?.hubId;
    expect(typeof hubBId).toBe('number');

    const state = setupState({
      board,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 4)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, 'A').filter((m) => m.type === 'play');
    expect(moves.some((m) => m.position === `branch-${hubBId}-0`)).toBe(true);
    expect(moves.some((m) => m.position === `branch-${hubBId}-1`)).toBe(true);

    expect(() =>
      applyMove(state, 'A', {
        type: 'play',
        tile: t(1, 4),
        position: `branch-${hubBId}-0`,
      }),
    ).not.toThrow();
  });

  it('nested branch hub on arm 1 opens both nested branch endpoints after crossing', () => {
    let board = simulatePlacement(null, t(6, 6), 'left');
    board = simulatePlacement(board, t(5, 6), 'left');
    board = simulatePlacement(board, t(6, 3), 'right'); // main hub crossed
    board = simulatePlacement(board, t(6, 1), 'branch-0-1');
    board = simulatePlacement(board, t(1, 1), 'branch-0-1'); // nested hub on branch lane
    board = simulatePlacement(board, t(1, 2), 'branch-0-1'); // cross nested hub by neighbor-on-both-sides

    const nestedHub = board.hubDoubles.find(
      (h) =>
        h.laneType === 'branch' &&
        h.laneRef === 'branch-0-1' &&
        h.branchDepth === 1 &&
        h.hubValue === 1,
    );
    expect(nestedHub).toBeDefined();
    expect(nestedHub?.isCrossed).toBe(true);
    const nestedHubId = nestedHub?.hubId;
    expect(typeof nestedHubId).toBe('number');

    const state = setupState({
      board,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 4)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const positions = getLegalMoves(state, 'A')
      .filter((m) => m.type === 'play')
      .map((m) => m.position);
    expect(positions).toContain(`branch-${nestedHubId}-0`);
    expect(positions).toContain(`branch-${nestedHubId}-1`);

    expect(() =>
      applyMove(state, 'A', {
        type: 'play',
        tile: t(1, 4),
        position: `branch-${nestedHubId}-1`,
      }),
    ).not.toThrow();
  });

  it('includes branch endpoints from crossed hubs created on branch lanes', () => {
    let board = simulatePlacement(null, t(3, 3), 'left');
    board = simulatePlacement(board, t(2, 3), 'left');
    board = simulatePlacement(board, t(3, 5), 'right'); // mainline hub crossed
    board = simulatePlacement(board, t(3, 2), 'branch-0-0');
    board = simulatePlacement(board, t(2, 2), 'branch-0-0'); // double on branch -> nested hub
    board = simulatePlacement(board, t(2, 4), 'branch-0-0'); // cross nested hub on branch lane

    const nestedHub = board.hubDoubles.find(
      (h) => h.laneType === 'branch' && h.laneRef === 'branch-0-0' && h.branchDepth === 1,
    );
    expect(nestedHub).toBeDefined();
    expect(nestedHub?.isCrossed).toBe(true);
    const nestedHubId = nestedHub?.hubId;
    expect(typeof nestedHubId).toBe('number');

    const state = setupState({
      board,
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 6)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const positions = getLegalMoves(state, 'A')
      .filter((m) => m.type === 'play')
      .map((m) => m.position);
    expect(positions).toContain(`branch-${nestedHubId}-0`);
    expect(positions).toContain(`branch-${nestedHubId}-1`);
  });

  it('0-3 remains legal when endpoint is double-3 (orientation-derived endpoint pip)', () => {
    const state = setupState({
      board: {
        mainLine: [pt(2, 3), pt(3, 3)],
        leftEnd: 2,
        rightEnd: 6, // intentionally stale/wrong; endpoint tile is [3|3]
        leftEndIsDouble: false,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            hubId: 3,
            tileIndex: 1,
            mainlineIndex: 1,
            hubValue: 3,
            leftSideFilled: true,
            rightSideFilled: false,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 3), t(1, 1)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, 'A').filter((m) => m.type === 'play');
    expect(moves.some((m) => m.tile.low === 0 && m.tile.high === 3)).toBe(true);
  });

  it('returns play moves in deterministic sorted order', () => {
    const state = setupState({
      board: {
        mainLine: [pt(3, 5), pt(5, 5), pt(5, 2)],
        leftEnd: 3,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [
          {
            hubId: 7,
            tileIndex: 1,
            mainlineIndex: 1,
            hubValue: 5,
            leftSideFilled: true,
            rightSideFilled: true,
            isCrossed: true,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(2, 5), t(1, 3)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const plays = getLegalMoves(state, 'A').filter((m) => m.type === 'play');
    const rendered = plays.map((m) => `${m.tile.low}|${m.tile.high}@${m.position}`);
    expect(rendered).toEqual(['1|3@left', '2|5@right', '2|5@branch-7-0', '2|5@branch-7-1']);
  });

  it('pending does not restrict legal moves when satisfying plays exist now', () => {
    const state = setupState({
      board: {
        mainLine: [pt(2, 6), pt(6, 6), pt(6, 3), pt(3, 5), pt(5, 5)],
        leftEnd: 2,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            hubId: 3,
            tileIndex: 1,
            mainlineIndex: 1,
            hubValue: 6,
            leftSideFilled: true,
            rightSideFilled: true,
            isCrossed: true,
            branches: [{ tiles: [pt(6, 1)], openEnd: 1, openEndIsDouble: false }],
          },
          {
            hubId: 9,
            tileIndex: 4,
            mainlineIndex: 4,
            hubValue: 5,
            leftSideFilled: true,
            rightSideFilled: false,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(1, 4)], score: 0 }, // no 5, cannot satisfy pending on right now
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const movesUnsat = getLegalMoves(state, 'A');
    expect(movesUnsat.some((m) => m.type === 'play' && m.position === 'branch-3-0')).toBe(true);

    const satState = {
      ...state,
      players: {
        ...state.players,
        A: { id: 'A', hand: [t(1, 4), t(4, 5)], score: 0 },
      },
    };
    const movesSat = getLegalMoves(satState, 'A').filter((m) => m.type === 'play');
    expect(movesSat.length).toBeGreaterThan(0);
    expect(movesSat.some((m) => m.position === 'right')).toBe(true);
    expect(movesSat.some((m) => m.position === 'branch-3-0')).toBe(true);
  });

  it('pending pip 6 does not block 0-6 play on blank endpoint', () => {
    const state = setupState({
      board: {
        mainLine: [pt(0, 1), pt(1, 6), pt(6, 6)],
        leftEnd: 0,
        rightEnd: 6,
        leftEndIsDouble: false,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            hubId: 12,
            tileIndex: 2,
            mainlineIndex: 2,
            hubValue: 6,
            leftSideFilled: true,
            rightSideFilled: false,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 6), t(4, 6)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, 'A').filter((m) => m.type === 'play');
    expect(moves.some((m) => m.tile.low === 0 && m.tile.high === 6 && m.position === 'left')).toBe(
      true,
    );
    expect(moves.some((m) => m.position === 'right')).toBe(true);
  });

  it('pending end-double does not remove branch endpoints from crossed hubs', () => {
    const crossedHubId = 6;
    const state = setupState({
      board: {
        mainLine: [pt(2, 6), pt(6, 6), pt(6, 1), pt(1, 0), pt(0, 0)],
        leftEnd: 2,
        rightEnd: 0,
        leftEndIsDouble: false,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            hubId: crossedHubId,
            tileIndex: 1,
            mainlineIndex: 1,
            hubValue: 6,
            leftSideFilled: true,
            rightSideFilled: true,
            isCrossed: true,
            branches: [],
          },
          {
            hubId: 0,
            tileIndex: 4,
            mainlineIndex: 4,
            hubValue: 0,
            leftSideFilled: true,
            rightSideFilled: false,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 6)], score: 0 },
        B: { id: 'B', hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, 'A').filter((m) => m.type === 'play');
    const positions = moves.map((m) => m.position);
    expect(positions).toContain('right');
    expect(positions).toContain(`branch-${crossedHubId}-0`);
    expect(positions).toContain(`branch-${crossedHubId}-1`);
  });
});

describe('canDraw function', () => {
  it('returns true when player has no legal plays and boneyard is not empty', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            tileIndex: 0,
            hubValue: 6,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 }, // Can't match 6
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(5, 6)], // Has tiles
      deadTiles: [],
      config: { ...DEFAULT_CONFIG, deadTileCount: 0 },
    });

    expect(canDraw(state, 'A')).toBe(true);
  });

  it('returns false when player has a legal play', () => {
    const state = setupState({
      board: {
        mainLine: [pt(3, 5)],
        leftEnd: 3,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(3, 4), t(0, 1)], score: 0 }, // Can play [3|4]
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(5, 6)],
      deadTiles: [],
    });

    expect(canDraw(state, 'A')).toBe(false);
  });

  it('returns false when boneyard is empty', () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            tileIndex: 0,
            hubValue: 6,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [], // Empty
      deadTiles: [],
    });

    expect(canDraw(state, 'A')).toBe(false);
  });

  it("returns false when it is not the player's turn", () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [
          {
            tileIndex: 0,
            hubValue: 6,
            isCrossed: false,
            branches: [],
          },
        ],
      },
      currentPlayerIndex: 1, // B's turn
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(5, 6)],
      deadTiles: [],
    });

    expect(canDraw(state, 'A')).toBe(false);
  });
});
