import type { BoardState, Tile } from "../types";

export interface CuratedDailyPuzzleRow {
  id: string;
  puzzle_date: string;
  title: string | null;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number;
  target_score: number;
  created_at: string;
}

export interface CuratedDailyPuzzle {
  id: string;
  puzzleDate: string;
  title: string;
  startingBoard: BoardState;
  startingHand: Tile[];
  maxMoves: number;
  targetScore: number;
}

export interface PuzzleValidationResult {
  solvable: boolean;
  bestScore: number;
  hasScoringMove: boolean;
  exploredStates: number;
  reason: string;
}
