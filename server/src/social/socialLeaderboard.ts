import type { Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getFriendIds } from './socialAuth';

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
    const winCountMap = new Map<string, number>();
    await Promise.all(allIds.map(async (id) => {
      try {
        const wins = await supabaseFetch<Array<{ id: string }>>(
          `/rest/v1/matches?winner_user_id=eq.${encodeURIComponent(id)}&mode=eq.online&select=id`,
        );
        winCountMap.set(id, wins.length);
      } catch { winCountMap.set(id, 0); }
    }));
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
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const matches = await supabaseFetch<Array<{ winner_user_id: string | null; loser_user_id: string | null }>>(
      `/rest/v1/matches?mode=eq.online&created_at=gte.${encodeURIComponent(weekAgo)}` +
      `&select=winner_user_id,loser_user_id&limit=10000`,
    );
    const winCounts = new Map<string, number>();
    for (const m of matches) {
      if (m.winner_user_id) winCounts.set(m.winner_user_id, (winCounts.get(m.winner_user_id) ?? 0) + 1);
    }
    if (!winCounts.size) { res.json({ ok: true, leaderboard: [], self: null }); return; }
    const topIds = [...winCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id]) => id);
    const profileFilter = topIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string; glicko_rating: number; provisional: boolean }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username,glicko_rating,provisional`,
    );
    const sorted = profiles
      .map((p) => ({
        userId: p.id, username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        provisional: Boolean(p.provisional),
        wins_this_week: winCounts.get(p.id) ?? 0, is_self: p.id === userId,
      }))
      .sort((a, b) => b.wins_this_week - a.wins_this_week)
      .map((p, i) => ({ ...p, rank: i + 1 }));
    const self = sorted.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard: sorted, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
}