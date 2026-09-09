/**
 * Canonical "Daily Puzzle" statistics shown on `/stats` and `/players/:username`.
 *
 * Puzzle Rush *became* the Daily Puzzle on 2026-08-20 and writes to `rush_runs`.
 * Both surfaces used to read the retired Ladder's tables — one of which
 * (`daily_puzzle_completions`) no longer exists in production, so a guaranteed
 * 404 was silently swallowed and every user's streak / completions read 0
 * forever (FEATURE_COMPLETENESS_AUDIT.md P1-1).
 *
 * Source of truth is `rush_runs`, unioned with the two frozen Ladder-era tables
 * for history — the same additive union `/api/home/daily-summary` already uses,
 * so a streak in flight when Rush shipped carries across the boundary without a
 * gap. `rush_runs` has deny-all RLS, so this must be computed server-side.
 */

export interface PuzzleDayResult {
  /** `YYYY-MM-DD` (Pacific calendar day). */
  date: string;
  /** Run/attempt score. `rush_runs.total_score` and the Ladder's
   *  `daily_puzzle_attempts.total_score` share a comparable scale. */
  score: number | null;
}

export interface PuzzleStatsSummary {
  /** Distinct calendar days with at least one completed puzzle, any era. */
  completions: number;
  /** Consecutive completed days ending today (or yesterday if today is open). */
  currentStreak: number;
  /** Longest run of consecutive completed days, any era. */
  bestStreak: number;
  /** Distinct completed days within the last 7 calendar days, today included. */
  completionsThisWeek: number;
  /** Best Puzzle Rush score recorded today, or null if none today. */
  bestScoreToday: number | null;
  /** Best score ever recorded, across Rush and frozen Ladder history. */
  bestScoreEver: number | null;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateKey: string, deltaDays: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function buildPuzzleStatsSummary(input: {
  /** Today's Pacific calendar day (`YYYY-MM-DD`). */
  todayDateKey: string;
  /** Completed Puzzle Rush runs (`rush_runs`, status = completed). */
  rushDays: PuzzleDayResult[];
  /** Completed Ladder-era attempts (`daily_puzzle_attempts`, frozen history). */
  legacyDays: PuzzleDayResult[];
}): PuzzleStatsSummary {
  const { todayDateKey } = input;
  const rushDays = input.rushDays.filter((r) => DAY_KEY.test(r.date));
  const legacyDays = input.legacyDays.filter((r) => DAY_KEY.test(r.date));

  const completedDays = new Set<string>();
  for (const row of [...rushDays, ...legacyDays]) completedDays.add(row.date);

  const completions = completedDays.size;

  // Streak: anchor on today if complete, else yesterday, then walk back.
  let currentStreak = 0;
  const yesterdayKey = addDays(todayDateKey, -1);
  const anchor = completedDays.has(todayDateKey)
    ? todayDateKey
    : completedDays.has(yesterdayKey)
      ? yesterdayKey
      : null;
  if (anchor) {
    let cursor = anchor;
    while (completedDays.has(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }
  }

  // Longest consecutive run across all completed days.
  let bestStreak = 0;
  const sortedDays = [...completedDays].sort();
  let runLength = 0;
  let prevDay: string | null = null;
  for (const day of sortedDays) {
    runLength = prevDay != null && addDays(prevDay, 1) === day ? runLength + 1 : 1;
    if (runLength > bestStreak) bestStreak = runLength;
    prevDay = day;
  }

  const weekFloor = addDays(todayDateKey, -6);
  let completionsThisWeek = 0;
  for (const day of completedDays) {
    if (day >= weekFloor && day <= todayDateKey) completionsThisWeek += 1;
  }

  const scoreOf = (row: PuzzleDayResult): number | null =>
    typeof row.score === 'number' && Number.isFinite(row.score) ? row.score : null;

  const allScores = [...rushDays, ...legacyDays]
    .map(scoreOf)
    .filter((s): s is number => s != null);
  const bestScoreEver = allScores.length > 0 ? Math.max(...allScores) : null;

  const todayScores = rushDays
    .filter((r) => r.date === todayDateKey)
    .map(scoreOf)
    .filter((s): s is number => s != null);
  const bestScoreToday = todayScores.length > 0 ? Math.max(...todayScores) : null;

  return {
    completions,
    currentStreak,
    bestStreak,
    completionsThisWeek,
    bestScoreToday,
    bestScoreEver,
  };
}
