import { supabaseFetch } from '../../supabaseUtils';
import type { PuzzleDayResult } from '../../puzzleRush/puzzleStatsSummary';
import { isMissingRelationError } from './homeCompletionDates';

/**
 * Day-level puzzle results for the `/stats` and profile "Daily Puzzle" blocks.
 *
 * Bounded to a year: streak / completion figures only ever need recent history
 * plus enough depth for an all-time best. See `puzzleStatsSummary.ts` for how
 * the three sources are combined.
 */
const SCAN_LIMIT = 365;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function toDayResults(
  rows: Array<Record<string, unknown>>,
  dateField: string,
  scoreField: string,
): PuzzleDayResult[] {
  const out: PuzzleDayResult[] = [];
  for (const row of rows) {
    const raw = row[dateField];
    const date = typeof raw === 'string' ? raw.slice(0, 10) : '';
    if (!DAY_KEY.test(date)) continue;
    const scoreRaw = row[scoreField];
    const score = typeof scoreRaw === 'number' && Number.isFinite(scoreRaw) ? scoreRaw : null;
    out.push({ date, score });
  }
  return out;
}

/** Completed Puzzle Rush runs (`rush_runs`), current era. */
export async function listPuzzleRushDayResultsForUser(userId: string): Promise<PuzzleDayResult[]> {
  try {
    const rows = await supabaseFetch<Array<Record<string, unknown>>>(
      `/rest/v1/rush_runs?select=run_date,total_score&user_id=eq.${encodeURIComponent(userId)}` +
        `&status=eq.completed&run_date=not.is.null&order=run_date.desc&limit=${SCAN_LIMIT}`,
      { method: 'GET' },
    );
    return toDayResults(rows, 'run_date', 'total_score');
  } catch (error) {
    if (isMissingRelationError(error, 'rush_runs')) return [];
    throw error;
  }
}

/**
 * Frozen Ladder-era attempts (`daily_puzzle_attempts`). Read-only historical
 * data — never written again — so a player's pre-Rush completions and bests
 * carry forward. Matches `listCompletedDailyPuzzleLadderDatesForUser`'s filter.
 */
export async function listLegacyDailyPuzzleDayResultsForUser(userId: string): Promise<PuzzleDayResult[]> {
  try {
    const rows = await supabaseFetch<Array<Record<string, unknown>>>(
      `/rest/v1/daily_puzzle_attempts?select=puzzle_date,total_score&user_id=eq.${encodeURIComponent(userId)}` +
        `&puzzles_completed=gte.1&order=puzzle_date.desc&limit=${SCAN_LIMIT}`,
      { method: 'GET' },
    );
    return toDayResults(rows, 'puzzle_date', 'total_score');
  } catch (error) {
    if (isMissingRelationError(error, 'daily_puzzle_attempts')) return [];
    throw error;
  }
}
