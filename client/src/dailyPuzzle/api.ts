import type { BoardState, Tile } from "../types";
import { supabase } from "../lib/supabase";
import type { CuratedDailyPuzzle, CuratedDailyPuzzleRow } from "./types";

function localDateSeed(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== "object") return false;
  const v = value as { low?: unknown; high?: unknown };
  return Number.isInteger(v.low) && Number.isInteger(v.high);
}

function isBoardState(value: unknown): value is BoardState {
  if (!value || typeof value !== "object") return false;
  const board = value as Partial<BoardState>;
  return (
    Array.isArray(board.mainLine) &&
    typeof board.leftEnd === "number" &&
    typeof board.rightEnd === "number" &&
    typeof board.leftEndIsDouble === "boolean" &&
    typeof board.rightEndIsDouble === "boolean" &&
    Array.isArray(board.hubDoubles)
  );
}

function coercePuzzleRow(row: CuratedDailyPuzzleRow): CuratedDailyPuzzle {
  if (!isBoardState(row.starting_board)) {
    throw new Error("Invalid puzzle: starting_board must be a valid board state JSON.");
  }

  if (!Array.isArray(row.starting_hand) || !row.starting_hand.every(isTile)) {
    throw new Error("Invalid puzzle: starting_hand must be an array of tiles.");
  }

  return {
    id: row.id,
    puzzleDate: row.puzzle_date,
    title: row.title?.trim() || "Daily Puzzle",
    startingBoard: row.starting_board,
    startingHand: row.starting_hand,
    maxMoves: row.max_moves,
    targetScore: row.target_score,
  };
}

export async function getDailyPuzzleForDate(date: Date): Promise<CuratedDailyPuzzle | null> {
  if (!supabase) return null;

  const seed = localDateSeed(date);
  const { data, error } = await supabase
    .from("daily_puzzles")
    .select("id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, created_at")
    .eq("puzzle_date", seed)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return coercePuzzleRow(data as CuratedDailyPuzzleRow);
}

export async function getDailyPuzzleByDateSeed(dateSeed: string): Promise<CuratedDailyPuzzle | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("daily_puzzles")
    .select("id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, created_at")
    .eq("puzzle_date", dateSeed)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return coercePuzzleRow(data as CuratedDailyPuzzleRow);
}

export interface UpsertPuzzleInput {
  puzzleDate: string;
  title: string;
  startingBoard: BoardState;
  startingHand: Tile[];
  maxMoves: number;
  targetScore: number;
}

export async function upsertDailyPuzzle(input: UpsertPuzzleInput): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const { error } = await supabase
    .from("daily_puzzles")
    .upsert(
      {
        puzzle_date: input.puzzleDate,
        title: input.title,
        starting_board: input.startingBoard,
        starting_hand: input.startingHand,
        max_moves: input.maxMoves,
        target_score: input.targetScore,
      },
      { onConflict: "puzzle_date" }
    );

  if (error) {
    throw new Error(error.message);
  }
}

export { localDateSeed };
