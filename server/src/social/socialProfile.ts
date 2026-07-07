import type { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { dedupeMatchRows } from '../stats/dedupeMatchRows';
import { requireAuth } from './socialAuth';
import { getPresenceBatch } from './presence';

export function registerSocialProfileRoutes(socialRouter: Router): void {
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

      const allRanked = await supabaseFetch<Array<{ id: string }>>(
        `/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&select=id`,
      );
      const rankIndex = allRanked.findIndex((p) => p.id === targetId);
      const globalRank = rankIndex >= 0 ? rankIndex + 1 : null;

      const matchRows = dedupeMatchRows(
        await supabaseFetch<Array<{
          winner_user_id: string | null; loser_user_id: string | null; created_at: string;
          winner_score: number | null; loser_score: number | null; room_code: string | null;
        }>>(
          `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
          `&mode=eq.online&select=winner_user_id,loser_user_id,winner_score,loser_score,room_code,created_at`,
        ),
      );
      const wins = matchRows.filter((m) => m.winner_user_id === targetId).length;
      const losses = matchRows.filter((m) => m.loser_user_id === targetId).length;
      const total = wins + losses;
      const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

      const recentRows = dedupeMatchRows(
        await supabaseFetch<Array<{
          winner_user_id: string | null; loser_user_id: string | null;
          winner_score: number | null; loser_score: number | null;
          mode: string; created_at: string; room_code: string | null;
        }>>(
          `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
          `&order=created_at.desc&limit=20` +
          `&select=winner_user_id,loser_user_id,winner_score,loser_score,mode,created_at,room_code`,
        ),
      ).slice(0, 10);
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

      const h2hRows = matchRows.filter((m) => {
        const opp = m.winner_user_id === targetId ? m.loser_user_id : m.winner_user_id;
        return opp === requestorId;
      });
      const viewerH2hWins = h2hRows.filter((m) => m.winner_user_id === requestorId).length;
      const viewerH2hLosses = h2hRows.filter((m) => m.loser_user_id === requestorId).length;
      const h2h =
        viewerH2hWins + viewerH2hLosses > 0
          ? {
              viewer_wins: viewerH2hWins,
              viewer_losses: viewerH2hLosses,
              wins: viewerH2hWins,
              losses: viewerH2hLosses,
            }
          : null;

      const reqEnc = encodeURIComponent(requestorId);
      const friendRows = await supabaseFetch<Array<{ id: string; status: string }>>(
        `/rest/v1/friends` +
        `?or=(and(user_id.eq.${reqEnc},friend_user_id.eq.${enc}),and(user_id.eq.${enc},friend_user_id.eq.${reqEnc}))` +
        `&select=id,status&limit=1`,
      );
      const friendRow = (friendRows as Array<{ id: string; status: string }>)?.[0];
      const isFriend = friendRow?.status === 'accepted';
      const hasPendingRequest = friendRow?.status === 'pending';

      const puzzleRows = await supabaseFetch<Array<{ total_score: number | null; completed_at: string }>>(
        `/rest/v1/daily_puzzle_attempts?user_id=eq.${enc}&status=eq.completed` +
        `&select=total_score,completed_at&order=completed_at.asc&limit=365`,
      ).catch(() => [] as Array<{ total_score: number | null; completed_at: string }>);
      const puzzles_completed = puzzleRows.length;
      const best_puzzle_score = puzzleRows.reduce((max, r) => Math.max(max, r.total_score ?? 0), 0) || null;

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

      const fritzRows = await supabaseFetch<Array<{ won: boolean; final_score: number | null }>>(
        `/rest/v1/daily_fritz_attempts?user_id=eq.${enc}&status=eq.completed` +
        `&select=won,final_score`,
      ).catch(() => [] as Array<{ won: boolean; final_score: number | null }>);
      const fritz_wins = fritzRows.filter((r) => r.won).length;
      const fritz_losses = fritzRows.filter((r) => !r.won).length;

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
}