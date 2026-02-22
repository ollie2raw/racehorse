import type { BoardState, PlacedTile, Tile } from "../types";

export interface DailyPuzzleObjective {
  type: "GO_OUT_IN_MOVES";
  maxMoves?: number;
}

export interface DailyPuzzle {
  id: string;
  dateSeed?: string;
  title: string;
  description: string;
  initialBoard: BoardState;
  playerHand: Tile[];
  objective: DailyPuzzleObjective;
}

function t(low: number, high: number): Tile {
  return { low, high };
}

function p(low: number, high: number, orientation: PlacedTile["orientation"] = "horizontal-normal"): PlacedTile {
  return {
    tile: t(low, high),
    orientation,
  };
}

function board(mainLine: PlacedTile[], leftEnd: number, rightEnd: number): BoardState {
  return {
    mainLine,
    leftEnd,
    rightEnd,
    leftEndIsDouble: leftEnd === rightEnd && mainLine.length === 1,
    rightEndIsDouble: leftEnd === rightEnd && mainLine.length === 1,
    hubDoubles: [],
  };
}

export const DAILY_PUZZLES: DailyPuzzle[] = [
  {
    id: "p1",
    title: "Opening Thread",
    description: "Go out quickly from a simple two-end board.",
    initialBoard: board([p(0, 2), p(2, 4)], 0, 4),
    playerHand: [t(0, 5), t(4, 6), t(5, 6), t(0, 1)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p2",
    title: "Cross the Ends",
    description: "Use both ends efficiently.",
    initialBoard: board([p(1, 3), p(3, 5)], 1, 5),
    playerHand: [t(1, 1), t(1, 6), t(5, 6), t(2, 5)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p3",
    title: "Tight Run",
    description: "Small hand, exact sequence matters.",
    initialBoard: board([p(2, 3), p(3, 4)], 2, 4),
    playerHand: [t(2, 2), t(2, 6), t(4, 6)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 3 },
  },
  {
    id: "p4",
    title: "Long Side",
    description: "Stretch the left side first.",
    initialBoard: board([p(0, 6), p(5, 6)], 0, 5),
    playerHand: [t(0, 3), t(3, 3), t(3, 5), t(1, 5)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p5",
    title: "Middle Numbers",
    description: "Work the center pips cleanly.",
    initialBoard: board([p(1, 2), p(2, 2), p(2, 5)], 1, 5),
    playerHand: [t(1, 4), t(4, 4), t(4, 5), t(0, 1)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p6",
    title: "Short Ladder",
    description: "Keep the chain moving on both ends.",
    initialBoard: board([p(0, 1), p(1, 4)], 0, 4),
    playerHand: [t(0, 0), t(0, 6), t(4, 6), t(2, 4)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p7",
    title: "Edge Builder",
    description: "Build from the right endpoint.",
    initialBoard: board([p(2, 6), p(6, 6), p(4, 6)], 2, 4),
    playerHand: [t(2, 5), t(5, 5), t(4, 5), t(1, 2)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p8",
    title: "Simple Finish",
    description: "Find the shortest path to empty hand.",
    initialBoard: board([p(3, 4), p(4, 6)], 3, 6),
    playerHand: [t(3, 3), t(3, 5), t(5, 6)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 3 },
  },
  {
    id: "p9",
    title: "Around the Corner",
    description: "Alternate endpoints to keep options open.",
    initialBoard: board([p(0, 4), p(4, 5)], 0, 5),
    playerHand: [t(0, 2), t(2, 2), t(2, 5), t(1, 5)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 4 },
  },
  {
    id: "p10",
    title: "Final Push",
    description: "Use all five tiles with no wasted moves.",
    initialBoard: board([p(1, 6), p(2, 6), p(2, 3)], 1, 3),
    playerHand: [t(1, 4), t(3, 4), t(0, 1), t(0, 5), t(3, 5)],
    objective: { type: "GO_OUT_IN_MOVES", maxMoves: 5 },
  },
];
