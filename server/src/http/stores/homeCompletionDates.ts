import { supabaseFetch } from '../../supabaseUtils';

export function isMissingRelationError(error: unknown, relationName: string): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes(relationName.toLowerCase()) && (message.includes('does not exist') || message.includes('could not find'));
}

export async function listCompletedDailyFritzDatesForUser(userId: string): Promise<string[]> {
  const rows = await supabaseFetch<Array<{ run_date: string | null }>>(
    `/rest/v1/daily_fritz_attempts?select=run_date&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=run_date.desc&limit=365`,
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
    `/rest/v1/daily_puzzle_attempts?select=puzzle_date&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=puzzle_date.desc&limit=365`,
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

export async function listCompletedLegacyDailyPuzzleDatesForUser(userId: string): Promise<string[]> {
  try {
    const rows = await supabaseFetch<Array<{ puzzle_date: string | null }>>(
      `/rest/v1/daily_puzzle_completions?select=puzzle_date&user_id=eq.${encodeURIComponent(userId)}&order=puzzle_date.desc&limit=365`,
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
