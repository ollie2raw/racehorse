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

// ─── Leaderboard helpers ─────────────────────────────────────────────────────

async function respondLeaderboardGlobal(userId: string, res: Response): Promise<void> {
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

async function respondLeaderboardFriends(userId: string, res: Response): Promise<void> {
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

async function respondLeaderboardWeekly(userId: string, res: Response): Promise<void> {
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

export const socialRouter = Router();

// GET /api/social/feed
socialRouter.get('/feed', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const friendIds = await getFriendIds(userId).catch(() => [] as string[]);
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

// GET /api/social/friends/requests — pending incoming + outgoing requests
socialRouter.get('/friends/requests', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  try {
    const enc = encodeURIComponent(userId);
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; friend_user_id: string; created_at: string;
    }>>(
      `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
      `&status=eq.pending&select=id,user_id,friend_user_id,created_at`,
    );
    const otherIds = [...new Set(rows.map((r) => (r.user_id === userId ? r.friend_user_id : r.user_id)))];
    const profileMap = new Map<string, string>();
    if (otherIds.length) {
      const filter = otherIds.map((id) => `id.eq.${encodeURIComponent(id)}`).join(',');
      const profiles = await supabaseFetch<Array<{ id: string; username: string }>>(
        `/rest/v1/profiles?or=(${filter})&select=id,username`,
      );
      for (const p of profiles) profileMap.set(p.id, p.username);
    }
    const incoming = rows
      .filter((r) => r.friend_user_id === userId)
      .map((r) => ({ id: r.id, userId: r.user_id, username: profileMap.get(r.user_id) ?? 'player', created_at: r.created_at }));
    const outgoing = rows
      .filter((r) => r.user_id === userId)
      .map((r) => ({ id: r.id, userId: r.friend_user_id, username: profileMap.get(r.friend_user_id) ?? 'player', created_at: r.created_at }));
    res.json({ ok: true, incoming, outgoing });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Requests unavailable.' });
  }
});

// GET /api/social/leaderboard?filter=global|friends|weekly — unified endpoint
socialRouter.get('/leaderboard', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const filter = typeof req.query.filter === 'string' ? req.query.filter : 'global';
  if (filter === 'friends') return void respondLeaderboardFriends(userId, res);
  if (filter === 'weekly') return void respondLeaderboardWeekly(userId, res);
  return void respondLeaderboardGlobal(userId, res);
});

// GET /api/social/leaderboard/friends
socialRouter.get('/leaderboard/friends', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardFriends(userId, res);
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
    const presenceMap = await getPresenceBatch(friendIds).catch(() => new Map<string, { status: string; current_mode: string | null }>());

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

// GET /api/social/leaderboard/weekly — top players by online wins in the last 7 days
socialRouter.get('/leaderboard/weekly', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardWeekly(userId, res);
});

// GET /api/social/leaderboard/mode/:mode — top players by wins in a specific mode (last 90 days)
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

// GET /api/social/leaderboard/global
socialRouter.get('/leaderboard/global', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  return void respondLeaderboardGlobal(userId, res);
});

// GET /api/social/feed/user/:userId — recent activity for a specific user (public to logged-in users)
socialRouter.get('/feed/user/:userId', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
  try {
    const rows = await supabaseFetch<Array<{
      id: string; user_id: string; type: string;
      metadata: Record<string, unknown>; created_at: string;
    }>>(
      `/rest/v1/activity_feed?user_id=eq.${encodeURIComponent(targetId)}` +
      `&order=created_at.desc&limit=10&select=id,user_id,type,metadata,created_at`,
    );
    const profileRows = await supabaseFetch<Array<{ id: string; username: string }>>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(targetId)}&select=id,username&limit=1`,
    );
    const username = profileRows?.[0]?.username ?? 'player';
    res.json({ ok: true, feed: rows.map((r) => ({ ...r, username })) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Activity unavailable.' });
  }
});

// POST /api/social/friends/request/:userId — send a friend request by user ID (URL param)
socialRouter.post('/friends/request/:userId', async (req, res) => {
  const requestorId = await requireAuth(req, res);
  if (!requestorId) return;
  const targetId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!targetId) { res.status(400).json({ error: 'userId is required.' }); return; }
  if (targetId === requestorId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
  try {
    const reqEnc = encodeURIComponent(requestorId);
    const tgtEnc = encodeURIComponent(targetId);
    const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
    );
    if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
    if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
    await supabaseFetch('/rest/v1/friends', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: requestorId, friend_user_id: targetId, status: 'pending' }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
  }
});

// POST /api/social/friends/request — send a friend request by username { targetUsername: string }
socialRouter.post('/friends/request', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const targetUsername = typeof req.body?.targetUsername === 'string'
    ? req.body.targetUsername.trim().replace(/^@/, '')
    : '';
  if (!targetUsername) { res.status(400).json({ error: 'targetUsername is required.' }); return; }
  try {
    const targetProfiles = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/profiles?username=ilike.${encodeURIComponent(targetUsername)}&select=id&limit=1`,
    );
    const targetId = targetProfiles?.[0]?.id;
    if (!targetId) { res.status(404).json({ error: 'User not found.' }); return; }
    if (targetId === userId) { res.status(400).json({ error: 'Cannot add yourself.' }); return; }
    const reqEnc = encodeURIComponent(userId);
    const tgtEnc = encodeURIComponent(targetId);
    const existing = await supabaseFetch<Array<{ id: string; status: string }>>(
      `/rest/v1/friends?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${tgtEnc}),and(user_id.eq.${tgtEnc},friend_user_id.eq.${reqEnc}))&select=id,status&limit=1`,
    );
    if (existing?.[0]?.status === 'accepted') { res.status(409).json({ error: 'Already friends.' }); return; }
    if (existing?.[0]?.status === 'pending') { res.status(409).json({ error: 'Request already pending.' }); return; }
    await supabaseFetch('/rest/v1/friends', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, friend_user_id: targetId, status: 'pending' }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to send request.' });
  }
});

// POST /api/social/friends/accept/:requestId
socialRouter.post('/friends/accept/:requestId', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const rEnc = encodeURIComponent(req.params.requestId);
  const uEnc = encodeURIComponent(userId);
  try {
    await supabaseFetch(`/rest/v1/friends?id=eq.${rEnc}&friend_user_id=eq.${uEnc}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'accepted' }),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to accept request.' });
  }
});

// DELETE /api/social/friends/:recordId
socialRouter.delete('/friends/:recordId', async (req, res) => {
  const userId = await requireAuth(req, res);
  if (!userId) return;
  const rEnc = encodeURIComponent(req.params.recordId);
  const uEnc = encodeURIComponent(userId);
  try {
    await supabaseFetch(
      `/rest/v1/friends?id=eq.${rEnc}&or=(user_id.eq.${uEnc},friend_user_id.eq.${uEnc})`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove friend.' });
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

    // H2H against the requesting user (from already-fetched matchRows)
    const h2hRows = matchRows.filter((m) => {
      const opp = m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id;
      return opp === requestorId;
    });
    const h2hWins = h2hRows.filter((m) => m.winner_user_id === targetId).length;
    const h2hLosses = h2hRows.filter((m) => m.loser_user_id === targetId).length;
    const h2h = (h2hWins + h2hLosses > 0) ? { wins: h2hWins, losses: h2hLosses } : null;

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

    // Daily puzzle stats + best streak
    const puzzleRows = await supabaseFetch<Array<{ total_score: number | null; completed_at: string }>>(
      `/rest/v1/daily_puzzle_attempts?user_id=eq.${enc}&status=eq.completed` +
      `&select=total_score,completed_at&order=completed_at.asc&limit=365`,
    ).catch(() => [] as Array<{ total_score: number | null; completed_at: string }>);
    const puzzles_completed = puzzleRows.length;
    const best_puzzle_score = puzzleRows.reduce((max, r) => Math.max(max, r.total_score ?? 0), 0) || null;

    // Compute best consecutive daily puzzle streak from sorted dates
    const puzzleDates = [...new Set(puzzleRows.map((r) => r.completed_at.slice(0, 10)))];
    let best_streak = 0;
    let streakCur = 0;
    for (let i = 0; i < puzzleDates.length; i++) {
      if (i === 0) {
        streakCur = 1;
      } else {
        const prev = new Date(`${puzzleDates[i - 1]}T00:00:00Z`);
        const curr = new Date(`${puzzleDates[i]}T00:00:00Z`);
        const diff = Math.round((curr.getTime() - prev.getTime()) / 86400000);
        streakCur = diff === 1 ? streakCur + 1 : 1;
      }
      best_streak = Math.max(best_streak, streakCur);
    }

    // Daily fritz stats
    const fritzRows = await supabaseFetch<Array<{ won: boolean; final_score: number | null }>>(
      `/rest/v1/daily_fritz_attempts?user_id=eq.${enc}&status=eq.completed` +
      `&select=won,final_score`,
    ).catch(() => [] as Array<{ won: boolean; final_score: number | null }>);
    const fritz_wins = fritzRows.filter((r) => r.won).length;
    const fritz_losses = fritzRows.filter((r) => !r.won).length;

    // Presence
    const presenceMap = await getPresenceBatch([targetId]).catch(() => new Map<string, { status: string; current_mode: string | null }>());
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
      puzzles_completed,
      best_puzzle_score,
      best_streak,
      fritz_wins,
      fritz_losses,
      is_self: targetId === requestorId,
      is_friend: isFriend,
      has_pending_request: hasPendingRequest,
      h2h,
      presence,
      recent_matches: recentMatches,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Profile unavailable.' });
  }
});
