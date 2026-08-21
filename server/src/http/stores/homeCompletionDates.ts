import { supabaseFetch } from '../../supabaseUtils';

/**
 * The home summary renders a seven-day strip plus a streak, and a streak ends at
 * the first gap. Only recent days can contribute, so these reads are bounded
 * well below the 365 rows they previously fetched from each of four tables on
 * every home page load.
 */
const COMPLETION_SCAN_LIMIT = 90;

export function isMissingRelationError(error: unknown, relationName: string): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes(relationName.toLowerCase()) && (message.includes('does not exist') || message.includes('could not find'));
}

export async function listCompletedDailyFritzDatesForUser(userId: string): Promise<string[]> {
  const rows = await supabaseFetch<Array<{ run_date: string | null }>>(
    `/rest/v1/daily_fritz_attempts?select=run_date&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=run_date.desc&limit=${COMPLETION_SCAN_LIMIT}`,
    { method: 'GET' },
  );
  return Array.from(
    new Set(
      rows
        .map((row) => row.run_date)
        .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  );
}

export async function listCompletedDailyPuzzleLadderDatesForUser(userId: string): Promise<string[]> {
  const rows = await supabaseFetch<Array<{ puzzle_date: string | null }>>(
    `/rest/v1/daily_puzzle_attempts?select=puzzle_date&user_id=eq.${encodeURIComponent(userId)}&puzzles_completed=gte.1&order=puzzle_date.desc&limit=${COMPLETION_SCAN_LIMIT}`,
    { method: 'GET' },
  );
  return Array.from(
    new Set(
      rows
        .map((row) => row.puzzle_date)
        .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  );
}

/**
 * Days this user completed a Puzzle Rush run.
 *
 * Deliberately **not** filtered on `is_official`: the streak counts *any*
 * completed run that day, so abandoning a first attempt and finishing a later
 * one the same day still keeps a streak alive. `is_official` governs the daily
 * leaderboard, not the streak.
 *
 * This is the third source unioned into the puzzle streak. The other two
 * (`daily_puzzle_attempts`, `daily_puzzle_completions`) are frozen history and
 * are never written again — a player's existing streak carries forward
 * untouched, and new days arrive here. Tolerates a missing relation the same
 * way the legacy source does, so a server running ahead of the migration
 * degrades to "no rush days yet" instead of failing the whole summary.
 */
export async function listCompletedPuzzleRushDatesForUser(userId: string): Promise<string[]> {
  try {
    const rows = await supabaseFetch<Array<{ run_date: string | null }>>(
      `/rest/v1/rush_runs?select=run_date&user_id=eq.${encodeURIComponent(userId)}` +
        `&status=eq.completed&run_date=not.is.null&order=run_date.desc&limit=${COMPLETION_SCAN_LIMIT}`,
      { method: 'GET' },
    );
    return Array.from(
      new Set(
        rows
          .map((row) => row.run_date)
          .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      ),
    );
  } catch (error) {
    if (isMissingRelationError(error, 'rush_runs')) return [];
    throw error;
  }
}

export async function listCompletedLegacyDailyPuzzleDatesForUser(userId: string): Promise<string[]> {
  try {
    const rows = await supabaseFetch<Array<{ puzzle_date: string | null }>>(
      `/rest/v1/daily_puzzle_completions?select=puzzle_date&user_id=eq.${encodeURIComponent(userId)}&order=puzzle_date.desc&limit=${COMPLETION_SCAN_LIMIT}`,
      { method: 'GET' },
    );
    return Array.from(
      new Set(
        rows
          .map((row) => row.puzzle_date)
          .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      ),
    );
  } catch (error) {
    if (isMissingRelationError(error, 'daily_puzzle_completions')) return [];
    throw error;
  }
}
