import type { BoardState, Tile } from '../types';

export type DailyPuzzleType =
  | 'reach_target'
  | 'one_turn_high_score'
  | 'setup_and_strike'
  | 'branch_mastery';

export interface CuratedDailyPuzzleRow {
  id: string;
  puzzle_date: string;
  title: string | null;
  starting_board: unknown;
  starting_hand: unknown;
  max_moves: number;
  target_score: number;
  puzzle_type: string | null;
  deal_size: number | null;
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
  puzzleType: DailyPuzzleType;
  dealSize: number;
}

export interface PuzzleValidationResult {
  solvable: boolean;
  bestScore: number;
  hasScoringMove: boolean;
  exploredStates: number;
  reason: string;
}
