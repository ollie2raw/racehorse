/** Rows from `matches` with fields needed to mirror client `buildStatsSummary` online streak. */
export type OnlineMatchStreakRow = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  mode: string;
  created_at: string;
};

/**
 * Consecutive online wins from the most recent online match backward, same as
 * `buildStatsSummary` in `client/src/stats/statsApi.ts`.
 */
export function computeOnlineCurrentWinStreak(userId: string, rows: OnlineMatchStreakRow[]): number {
  const onlineRows = rows
    .filter((row) => row.mode === 'online')
    .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());

  let currentWinStreak = 0;
  for (let i = onlineRows.length - 1; i >= 0; i--) {
    const match = onlineRows[i];
    if (match.winner_user_id === userId) {
      currentWinStreak += 1;
      continue;
    }
    if (match.loser_user_id === userId) break;
  }
  return currentWinStreak;
}
