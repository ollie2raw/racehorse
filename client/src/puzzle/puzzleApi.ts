import type { User } from "@supabase/supabase-js";
import type { BoardState, PlacedTile, Tile } from "../types";
import { supabase } from "../lib/supabase";

export type DailyObjective =
  | { type: "finish_in_moves"; maxMoves: number }
  | { type: "win_hand" };

export interface DailyPuzzleConfig {
  startingHand: Tile[];
  startingBoard: BoardState | PlacedTile[] | null;
  startingTurn?: "you";
  objective: DailyObjective;
  notes?: string;
}

export interface DailyPuzzle {
  id: string;
  puzzle_date: string;
  title: string;
  seed: string | null;
  config: DailyPuzzleConfig;
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  moves: number;
  milliseconds: number;
  solved: boolean;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("Request timed out. Try again.")), timeoutMs);
    promise.then((v) => {
      clearTimeout(id);
      resolve(v);
    }).catch((err) => {
      clearTimeout(id);
      reject(err);
    });
  });
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayPuzzle(): Promise<DailyPuzzle | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("daily_puzzles")
          .select("id, puzzle_date, title, seed, config")
          .eq("puzzle_date", todayUtcDate())
          .maybeSingle()
      )
    );
    if (error || !data) return null;
    return data as DailyPuzzle;
  } catch {
    return null;
  }
}

export async function submitPuzzleResult(
  puzzleId: string,
  user: User,
  payload: { moves: number; milliseconds: number; solved: boolean; attemptHash?: string }
): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Supabase not configured." };

  try {
    const { error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("daily_puzzle_submissions")
          .upsert(
            {
              puzzle_id: puzzleId,
              user_id: user.id,
              moves: payload.moves,
              milliseconds: payload.milliseconds,
              solved: payload.solved,
              attempt_hash: payload.attemptHash ?? null,
            },
            { onConflict: "puzzle_id,user_id" }
          )
      )
    );

    return { error: error?.message ?? null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unable to submit puzzle result." };
  }
}

export async function getTodayLeaderboard(puzzleId: string): Promise<LeaderboardRow[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("daily_puzzle_submissions")
          .select("user_id, moves, milliseconds, solved")
          .eq("puzzle_id", puzzleId)
          .eq("solved", true)
          .order("moves", { ascending: true })
          .order("milliseconds", { ascending: true })
          .limit(20)
      )
    );

    if (error || !data) return [];

    const userIds = [...new Set(data.map((row) => row.user_id as string))];
    let usernameMap = new Map<string, string>();

    if (userIds.length > 0) {
      const profileResp = await withTimeout(
        Promise.resolve(
          supabase
            .from("profiles")
            .select("id, username")
            .in("id", userIds)
        )
      );

      if (!profileResp.error && profileResp.data) {
        usernameMap = new Map((profileResp.data as Array<{ id: string; username: string }>).map((p) => [p.id, p.username]));
      }
    }

    return data.map((row) => {
      const uid = row.user_id as string;
      return {
        userId: uid,
        username: usernameMap.get(uid) ?? `user_${uid.slice(0, 8)}`,
        moves: row.moves as number,
        milliseconds: row.milliseconds as number,
        solved: row.solved as boolean,
      };
    });
  } catch {
    return [];
  }
}
