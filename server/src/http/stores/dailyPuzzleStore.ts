import { supabaseFetch } from '../../supabaseUtils';

/**
 * The furthest-out `puzzle_date` that has a published `daily_puzzles` row, or
 * null if the table has no published rows at all. Used by
 * `/ready.checks.dailyPuzzleGeneration` to detect a stalled generation pipeline.
 */
export async function getFurthestPublishedDailyPuzzleDate(): Promise<string | null> {
  const rows = await supabaseFetch<Array<{ puzzle_date: string }>>(
    `/rest/v1/daily_puzzles?select=puzzle_date&published=eq.true&order=puzzle_date.desc&limit=1`,
    { method: 'GET' },
  );
  return rows[0]?.puzzle_date ?? null;
}

export async function getUsernameForUserId(userId: string): Promise<string | null> {
  const profileRows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const username = profileRows[0]?.username?.trim();
  return username || null;
}
