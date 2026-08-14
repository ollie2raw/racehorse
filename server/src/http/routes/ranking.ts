import type { Application, Request } from 'express';
import { setPublicShortCache } from './cacheControl';

export type RankingRouteDeps = {
  supabaseFetch: <T>(path: string, init?: RequestInit) => Promise<T>;
  getAuthenticatedUserId: (req: Request) => Promise<string | null>;
  isAdminSecret: (value: unknown) => boolean;
  getLeaderboard: (limit: number) => Promise<unknown[]>;
  processRatingPeriod: (userId: string) => Promise<unknown>;
  computeOnlineCurrentWinStreak: (
    userId: string,
    matchRows: Array<{
      winner_user_id: string | null;
      loser_user_id: string | null;
      mode: string;
      created_at: string;
    }>,
  ) => number;
  isFritzId: (id: string) => boolean;
  DEFAULT_RATING: number;
  DEFAULT_RD: number;
};

export function registerRankingRoutes(app: Application, deps: RankingRouteDeps): void {
  const {
    supabaseFetch,
    getAuthenticatedUserId,
    isAdminSecret,
    getLeaderboard,
    processRatingPeriod,
    computeOnlineCurrentWinStreak,
    isFritzId,
    DEFAULT_RATING,
    DEFAULT_RD,
  } = deps;

  app.get('/api/ranking/profile/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}`);
      const profile = profileData?.[0];
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const allProfiles = await supabaseFetch<any[]>(`/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc`);
      const rankIndex = allProfiles.findIndex((p) => p.id === userId);

      const enc = encodeURIComponent(userId);
      const matchRows = await supabaseFetch<
        Array<{ winner_user_id: string | null; loser_user_id: string | null; mode: string; created_at: string }>
      >(
        `/rest/v1/matches?or=(winner_user_id.eq.${enc},loser_user_id.eq.${enc})` +
          `&select=winner_user_id,loser_user_id,mode,created_at&order=created_at.asc`,
      );
      const currentWinStreak = computeOnlineCurrentWinStreak(userId, matchRows ?? []);

      res.json({
        ok: true,
        glicko_rating: profile.glicko_rating,
        glicko_rd: profile.glicko_rd,
        provisional: profile.provisional,
        ranked_games_played: profile.ranked_games_played,
        peak_rating: profile.peak_rating,
        rank: rankIndex >= 0 ? rankIndex + 1 : null,
        currentWinStreak,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load ranking profile.',
      });
    }
  });

  app.get('/api/ranking/leaderboard', async (req, res) => {
    const limit = Number(req.query.limit) || 50;
    try {
      const leaderboard = await getLeaderboard(limit);
      setPublicShortCache(res, 60, 300);
      res.json({ ok: true, leaderboard });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load leaderboard.',
      });
    }
  });

  app.get('/api/ranking/history/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const authenticatedUserId = await getAuthenticatedUserId(req);
      if (!authenticatedUserId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}&limit=1`);
      const profile = profileData?.[0];
      if (!profile) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }

      const games = await supabaseFetch<any[]>(
        `/rest/v1/ranked_games?player_id=eq.${userId}` +
          `&rating_after=not.is.null&select=played_at,rating_after,rd_after,delta,opponent_id,player_score,opponent_score` +
          `&order=played_at.asc,id.asc`,
      );

      res.json({
        ok: true,
        games: games.map((game) => ({
          played_at: game.played_at,
          rating_after: Number(game.rating_after ?? 0),
          rd_after: Number(game.rd_after ?? 350),
          delta: Number(game.delta ?? 0),
          opponent_id: String(game.opponent_id ?? ''),
          player_score: Number(game.player_score ?? 0),
          opponent_score: Number(game.opponent_score ?? 0),
          is_fritz: isFritzId(game.opponent_id),
        })),
        currentRating: Number(profile.glicko_rating ?? DEFAULT_RATING),
        peakRating: Number(profile.peak_rating ?? profile.glicko_rating ?? DEFAULT_RATING),
        provisional: Boolean(profile.provisional),
        rd: Number(profile.glicko_rd ?? DEFAULT_RD),
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load rating history.',
      });
    }
  });

  app.post('/api/ranking/process/:userId', async (req, res) => {
    const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
    if (!isAdminSecret(req.body?.adminKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!userId) {
      res.status(400).json({ error: 'userId is required.' });
      return;
    }

    try {
      const result = await processRatingPeriod(userId);
      res.json({ ok: true, result });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to process rating period.',
      });
    }
  });
}