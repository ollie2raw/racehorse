import type { BoardState, Tile } from "../types";
import { supabase } from "../lib/supabase";
import type { CuratedDailyPuzzle, CuratedDailyPuzzleRow, DailyPuzzleType } from "./types";
import { getLocalDateKey, normalizeDateInputToLocalKey } from "./date";

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== "object") return false;
  const v = value as { low?: unknown; high?: unknown };
  return Number.isInteger(v.low) && Number.isInteger(v.high);
}

function normalizePlacement(
  value: unknown,
  defaultOrientation: "horizontal-normal" | "vertical-normal"
): { tile: Tile; orientation: string } | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;

  if (isTile(rec.tile) && typeof rec.orientation === "string") {
    return { tile: rec.tile, orientation: rec.orientation };
  }

  if (Number.isInteger(rec.left) && Number.isInteger(rec.right)) {
    return {
      tile: { low: Number(rec.left), high: Number(rec.right) },
      orientation: defaultOrientation,
    };
  }

  return null;
}

function isBoardState(value: unknown): value is BoardState {
  if (!value || typeof value !== "object") return false;
  const board = value as BoardState;

  const placementsValid = Array.isArray(board.mainLine)
    && board.mainLine.every((placement) => Boolean(placement) && isTile(placement.tile) && typeof placement.orientation === "string");
  const hubsValid = Array.isArray(board.hubDoubles)
    && board.hubDoubles.every((hub) => Array.isArray(hub.branches)
      && hub.branches.every((branch) => Array.isArray(branch.tiles)
        && branch.tiles.every((placement) => Boolean(placement) && isTile(placement.tile) && typeof placement.orientation === "string")));

  return placementsValid
    && typeof board.leftEnd === "number"
    && typeof board.rightEnd === "number"
    && typeof board.leftEndIsDouble === "boolean"
    && typeof board.rightEndIsDouble === "boolean"
    && hubsValid;
}

function normalizeBoardState(raw: unknown): BoardState | null {
  if (!raw || typeof raw !== "object") return null;
  const board = raw as Record<string, unknown>;

  if (
    !Array.isArray(board.mainLine)
    || typeof board.leftEnd !== "number"
    || typeof board.rightEnd !== "number"
    || typeof board.leftEndIsDouble !== "boolean"
    || typeof board.rightEndIsDouble !== "boolean"
    || !Array.isArray(board.hubDoubles)
  ) {
    return null;
  }

  const mainLine = board.mainLine
    .map((placement) => normalizePlacement(placement, "horizontal-normal"));
  if (mainLine.some((placement) => !placement)) return null;

  const hubDoubles = board.hubDoubles.map((hubRaw) => {
    if (!hubRaw || typeof hubRaw !== "object") return null;
    const hub = hubRaw as Record<string, unknown>;
    if (!Array.isArray(hub.branches)) return null;

    const branches = hub.branches.map((branchRaw) => {
      if (!branchRaw || typeof branchRaw !== "object") return null;
      const branch = branchRaw as Record<string, unknown>;
      if (!Array.isArray(branch.tiles)) return null;
      const tiles = branch.tiles.map((placement) => normalizePlacement(placement, "vertical-normal"));
      if (tiles.some((placement) => !placement)) return null;
      return {
        ...branch,
        tiles: tiles as { tile: Tile; orientation: string }[],
      };
    });

    if (branches.some((branch) => !branch)) return null;
    return {
      ...hub,
      branches: branches as BoardState["hubDoubles"][number]["branches"],
    } as BoardState["hubDoubles"][number];
  });

  if (hubDoubles.some((hub) => !hub)) return null;

  const normalized: BoardState = {
    mainLine: mainLine as BoardState["mainLine"],
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubDoubles: hubDoubles as BoardState["hubDoubles"],
  };

  return isBoardState(normalized) ? normalized : null;
}

function coercePuzzleRow(row: CuratedDailyPuzzleRow): CuratedDailyPuzzle {
  const board = normalizeBoardState(row.starting_board);
  if (!board) {
    throw new Error(
      "Invalid puzzle: starting_board must include valid placements (tile {low,high} + orientation) in mainLine and hub branches."
    );
  }

  if (!Array.isArray(row.starting_hand) || !row.starting_hand.every(isTile)) {
    throw new Error("Invalid puzzle: starting_hand must be an array of tiles.");
  }

  if (board.mainLine.some((placement) => !placement?.tile || !isTile(placement.tile))) {
    throw new Error("Invalid puzzle: every mainLine placement must include tile {low,high}.");
  }

  const puzzleTypeRaw = row.puzzle_type;
  const puzzleType: DailyPuzzleType =
    puzzleTypeRaw === "reach_target" || puzzleTypeRaw === "one_turn_high_score"
      ? puzzleTypeRaw
      : "one_turn_high_score";
  const dealSize = typeof row.deal_size === "number" && Number.isFinite(row.deal_size) ? row.deal_size : 7;

  return {
    id: row.id,
    puzzleDate: row.puzzle_date,
    title: row.title?.trim() || "Daily Puzzle",
    startingBoard: board,
    startingHand: row.starting_hand,
    maxMoves: row.max_moves,
    targetScore: row.target_score,
    puzzleType,
    dealSize,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms. Try again.`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

export async function getDailyPuzzleForDate(date: Date): Promise<CuratedDailyPuzzle | null> {
  if (!supabase) return null;

  const seed = getLocalDateKey(date);
  const t0 = performance.now();
  const { data, error } = await withTimeout(
    (async () =>
      await supabase
        .from("daily_puzzles")
        .select("id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, puzzle_type, deal_size, created_at")
        .eq("puzzle_date", seed)
        .maybeSingle())(),
    8000
  );
  const ms = Math.round(performance.now() - t0);
  // eslint-disable-next-line no-console
  console.log("[DailyPuzzle] select finished", { ms, seed, error, hasData: Boolean(data) });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return coercePuzzleRow(data as CuratedDailyPuzzleRow);
}

export async function getDailyPuzzleByDateSeed(dateSeed: string): Promise<CuratedDailyPuzzle | null> {
  if (!supabase) return null;

  const canonicalDate = normalizeDateInputToLocalKey(dateSeed);
  const t0 = performance.now();
  const { data, error } = await withTimeout(
    (async () =>
      await supabase
        .from("daily_puzzles")
        .select("id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, puzzle_type, deal_size, created_at")
        .eq("puzzle_date", canonicalDate)
        .maybeSingle())(),
    8000
  );
  const ms = Math.round(performance.now() - t0);
  // eslint-disable-next-line no-console
  console.log("[DailyPuzzleAdmin] select finished", { ms, canonicalDate, error, hasData: Boolean(data) });

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
  puzzleType: DailyPuzzleType;
  dealSize: number;
}

export async function upsertDailyPuzzle(input: UpsertPuzzleInput): Promise<void> {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const canonicalDate = normalizeDateInputToLocalKey(input.puzzleDate);
  const t0 = performance.now();
  const { error } = await withTimeout(
    (async () =>
      await supabase
        .from("daily_puzzles")
        .upsert(
          {
            puzzle_date: canonicalDate,
            title: input.title,
            starting_board: input.startingBoard,
            starting_hand: input.startingHand,
            max_moves: input.maxMoves,
            target_score: input.targetScore,
            puzzle_type: input.puzzleType,
            deal_size: input.dealSize,
          },
          { onConflict: "puzzle_date" }
        ))(),
    20000
  );
  const ms = Math.round(performance.now() - t0);
  // eslint-disable-next-line no-console
  console.log("[DailyPuzzleAdmin] upsert finished", { ms, canonicalDate, error });

  if (error) {
    throw new Error(error.message);
  }
}

export { getLocalDateKey, normalizeDateInputToLocalKey };
