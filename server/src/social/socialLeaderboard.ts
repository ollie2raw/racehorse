import type { Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds } from './socialAuth';
import { dedupeMatchRows } from '../stats/dedupeMatchRows';

/**
 * Online win counts for a set of users, in one round-trip.
 *
 * This replaced a per-user loop that issued one request each and read `.length`
 * off the full row set — for a 20-friend board, 21 requests against a table
 * with no index on winner_user_id.
 *
 * Still reads one row per win rather than a count: PostgREST cannot GROUP BY
 * without an RPC, and `Prefer: count=exact` yields a single total rather than a
 * count per user. Only the grouping column is selected, so the payload is as
 * small as a row-returning query can be. If match volume grows enough for this
 * to matter, the next step is a `count_online_wins(user_ids uuid[])` RPC.
 *
 * SA-1 (HARDENING_PLAN.md §11.3): both participants' clients record the same
 * real online match, so `matches` carries two rows per game — `dedupeMatchRows`
 * (already used by `rivalService.ts`/`socialProfile.ts` for the same reason)
 * collapses them before counting, so a real win isn't counted twice here.
 */
async function countOnlineWinsByUser(userIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(userIds.map((id) => [id, 0]));
  if (!userIds.length) return counts;
  const inClause = userIds.map((id) => `"${id}"`).join(',');
  try {
    const rows = await supabaseFetch<Array<{
      winner_user_id: string | null;
      loser_user_id: string | null;
      winner_score: number | null;
      loser_score: number | null;
      created_at: string;
      room_code: string | null;
    }>>(
      `/rest/v1/matches?winner_user_id=in.(${encodeURIComponent(inClause)})` +
      '&mode=eq.online&select=winner_user_id,loser_user_id,winner_score,loser_score,created_at,room_code',
    );
    for (const row of dedupeMatchRows(rows)) {
      if (!row.winner_user_id) continue;
      const current = counts.get(row.winner_user_id);
      if (current !== undefined) counts.set(row.winner_user_id, current + 1);
    }
  } catch {
    // Match history unavailable — report zeroes rather than failing the board.
  }
  return counts;
}

type WeeklyRow = {
  userId: string;
  username: string;
  glicko_rating: number;
  provisional: boolean;
  wins_this_week: number;
  rank: number;
};

/**
 * The weekly board is identical for every caller — only `is_self` varies — so
 * the aggregate is built once and stamped per request. Without this, every
 * visitor re-read up to 10,000 match rows and re-tallied them.
 */
const WEEKLY_TTL_MS = 60_000;
let weeklyCache: { expiresAt: number; rows: WeeklyRow[] } | null = null;

/**
 * Exposed for tests only.
 *
 * Deliberately *not* wired to the match-write path. Write-through invalidation
 * would defeat this cache precisely when it matters: under heavy match volume —
 * the only regime where re-reading 10,000 rows per request actually hurts —
 * every write would clear it, leaving it cold almost always. A fixed TTL bounds
 * how often the expensive read runs regardless of write rate, which is the
 * property a leaderboard cache should have. The cost is a board up to
 * WEEKLY_TTL_MS behind on a seven-day win rollup, which is immaterial.
 */
export function invalidateWeeklyLeaderboard(): void {
  weeklyCache = null;
}

async function buildWeeklyLeaderboard(): Promise<WeeklyRow[]> {
  const now = Date.now();
  if (weeklyCache && weeklyCache.expiresAt > now) return weeklyCache.rows;

  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rawMatches = await supabaseFetch<Array<{
    winner_user_id: string | null;
    loser_user_id: string | null;
    winner_score: number | null;
    loser_score: number | null;
    created_at: string;
    room_code: string | null;
  }>>(
    `/rest/v1/matches?mode=eq.online&created_at=gte.${encodeURIComponent(weekAgo)}` +
    '&select=winner_user_id,loser_user_id,winner_score,loser_score,created_at,room_code&limit=10000',
  );
  // SA-1 (HARDENING_PLAN.md §11.3): dedupe before counting, same reason as
  // countOnlineWinsByUser above — both participants' clients record one row
  // each for the same real match.
  const matches = dedupeMatchRows(rawMatches);
  const winCounts = new Map<string, number>();
  for (const m of matches) {
    if (m.winner_user_id) winCounts.set(m.winner_user_id, (winCounts.get(m.winner_user_id) ?? 0) + 1);
  }
  if (!winCounts.size) {
    weeklyCache = { expiresAt: now + WEEKLY_TTL_MS, rows: [] };
    return [];
  }

  const topIds = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
  const profileFilter = topIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
  const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number; provisional: boolean }>>(
    `/rest/v1/profiles?or=(${profileFilter})&select=id,username,glicko_rating,provisional`,
  );
  const rows: WeeklyRow[] = profiles
    .map((p) => ({
      userId: p.id,
      username: p.username,
      glicko_rating: Number(p.glicko_rating ?? 800),
      provisional: Boolean(p.provisional),
      wins_this_week: winCounts.get(p.id) ?? 0,
    }))
    .sort((a, b) => b.wins_this_week - a.wins_this_week)
    .map((p, i) => ({ ...p, rank: i + 1 }));

  weeklyCache = { expiresAt: now + WEEKLY_TTL_MS, rows };
  return rows;
}

export async function respondLeaderboardGlobal(userId: string, res: Response): Promise<void> {
  try {
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number;
      ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc` +
      `&select=id,username,glicko_rating,ranked_games_played,provisional&limit=100`,
    );
    const topRows = profiles.map((p, i) => ({
      userId: p.id, username: p.username,
      glicko_rating: Number(p.glicko_rating ?? 800),
      ranked_games_played: Number(p.ranked_games_played ?? 0),
      provisional: false, global_rank: i + 1, is_self: p.id === userId,
    }));
    let selfEntry = topRows.find((r) => r.is_self);
    if (!selfEntry) {
      const enc = encodeURIComponent(userId);
      const selfProfile = await supabaseFetch<Array<{
        id: string; username: string; glicko_rating: number; ranked_games_played: number; provisional: boolean;
      }>>(`/rest/v1/profiles?id=eq.${enc}&select=id,username,glicko_rating,ranked_games_played,provisional&limit=1`);
      if (selfProfile?.[0]) {
        const sp = selfProfile[0];
        const aboveCount = await supabaseFetch<Array<{ id: string }>>(
          `/rest/v1/profiles?provisional=eq.false&glicko_rating=gte.${encodeURIComponent(String(sp.glicko_rating))}&select=id`,
        );
        selfEntry = {
          userId: sp.id, username: sp.username,
          glicko_rating: Number(sp.glicko_rating ?? 800),
          ranked_games_played: Number(sp.ranked_games_played ?? 0),
          provisional: Boolean(sp.provisional),
          global_rank: aboveCount.length, is_self: true,
        };
      }
    }
    res.json({ ok: true, leaderboard: topRows, self: selfEntry ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

export async function respondLeaderboardFriends(userId: string, res: Response): Promise<void> {
  try {
    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number;
      ranked_games_played: number; provisional: boolean;
    }>>(
      `/rest/v1/profiles?or=(${inFilter})&order=glicko_rating.desc` +
      `&select=id,username,glicko_rating,ranked_games_played,provisional`,
    );
    const winCountMap = await countOnlineWinsByUser(allIds);
    res.json({
      ok: true,
      leaderboard: profiles.map((p, index) => {
        const wins = winCountMap.get(p.id) ?? 0;
        const total = Number(p.ranked_games_played ?? 0);
        const win_rate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
        return {
          userId: p.id, username: p.username,
          glicko_rating: Number(p.glicko_rating ?? 800),
          ranked_games_played: total, provisional: Boolean(p.provisional),
          rank_in_friends: index + 1, is_self: p.id === userId, wins, win_rate,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}

export async function respondLeaderboardWeekly(userId: string, res: Response): Promise<void> {
  try {
    const rows = await buildWeeklyLeaderboard();
    const leaderboard = rows.map((row) => ({ ...row, is_self: row.userId === userId }));
    const self = leaderboard.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}
