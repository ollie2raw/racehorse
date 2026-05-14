import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { getAutoRivals } from './rivalService';
import { getPresenceBatch } from './presence';

async function requireAuth(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Unauthorized' }); return null; }
  try {
    const userData = await supabaseFetch<{ id?: string }>(
      `/auth/v1/user`,
      { headers: { Authorization: `Bearer ${token}` } } as RequestInit,
    );
    const userId = (userData as { id?: string })?.id ?? null;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return null; }
    return userId;
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
}

async function getFriendIds(userId: string): Promise<string[]> {
  const enc = encodeURIComponent(userId);
  const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
    `/rest/v1/friends` +
    `?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
    `&status=eq.accepted` +
    `&select=user_id,friend_user_id`,
  );
  return rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id));
}

export const socialRouter = Router();

// GET /api/social/feed
socialRouter.get('/feed', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId);
    const allIds = [userId, ...friendIds];
    const inFilter = allIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; type: string;
      metadata: Record<string, unknown>; created_at: string;
    }>>(
      `/rest/v1/activity_feed?or=(${inFilter})&order=created_at.desc&limit=50` +
      `&select=id,user_id,type,metadata,created_at`,
    );

    const feedUserIds = [...new Set(rows.map((r) => r.user_id))];
    const profileFilter = feedUserIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = profileFilter
      ? await supabaseFetch<Array<{ id: string; username: string }>>(
          `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
        )
      : [];
    const usernameMap = new Map((profiles as Array<{ id: string; username: string }>).map((p) => [p.id, p.username]));

    res.json({
      ok: true,
      feed: rows.map((r) => ({ ...r, username: usernameMap.get(r.user_id) ?? 'player' })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Feed unavailable.' });
  }
});

// GET /api/social/leaderboard/friends
socialRouter.get('/leaderboard/friends', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
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
    res.json({
      ok: true,
      leaderboard: profiles.map((p, index) => ({
        userId: p.id,
        username: p.username,
        glicko_rating: Number(p.glicko_rating ?? 800),
        ranked_games_played: Number(p.ranked_games_played ?? 0),
        provisional: Boolean(p.provisional),
        rank_in_friends: index + 1,
        is_self: p.id === userId,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Leaderboard unavailable.' });
  }
});

// GET /api/social/rivals
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

// GET /api/social/friends/with-presence
socialRouter.get('/friends/with-presence', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId);
    if (!friendIds.length) { res.json({ ok: true, friends: [] }); return; }

    const enc = encodeURIComponent(userId);
    const rows = await supabaseFetch<Array<{ id: string; user_id: string; friend_user_id: string }>>(
      `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
      `&status=eq.accepted&select=id,user_id,friend_user_id`,
    );

    const profileFilter = friendIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
    const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
      `/rest/v1/profiles?or=(${profileFilter})&select=id,username`,
    );
    const profileMap = new Map(profiles.map((p) => [p.id, p.username]));
    const presenceMap = await getPresenceBatch(friendIds);

    const friends = friendIds.map((fId) => {
      const row = rows.find((r) => r.user_id === fId || r.friend_user_id === fId);
      const presence = presenceMap.get(fId) ?? { status: 'offline', current_mode: null };
      return {
        id: row?.id ?? fId,
        userId: fId,
        username: profileMap.get(fId) ?? 'player',
        presence_status: presence.status as 'online' | 'in_game' | 'offline',
        current_mode: presence.current_mode,
      };
    });

    res.json({ ok: true, friends });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Friends unavailable.' });
  }
});

// GET /api/profile/:username  (mounted at /api/profile via app.use)
socialRouter.get('/:username', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const username = typeof req.params.username === 'string'
    ? req.params.username.trim().replace(/^@/, '')
    : '';
  if (!username) { res.status(400).json({ error: 'username is required.' }); return; }
  try {
    const profileRows = await supabaseFetch<Array<{
      id: string; username: string; glicko_rating: number; peak_rating: number;
      provisional: boolean; ranked_games_played: number;
    }>>(
      `/rest/v1/profiles?username=ilike.${encodeURIComponent(username)}` +
      `&limit=1&select=id,username,glicko_rating,peak_rating,provisional,ranked_games_played`,
    );
    const profile = profileRows?.[0];
    if (!profile) { res.status(404).json({ error: 'Player not found.' }); return; }
    const targetId = profile.id;
    const enc = encodeURIComponent(targetId);

    // Global rank
    const allRanked = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&select=id`,
    );
    const rankIndex = allRanked.findIndex((p) => p.id === targetId);
    const globalRank = rankIndex >= 0 ? rankIndex + 1 : null;

    // Win/loss record
    const matchRows = await supabaseFetch<Array<{
      winner_user_id: string | null; loser_user_id: string | null; created_at: string;
    }>>(
      `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
      `&mode=eq.online&select=winner_user_id,loser_user_id,created_at`,
    );
    const wins = matchRows.filter((m) => m.winner_user_id === targetId).length;
    const losses = matchRows.filter((m) => m.loser_user_id === targetId).length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

    // Recent 10 matches with opponent username
    const recentRows = await supabaseFetch<Array<{
      winner_user_id: string | null; loser_user_id: string | null;
      winner_score: number | null; loser_score: number | null;
      mode: string; created_at: string;
    }>>(
      `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
      `&order=created_at.desc&limit=10` +
      `&select=winner_user_id,loser_user_id,winner_score,loser_score,mode,created_at`,
    );
    const opponentIds = [...new Set(
      recentRows
        .map((m) => (m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id))
        .filter((id): id is string => Boolean(id)),
    )];
    const oppProfileMap = new Map<string, string>();
    if (opponentIds.length) {
      const oppFilter = opponentIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const oppProfiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${oppFilter})&select=id,username`,
      );
      for (const p of oppProfiles) oppProfileMap.set(p.id, p.username);
    }
    const recentMatches = recentRows.map((m) => {
      const won = m.winner_user_id === targetId;
      const opponentId = won ? m.loser_user_id : m.winner_user_id;
      return {
        opponent_username: opponentId ? (oppProfileMap.get(opponentId) ?? 'guest') : 'guest',
        result: won ? 'win' : 'loss',
        score: won ? m.winner_score : m.loser_score,
        opponent_score: won ? m.loser_score : m.winner_score,
        mode: m.mode,
        played_at: m.created_at,
      };
    });

    // Friendship status
    const reqEnc = encodeURIComponent(requestorId);
    const friendRows = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends` +
      `?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${enc}),and(user_id.eq.${enc},friend_user_id.eq.${reqEnc}))` +
      `&select=id,status&limit=1`,
    );
    const friendRow = (friendRows as Array<{ id: string; status: string }>)?.[0];
    const isFriend = friendRow?.status === 'accepted';
    const hasPendingRequest = friendRow?.status === 'pending';

    // Presence
    const presenceMap = await getPresenceBatch([targetId]);
    const presence = presenceMap.get(targetId) ?? { status: 'offline', current_mode: null };

    res.json({
      ok: true,
      userId: targetId,
      username: profile.username,
      glicko_rating: Number(profile.glicko_rating ?? 800),
      peak_rating: Number(profile.peak_rating ?? profile.glicko_rating ?? 800),
      provisional: Boolean(profile.provisional),
      ranked_games_played: Number(profile.ranked_games_played ?? 0),
      global_rank: globalRank,
      wins,
      losses,
      win_rate: winRate,
      is_self: targetId === requestorId,
      is_friend: isFriend,
      has_pending_request: hasPendingRequest,
      presence,
      recent_matches: recentMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Profile unavailable.' });
  }
});
