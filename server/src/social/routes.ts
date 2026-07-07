import { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getAutoRivals } from './rivalService';
import { requireAuth } from './socialAuth';
import {
  respondLeaderboardFriends,
  respondLeaderboardGlobal,
  respondLeaderboardWeekly,
} from './socialLeaderboard';
import { registerSocialFeedRoutes } from './socialFeed';
import { registerSocialFriendsRoutes } from './socialFriends';
import { registerSocialProfileRoutes } from './socialProfile';

export const socialRouter = Router();

registerSocialFeedRoutes(socialRouter);
registerSocialFriendsRoutes(socialRouter);

socialRouter.get('/leaderboard', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'global';
  if (filter === 'friends') return void respondLeaderboardFriends(userId, res);
  if (filter === 'weekly') return void respondLeaderboardWeekly(userId, res);
  return void respondLeaderboardGlobal(userId, res);
});

socialRouter.get('/leaderboard/friends', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardFriends(userId, res);
});

socialRouter.get('/rivals', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const rivals = await getAutoRivals(userId);
    res.json({ ok: true, rivals });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Rivals unavailable.' });
  }
});

socialRouter.get('/leaderboard/weekly', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardWeekly(userId, res);
});

socialRouter.get('/leaderboard/mode/:mode', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const mode = req.params.mode;
  if (!['online', 'bot', 'ghost'].includes(mode)) { res.status(400).json({ error: 'Invalid mode.' }); return; }
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const matches = await supabaseFetch<Array<{ winner_user_id: string | null; loser_user_id: string | null }>>(
      `/rest/v1/matches?mode=eq.${encodeURIComponent(mode)}&created_at=gte.${encodeURIComponent(ninetyDaysAgo)}` +
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
        userId: p.id,
        username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        provisional: Boolean(p.provisional),
        wins: winCounts.get(p.id) ?? 0,
        is_self: p.id === userId,
      }))
      .sort((a, b) => b.wins - a.wins)
      .map((p, i) => ({ ...p, rank: i + 1 }));

    const self = sorted.find((r) => r.is_self) ?? null;
    res.json({ ok: true, leaderboard: sorted, self });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
});

socialRouter.get('/leaderboard/global', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardGlobal(userId, res);
});

registerSocialProfileRoutes(socialRouter);