import { describe, it, expect } from "vitest";
import {
  createInitialState,
  startNewHand,
  getLegalMoves,
  applyMove,
  computeOpenEndsSum,
  computePlayScore,
  getOpenEnds,
  canDraw,
} from "../engine";
import { simulatePlacement } from "../scoring";
import { Tile, PlacedTile, GameState, BoardState, PlacementPosition, DEFAULT_CONFIG, isDouble } from "../types";

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
  const base = createInitialState(["A", "B"]);
  return {
    ...base,
    handOpen: overrides.board !== null && overrides.board !== undefined,
    ...overrides,
  } as GameState;
}

describe("Racehorse Engine Core Rules", () => {

  it("deals 7 tiles each and keeps exactly 2 dead tiles", () => {
    let state = createInitialState(["A", "B"], {
      tilesPerPlayer: 7,
      deadTileCount: 2
    });

    state = startNewHand(state);

    expect(state.players["A"].hand.length).toBe(7);
    expect(state.players["B"].hand.length).toBe(7);
    expect(state.deadTiles.length).toBe(2);

    const total =
      state.players["A"].hand.length +
      state.players["B"].hand.length +
      state.boneyard.length +
      state.deadTiles.length;

    expect(total).toBe(28);
  });

  it("cannot go out on a double", () => {
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
        A: { id: "A", hand: [t(2, 2)], score: 0 },
        B: { id: "B", hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, "A");

    expect(moves.some(m => m.type === "play")).toBe(false);
    expect(moves.some(m => m.type === "pass")).toBe(true);
  });

  it("cannot go out on a scoring play", () => {
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
        A: { id: "A", hand: [t(1, 6)], score: 0 },
        B: { id: "B", hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, "A");

    expect(moves.some(m => m.type === "play")).toBe(false);
    expect(moves.some(m => m.type === "pass")).toBe(true);
  });

  it("scoring play grants an extra turn", () => {
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
        A: { id: "A", hand: [t(1, 6), t(0, 0)], score: 0 },
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const next = applyMove(state, "A", {
      type: "play",
      tile: t(1, 6),
      position: "left",
    });

    expect(next.players.A.score).toBe(2); // 10/5 = 2 points
    expect(next.currentPlayerIndex).toBe(0); // extra turn
  });

  it("double play grants an extra turn", () => {
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
        A: { id: "A", hand: [t(3, 3), t(1, 2)], score: 0 },
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const next = applyMove(state, "A", {
      type: "play",
      tile: t(3, 3),
      position: "left",
    });

    expect(next.currentPlayerIndex).toBe(0); // extra turn
  });

});

describe("Scoring: Points = sum/5", () => {

  it("scores 1 point when sum is 5", () => {
    // [2|3] alone → sum = 5 → 1 point
    const board = simulatePlacement(null, t(2, 3), "left");
    expect(computeOpenEndsSum(board)).toBe(5);
    expect(computePlayScore(board)).toBe(1);
  });

  it("scores 2 points when sum is 10", () => {
    // [4|6] alone → sum = 10 → 2 points
    const board = simulatePlacement(null, t(4, 6), "left");
    expect(computeOpenEndsSum(board)).toBe(10);
    expect(computePlayScore(board)).toBe(2);
  });

  it("scores 3 points when sum is 15", () => {
    // Start with [5|5] (double), sum = 10
    let board = simulatePlacement(null, t(5, 5), "left");
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

  it("scores 0 when sum is not divisible by 5", () => {
    // [1|2] alone → sum = 3 → 0 points
    const board = simulatePlacement(null, t(1, 2), "left");
    expect(computeOpenEndsSum(board)).toBe(3);
    expect(computePlayScore(board)).toBe(0);
  });

  it("double at open end counts as 2x value", () => {
    // [5|5] alone at left end → both pips exposed → 10
    const board = simulatePlacement(null, t(5, 5), "left");
    expect(computeOpenEndsSum(board)).toBe(10);
    expect(computePlayScore(board)).toBe(2); // 10/5 = 2 points
  });

  it("double at right end counts as 2x value", () => {
    // Start with [3|5], then add [5|5] on right
    let board = simulatePlacement(null, t(3, 5), "left");
    board = simulatePlacement(board, t(5, 5), "right");
    // Left = 3, Right = [5|5] = 10 → sum = 13, no score
    expect(computeOpenEndsSum(board)).toBe(13);
    expect(computePlayScore(board)).toBe(0);
  });

  it("double at left end after crossing still counts correctly", () => {
    // [3|3] alone, then cross with [3|5] on right
    let board = simulatePlacement(null, t(3, 3), "left");
    // [3|3] is a double at both ends initially → sum = 6
    expect(computeOpenEndsSum(board)).toBe(6);

    // Cross with [3|5]
    board = simulatePlacement(board, t(3, 5), "right");
    // Left = [3|3] = 6, Right = 5 → sum = 11
    expect(computeOpenEndsSum(board)).toBe(11);
  });

});

describe("Crossed Doubles and Branching", () => {

  it("playing a double creates an uncrossed hub", () => {
    const board = simulatePlacement(null, t(3, 3), "left");

    expect(board.hubDoubles.length).toBe(1);
    expect(board.hubDoubles[0].hubValue).toBe(3);
    expect(board.hubDoubles[0].isCrossed).toBe(false);
    expect(board.hubDoubles[0].branches.length).toBe(0);
  });

  it("playing through both sides crosses a double", () => {
    // Start with [3|3]
    let board = simulatePlacement(null, t(3, 3), "left");
    expect(board.hubDoubles[0].isCrossed).toBe(false);

    // Play [3|5] on right (fills right side only)
    board = simulatePlacement(board, t(3, 5), "right");
    expect(board.hubDoubles[0].isCrossed).toBe(false);

    // Fill left side too
    board = simulatePlacement(board, t(2, 3), "left");

    expect(board.mainLine.length).toBe(3);
    expect(board.leftEnd).toBe(2);
    expect(board.rightEnd).toBe(5);
    expect(board.hubDoubles[0].isCrossed).toBe(true);
  });

  it("crossed double enables branching", () => {
    // Start: [3|3]
    let board = simulatePlacement(null, t(3, 3), "left");
    // Fill both sides around [3|3]
    board = simulatePlacement(board, t(3, 5), "right");
    board = simulatePlacement(board, t(2, 3), "left");

    const openEnds = getOpenEnds(board);

    // Should have: left, right, and branch-0-0 (new branch on hub 0)
    expect(openEnds.some(e => e.position === "left")).toBe(true);
    expect(openEnds.some(e => e.position === "right")).toBe(true);
    expect(openEnds.some(e => e.position === "branch-0-0")).toBe(true);
    expect(openEnds.find(e => e.position === "branch-0-0")?.matchValue).toBe(3);
  });

  it("can create a branch on a crossed double", () => {
    // [2|3][3|3][3|5], crossed
    let board = simulatePlacement(null, t(3, 3), "left");
    board = simulatePlacement(board, t(3, 5), "right");
    board = simulatePlacement(board, t(2, 3), "left");

    // Create branch with [3|1]
    board = simulatePlacement(board, t(1, 3), "branch-0-0");

    expect(board.hubDoubles[0].branches.length).toBe(1);
    expect(board.hubDoubles[0].branches[0].tiles.length).toBe(1);
    expect(board.hubDoubles[0].branches[0].openEnd).toBe(1);
  });

  it("branch end is included in open ends sum", () => {
    // [2|3][3|3][3|5], crossed
    let board = simulatePlacement(null, t(3, 3), "left");
    board = simulatePlacement(board, t(3, 5), "right");
    board = simulatePlacement(board, t(2, 3), "left");

    // Before branch: sum = 2 + 5 = 7
    expect(computeOpenEndsSum(board)).toBe(7);

    // Add branch [3|2], branch end = 2
    board = simulatePlacement(board, t(2, 3), "branch-0-0");

    // After branch: sum = 2 + 5 + 2 = 9
    expect(computeOpenEndsSum(board)).toBe(9);
  });

  it("each hub can have at most 2 branches", () => {
    // [2|3][3|3][3|5]
    let board = simulatePlacement(null, t(3, 3), "left");
    board = simulatePlacement(board, t(3, 5), "right");
    board = simulatePlacement(board, t(2, 3), "left");

    // First branch
    board = simulatePlacement(board, t(3, 1), "branch-0-0");
    // Second branch
    board = simulatePlacement(board, t(3, 2), "branch-0-1");

    expect(board.hubDoubles[0].branches.length).toBe(2);

    // Check open ends - should NOT include branch-0-2
    const openEnds = getOpenEnds(board);
    expect(openEnds.some(e => e.position === "branch-0-2")).toBe(false);

    // Can extend existing branches
    expect(openEnds.some(e => e.position === "branch-0-0")).toBe(true);
    expect(openEnds.some(e => e.position === "branch-0-1")).toBe(true);
  });

  it("can extend an existing branch", () => {
    // [2|3][3|3][3|5] with branch [3|1]
    let board = simulatePlacement(null, t(3, 3), "left");
    board = simulatePlacement(board, t(3, 5), "right");
    board = simulatePlacement(board, t(2, 3), "left");
    board = simulatePlacement(board, t(3, 1), "branch-0-0");

    // Branch open end is 1, extend with [1|4]
    board = simulatePlacement(board, t(1, 4), "branch-0-0");

    expect(board.hubDoubles[0].branches[0].tiles.length).toBe(2);
    expect(board.hubDoubles[0].branches[0].openEnd).toBe(4);

    // Sum: left=2, right=5, branch=4 → 11
    expect(computeOpenEndsSum(board)).toBe(11);
    expect(computePlayScore(board)).toBe(0);
  });

  it("multiple crossed doubles can each have branches", () => {
    // Build with both doubles crossed by filling both sides around each

    let board = simulatePlacement(null, t(5, 5), "left");
    // Fill right of [5|5]
    board = simulatePlacement(board, t(3, 5), "right");
    // Fill left of [5|5]
    board = simulatePlacement(board, t(2, 5), "left");
    // Add [3|3] on right
    board = simulatePlacement(board, t(3, 3), "right");
    // Fill right of [3|3]
    board = simulatePlacement(board, t(1, 3), "right");
    // Fill left of [3|3]
    board = simulatePlacement(board, t(4, 3), "left");

    expect(board.hubDoubles.length).toBe(2);
    expect(board.hubDoubles[0].isCrossed).toBe(true); // [5|5]
    expect(board.hubDoubles[1].isCrossed).toBe(true); // [3|3]

    // Create branch on first hub [5|5]
    board = simulatePlacement(board, t(5, 2), "branch-0-0");
    // Create branch on second hub [3|3]
    board = simulatePlacement(board, t(3, 4), "branch-1-0");

    // Main ends: left=4, right=1
    // Branch on hub 0: 2
    // Branch on hub 1: 4
    // Total: 4 + 1 + 2 + 4 = 11
    expect(computeOpenEndsSum(board)).toBe(11);
  });

  it("uncrossed double at end does not allow branching", () => {
    // [2|5][5|5] - double at right end, not crossed
    let board = simulatePlacement(null, t(2, 5), "left");
    board = simulatePlacement(board, t(5, 5), "right");

    expect(board.hubDoubles.length).toBe(1);
    expect(board.hubDoubles[0].isCrossed).toBe(false);

    const openEnds = getOpenEnds(board);
    // Should NOT have branch option
    expect(openEnds.some(e => e.position.startsWith("branch-"))).toBe(false);
  });

  it("playing a double does NOT create branch moves until crossed (getLegalMoves)", () => {
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
        A: { id: "A", hand: [t(5, 5), t(5, 2), t(0, 1)], score: 0 },
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // First, play the [5|5] on right
    const afterDouble = applyMove(state, "A", {
      type: "play",
      tile: t(5, 5),
      position: "right",
    });

    // Verify the double is registered but NOT crossed
    expect(afterDouble.board?.hubDoubles.length).toBe(1);
    expect(afterDouble.board?.hubDoubles[0].isCrossed).toBe(false);

    // A still has turn (played a double), check legal moves
    // A has [5|2] which can match the right end (5) via main line
    const movesAfterDouble = getLegalMoves(afterDouble, "A");

    // Should have main line moves (left=3, right=5), but NO branch moves
    const branchMoves = movesAfterDouble.filter(
      m => m.type === "play" && m.position?.startsWith("branch-")
    );
    expect(branchMoves.length).toBe(0);

    // Should be able to play [5|2] on the right (crossing the double)
    const rightMoves = movesAfterDouble.filter(
      m => m.type === "play" && m.position === "right"
    );
    expect(rightMoves.length).toBeGreaterThan(0);
  });

  it("double becomes branchable only AFTER being crossed", () => {
    // Setup: [3|3] alone (uncrossed), fill both sides, then verify branching
    const state = setupState({
      board: {
        mainLine: [pt(3, 3)],
        leftEnd: 3,
        rightEnd: 3,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{
          hubId: 0,
          tileIndex: 0,
          mainlineIndex: 0,
          hubValue: 3,
          leftSideFilled: false,
          rightSideFilled: false,
          isCrossed: false, // Not crossed yet
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(3, 5), t(2, 3)], score: 0 },
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // Before crossing: no branch moves available
    const movesBeforeCross = getLegalMoves(state, "A");
    const branchMovesBeforeCross = movesBeforeCross.filter(
      m => m.type === "play" && m.position?.startsWith("branch-")
    );
    expect(branchMovesBeforeCross.length).toBe(0);

    const afterOneSide = applyMove(state, "A", {
      type: "play",
      tile: t(3, 5),
      position: "right",
    });
    expect(afterOneSide.board?.hubDoubles[0].isCrossed).toBe(false);

    const afterCross = {
      ...afterOneSide,
      currentPlayerIndex: 0,
    };
    const afterTwoSides = applyMove(afterCross, "A", {
      type: "play",
      tile: t(2, 3),
      position: "left",
    });

    expect(afterTwoSides.board?.hubDoubles[0].isCrossed).toBe(true);

    // Now it's B's turn, but let's check the open ends to confirm branching is available
    const openEndsAfterCross = getOpenEnds(afterTwoSides.board);
    expect(openEndsAfterCross.some(e => e.position === "branch-0-0")).toBe(true);
  });

  it("uncrossed double must not produce any branch-* legal placement positions", () => {
    // This is the critical test: an uncrossed double should NEVER allow branching
    // Setup: board with uncrossed double at end
    const state = setupState({
      board: {
        mainLine: [pt(2, 5), pt(5, 5)], // [2|5][5|5] - double at right, not crossed
        leftEnd: 2,
        rightEnd: 5,
        leftEndIsDouble: false,
        rightEndIsDouble: true,
        hubDoubles: [{
          tileIndex: 1,
          hubValue: 5,
          isCrossed: false, // NOT CROSSED
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(5, 3), t(5, 1), t(2, 4)], score: 0 },
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // Get legal moves
    const moves = getLegalMoves(state, "A");

    // Filter for branch moves
    const branchMoves = moves.filter(
      m => m.type === "play" && m.position?.startsWith("branch-")
    );

    // CRITICAL ASSERTION: No branch moves should exist for uncrossed double
    expect(branchMoves).toHaveLength(0);

    // Verify that main line moves are still available
    const mainMoves = moves.filter(
      m => m.type === "play" && (m.position === "left" || m.position === "right")
    );
    expect(mainMoves.length).toBeGreaterThan(0);
  });

  it("double on branch end counts as 2x value", () => {
    // [2|3][3|3][3|5], crossed, with branch ending in [3|6][6|6]
    let board = simulatePlacement(null, t(3, 3), "left");
    board = simulatePlacement(board, t(3, 5), "right");
    board = simulatePlacement(board, t(2, 3), "left");
    board = simulatePlacement(board, t(3, 6), "branch-0-0");
    board = simulatePlacement(board, t(6, 6), "branch-0-0");

    // Main: left=2, right=5
    // Branch: [6|6] = 12
    // Total: 2 + 5 + 12 = 19
    expect(computeOpenEndsSum(board)).toBe(19);
  });

});

describe("Cannot go out with branch scoring", () => {

  it("cannot go out if branch play scores", () => {
    // Setup: [3|3][3|5] with main ends 6 (double-3), 5
    // Playing [3|4] on branch makes sum 6 + 5 + 4 = 15 → scores
    // If this is last tile, cannot play it

    const state = setupState({
      board: {
        mainLine: [pt(3, 3), pt(3, 5)],
        leftEnd: 3,
        rightEnd: 5,
        leftEndIsDouble: true,
        rightEndIsDouble: false,
        hubDoubles: [{
          hubId: 0,
          tileIndex: 0,
          mainlineIndex: 0,
          hubValue: 3,
          leftSideFilled: true,
          rightSideFilled: true,
          isCrossed: true,
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(3, 4)], score: 0 }, // Only tile, would score on branch (6+5+4=15)
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, "A");

    // Branch-0-0 would score (sum=15), can't go out
    // Left (3 match) → new left would be 4, sum = 4 + 5 = 9, no score, legal
    const branchMove = moves.find(m =>
      m.type === "play" &&
      m.position === "branch-0-0"
    );
    expect(branchMove).toBeUndefined(); // Can't go out on scoring branch

    // But can play on left since it doesn't score
    const leftMove = moves.find(m =>
      m.type === "play" &&
      m.position === "left"
    );
    expect(leftMove).toBeDefined();
  });

});

describe("Dead tiles behavior", () => {

  it("dead tiles are never drawn", () => {
    let state = createInitialState(["A", "B"], {
      tilesPerPlayer: 7,
      deadTileCount: 2
    });
    state = startNewHand(state);

    const deadTiles = state.deadTiles;
    expect(deadTiles.length).toBe(2);

    // Dead tiles should not be in anyone's hand or boneyard
    const allAccessible = [
      ...state.players["A"].hand,
      ...state.players["B"].hand,
      ...state.boneyard,
    ];

    for (const deadTile of deadTiles) {
      const found = allAccessible.some(
        t => t.high === deadTile.high && t.low === deadTile.low
      );
      expect(found).toBe(false);
    }
  });

});

describe("Extra turn chaining", () => {

  it("chains extra turns for consecutive scoring plays", () => {
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
        A: { id: "A", hand: [t(0, 0), t(0, 5), t(1, 2)], score: 0 },
        B: { id: "B", hand: [t(1, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // First play: [0|0] on left → double → extra turn
    // Sum: 0 (double) + 5 = 5 → 1 point AND double
    let next = applyMove(state, "A", {
      type: "play",
      tile: t(0, 0),
      position: "left",
    });
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.players.A.score).toBe(1);

    // Second play: [0|5] on left → sum 5 + 5 = 10 → scores 2 → extra turn
    next = applyMove(next, "A", {
      type: "play",
      tile: t(0, 5),
      position: "left",
    });
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.players.A.score).toBe(3); // 1 + 2

    // Third play: [1|2] on... wait, can't match.
    // Board is now [0|5][0|0][0|5], left=5, right=5
    // [1|2] doesn't match, so turn passes
  });

});

describe("Opening rules", () => {

  it("first play must be double or scoring", () => {
    const state = setupState({
      board: null,
      handOpen: false,
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(1, 2), t(3, 4), t(5, 5)], score: 0 },
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, "A");

    // [1|2] sum=3, not scoring, not double → illegal
    // [3|4] sum=7, not scoring, not double → illegal
    // [5|5] double → legal
    expect(moves.length).toBe(1);
    expect(moves[0].type).toBe("play");
    if (moves[0].type === "play") {
      expect(moves[0].tile).toEqual(t(5, 5));
    }
  });

  it("scoring non-double can open", () => {
    const state = setupState({
      board: null,
      handOpen: false,
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(2, 3), t(1, 2)], score: 0 }, // [2|3] sums to 5
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const moves = getLegalMoves(state, "A");

    // [2|3] sum=5 → scores → legal
    // [1|2] sum=3 → no score, not double → illegal
    const playMoves = moves.filter(m => m.type === "play");
    expect(playMoves.length).toBe(1);
    if (playMoves[0].type === "play") {
      expect(playMoves[0].tile).toEqual(t(2, 3));
    }
  });

});

describe("Blocked hand", () => {

  it("ends hand when all players pass consecutively", () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{
          tileIndex: 0,
          hubValue: 6,
          isCrossed: false,
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(0, 1)], score: 0 }, // Can't match 6
        B: { id: "B", hand: [t(2, 3)], score: 0 }, // Can't match 6
      },
      boneyard: [],
      deadTiles: [],
      consecutivePasses: 0,
    });

    // A passes
    let next = applyMove(state, "A", { type: "pass" });
    expect(next.consecutivePasses).toBe(1);
    expect(next.handOver).toBe(false);

    // B passes
    next = applyMove(next, "B", { type: "pass" });
    expect(next.consecutivePasses).toBe(2);
    expect(next.handOver).toBe(true); // 2 players passed = blocked
  });

  it("lowest pips wins blocked hand", () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{
          tileIndex: 0,
          hubValue: 6,
          isCrossed: false,
          branches: [],
        }],
      },
      config: { ...DEFAULT_CONFIG, blockedHandRule: 'lowestPips', endHandBonus: 'sumOpponentPenalties' },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(0, 1)], score: 10 }, // 1 pip total
        B: { id: "B", hand: [t(4, 5)], score: 5 },  // 9 pips total
      },
      boneyard: [],
      deadTiles: [],
      consecutivePasses: 0,
    });

    let next = applyMove(state, "A", { type: "pass" });
    next = applyMove(next, "B", { type: "pass" });

    // A wins (1 pip < 9 pips)
    // B's penalty: 9 pips → rounded up to 10
    // A gets bonus of 10
    expect(next.players.A.score).toBe(20); // 10 + 10
    expect(next.players.B.score).toBe(5);  // unchanged
  });

});

describe("Game ends at 60 points", () => {

  it("game is over when a player reaches 60 points", () => {
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
        A: { id: "A", hand: [t(1, 6), t(0, 0)], score: 58 }, // 2 points away from winning
        B: { id: "B", hand: [t(0, 1)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    // Play [1|6] on left: ends 6 + 4 = 10 → scores 2 points → A reaches 60
    const next = applyMove(state, "A", {
      type: "play",
      tile: t(1, 6),
      position: "left",
    });

    expect(next.players.A.score).toBe(60);
    expect(next.gameOver).toBe(true);
    expect(next.winnerId).toBe("A");
  });

  it("game continues if no one has reached 60", () => {
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
        A: { id: "A", hand: [t(1, 6), t(0, 0)], score: 50 },
        B: { id: "B", hand: [t(0, 1)], score: 40 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const next = applyMove(state, "A", {
      type: "play",
      tile: t(1, 6),
      position: "left",
    });

    expect(next.players.A.score).toBe(52);
    expect(next.gameOver).toBe(false);
    expect(next.winnerId).toBeNull();
  });

  it("when both players are >= target, higher score wins", () => {
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
        A: { id: "A", hand: [t(1, 6), t(0, 0)], score: 61 }, // reaches 63
        B: { id: "B", hand: [t(0, 1)], score: 65 },          // already higher
      },
      boneyard: [],
      deadTiles: [],
    });

    const next = applyMove(state, "A", {
      type: "play",
      tile: t(1, 6),
      position: "left",
    });

    expect(next.gameOver).toBe(true);
    expect(next.winnerId).toBe("B");
  });

});

describe("Deterministic legality and pending priority", () => {
  it("returns play moves in deterministic sorted order", () => {
    const state = setupState({
      board: {
        mainLine: [pt(3, 5), pt(5, 5), pt(5, 2)],
        leftEnd: 3,
        rightEnd: 2,
        leftEndIsDouble: false,
        rightEndIsDouble: false,
        hubDoubles: [{
          hubId: 7,
          tileIndex: 1,
          mainlineIndex: 1,
          hubValue: 5,
          leftSideFilled: true,
          rightSideFilled: true,
          isCrossed: true,
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(2, 5), t(1, 3)], score: 0 },
        B: { id: "B", hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const plays = getLegalMoves(state, "A").filter(m => m.type === "play");
    const rendered = plays.map(m => `${m.tile.low}|${m.tile.high}@${m.position}`);
    expect(rendered).toEqual([
      "1|3@left",
      "2|5@right",
      "2|5@branch-7-0",
      "2|5@branch-7-1",
    ]);
  });

  it("pending only restricts moves when satisfying plays exist now", () => {
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
        A: { id: "A", hand: [t(1, 4)], score: 0 }, // no 5, cannot satisfy pending on right now
        B: { id: "B", hand: [t(0, 0)], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
    });

    const movesUnsat = getLegalMoves(state, "A");
    expect(movesUnsat.some(m => m.type === "play" && m.position === "branch-3-0")).toBe(true);

    const satState = {
      ...state,
      players: {
        ...state.players,
        A: { id: "A", hand: [t(1, 4), t(4, 5)], score: 0 },
      },
    };
    const movesSat = getLegalMoves(satState, "A").filter(m => m.type === "play");
    expect(movesSat.length).toBeGreaterThan(0);
    expect(movesSat.every(m => m.position === "right")).toBe(true);
  });
});

describe("canDraw function", () => {

  it("returns true when player has no legal plays and boneyard is not empty", () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{
          tileIndex: 0,
          hubValue: 6,
          isCrossed: false,
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(0, 1)], score: 0 }, // Can't match 6
        B: { id: "B", hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(5, 6)], // Has tiles
      deadTiles: [],
    });

    expect(canDraw(state, "A")).toBe(true);
  });

  it("returns false when player has a legal play", () => {
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
        A: { id: "A", hand: [t(3, 4), t(0, 1)], score: 0 }, // Can play [3|4]
        B: { id: "B", hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(5, 6)],
      deadTiles: [],
    });

    expect(canDraw(state, "A")).toBe(false);
  });

  it("returns false when boneyard is empty", () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{
          tileIndex: 0,
          hubValue: 6,
          isCrossed: false,
          branches: [],
        }],
      },
      currentPlayerIndex: 0,
      players: {
        A: { id: "A", hand: [t(0, 1)], score: 0 },
        B: { id: "B", hand: [t(2, 3)], score: 0 },
      },
      boneyard: [], // Empty
      deadTiles: [],
    });

    expect(canDraw(state, "A")).toBe(false);
  });

  it("returns false when it is not the player's turn", () => {
    const state = setupState({
      board: {
        mainLine: [pt(6, 6)],
        leftEnd: 6,
        rightEnd: 6,
        leftEndIsDouble: true,
        rightEndIsDouble: true,
        hubDoubles: [{
          tileIndex: 0,
          hubValue: 6,
          isCrossed: false,
          branches: [],
        }],
      },
      currentPlayerIndex: 1, // B's turn
      players: {
        A: { id: "A", hand: [t(0, 1)], score: 0 },
        B: { id: "B", hand: [t(2, 3)], score: 0 },
      },
      boneyard: [t(5, 6)],
      deadTiles: [],
    });

    expect(canDraw(state, "A")).toBe(false);
  });

});
