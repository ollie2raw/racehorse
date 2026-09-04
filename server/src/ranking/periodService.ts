
import { computeGlicko2, decayRD, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, getFritzConfig, isFritzId, isProvisional, type MatchOutcome } from './glicko2';
import { supabaseFetch } from '../supabaseUtils';
import { fetchAllPages } from '../supabasePagination';

export interface Profile {
  id: string;
  username: string;
  glicko_rating: number;
  glicko_rd: number;
  glicko_vol: number;
  glicko_last_period: string | null;
  ranked_games_played: number;
  peak_rating: number;
  provisional: boolean;
}

/**
 * Exactly the columns `Profile` declares. These reads were `select=*`, so they
 * carried every column the table happens to have, including any added later.
 */
const PROFILE_COLUMNS =
  'id,username,glicko_rating,glicko_rd,glicko_vol,glicko_last_period,ranked_games_played,peak_rating,provisional';

interface RankedGame {
  id: string;
  player_id: string;
  opponent_id: string;
  player_score: number;
  opponent_score: number;
  played_at: string;
  rating_after?: number | null;
  delta?: number | null;
  /**
   * Set when the scoreboard does not decide the result (forfeits). Null on
   * rows written before the column shipped, and on matches played to their
   * natural conclusion — both correctly fall back to comparing scores.
   */
  outcome?: MatchOutcome | null;
}

interface ProcessRatingPeriodOptions {
  applyDecayIfNoGames?: boolean;
  /**
   * A profile the caller already read. The decay sweep selects every inactive
   * profile up front and then called back in for each one individually; that
   * second read returned bytes it already had.
   */
  profile?: Profile;
}

interface OpponentSnapshot {
  rating: number;
  rd: number;
}

function needsLegacyRatingNormalization(profile: Profile): boolean {
  return (
    Number(profile.ranked_games_played ?? 0) === 0 &&
    Number(profile.glicko_rating ?? NaN) === 1500 &&
    [null, undefined, 0, 1500].includes(profile.peak_rating as number | null | undefined)
  );
}

async function normalizeLegacyStartingProfile(profile: Profile): Promise<Profile> {
  if (!needsLegacyRatingNormalization(profile)) return profile;
  const patch = {
    glicko_rating: DEFAULT_RATING,
    glicko_rd: DEFAULT_RD,
    glicko_vol: DEFAULT_VOL,
    provisional: true,
    peak_rating: DEFAULT_RATING,
    ranked_games_played: 0,
  };
  await supabaseFetch(`/rest/v1/profiles?id=eq.${profile.id}&ranked_games_played=eq.0`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return {
    ...profile,
    ...patch,
  };
}

async function getProfile(userId: string): Promise<Profile> {
  const [profile] = await supabaseFetch<Profile[]>(
    `/rest/v1/profiles?id=eq.${userId}&select=${PROFILE_COLUMNS}&limit=1`,
  );
  if (!profile) throw new Error('Player not found');
  return normalizeLegacyStartingProfile(profile);
}

async function getPendingGames(userId: string): Promise<RankedGame[]> {
  return supabaseFetch<RankedGame[]>(
    `/rest/v1/ranked_games?player_id=eq.${userId}&rating_after=is.null&order=played_at.asc,id.asc`,
  );
}

async function getOpponentSnapshot(opponentId: string): Promise<OpponentSnapshot> {
  if (isFritzId(opponentId)) {
    const config = getFritzConfig(opponentId);
    return { rating: config.rating, rd: config.rd };
  }

  const opponent = await getProfile(opponentId);
  return {
    rating: opponent.glicko_rating,
    rd: opponent.glicko_rd,
  };
}

type CommitOptions = {
  /** Multiplier on the resulting delta (disconnect forfeits count half). */
  scale?: number;
  /**
   * Overrides the row's own `outcome`. The inline realtime path passes this so
   * the forfeit sign is right even when the `outcome` column is not enabled yet.
   */
  outcome?: MatchOutcome;
};

async function commitProcessedGame(
  profile: Profile,
  game: RankedGame,
  opponent: OpponentSnapshot,
  processedAt: string,
  options: CommitOptions = {},
): Promise<{
  profile: Profile;
  newRating: number;
  newRD: number;
  delta: number;
}> {
  const result = computeGlicko2(
    {
      rating: profile.glicko_rating,
      rd: profile.glicko_rd,
      vol: profile.glicko_vol,
      gamesPlayed: profile.ranked_games_played,
    },
    [
      {
        opponent,
        result: {
          score: game.player_score,
          opponentScore: game.opponent_score,
          outcome: options.outcome ?? game.outcome ?? undefined,
        },
      },
    ],
  );

  const newGamesPlayed = profile.ranked_games_played + 1;
  const { scale } = options;
  let delta = result.newRating - profile.glicko_rating;
  if (scale != null && Number.isFinite(scale)) {
    delta = delta * scale;
  }
  const adjustedNewRating = profile.glicko_rating + delta;
  const newPeakRating = Math.max(profile.peak_rating || 0, adjustedNewRating);

  await supabaseFetch('/rest/v1/rpc/commit_glicko_game_update', {
    method: 'POST',
    body: JSON.stringify({
      p_profile_id: profile.id,
      p_glicko_rating: adjustedNewRating,
      p_glicko_rd: result.newRD,
      p_glicko_vol: result.newVol,
      p_glicko_last_period: processedAt,
      p_provisional: isProvisional(newGamesPlayed),
      p_peak_rating: newPeakRating,
      p_ranked_games_played: newGamesPlayed,
      p_game_id: game.id,
      p_delta: delta,
      p_rating_before: profile.glicko_rating,
      p_rd_before: profile.glicko_rd,
      p_vol_before: profile.glicko_vol,
    }),
  });

  return {
    profile: {
      ...profile,
      glicko_rating: adjustedNewRating,
      glicko_rd: result.newRD,
      glicko_vol: result.newVol,
      glicko_last_period: processedAt,
      provisional: isProvisional(newGamesPlayed),
      peak_rating: newPeakRating,
      ranked_games_played: newGamesPlayed,
    },
    newRating: adjustedNewRating,
    newRD: result.newRD,
    delta,
  };
}

export async function processRatingPeriod(
  userId: string,
  options: ProcessRatingPeriodOptions = {},
) {
  const { applyDecayIfNoGames = false } = options;
  let profile = options.profile
    ? await normalizeLegacyStartingProfile(options.profile)
    : await getProfile(userId);
  const games = await getPendingGames(userId);

  if (games.length === 0) {
    if (!applyDecayIfNoGames) {
      return {
        newRating: profile.glicko_rating,
        newRD: profile.glicko_rd,
        delta: 0,
        gamesInPeriod: 0,
      };
    }

    const decayed = decayRD({
      rating: profile.glicko_rating,
      rd: profile.glicko_rd,
      vol: profile.glicko_vol,
      gamesPlayed: profile.ranked_games_played,
    });
    const processedAt = new Date().toISOString();

    await supabaseFetch(`/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        glicko_rd: decayed.newRD,
        glicko_last_period: processedAt,
      }),
    });

    await supabaseFetch(`/rest/v1/rating_periods`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        rating_before: profile.glicko_rating,
        rating_after: profile.glicko_rating,
        rd_before: profile.glicko_rd,
        rd_after: decayed.newRD,
        vol_before: profile.glicko_vol,
        vol_after: profile.glicko_vol,
        processed_at: processedAt,
      }),
    });

    return {
      newRating: profile.glicko_rating,
      newRD: decayed.newRD,
      delta: 0,
      gamesInPeriod: 0,
    };
  }

  let newRating = profile.glicko_rating;
  let newRD = profile.glicko_rd;
  let totalDelta = 0;

  const opponentIds = [...new Set(games.map((g) => g.opponent_id))];
  const opponentSnapshots = await Promise.all(
    opponentIds.map((id) => getOpponentSnapshot(id)),
  );
  const opponentMap = new Map(opponentIds.map((id, i) => [id, opponentSnapshots[i]!]));

  for (const game of games) {
    const opponent = opponentMap.get(game.opponent_id)!;
    const processed = await commitProcessedGame(profile, game, opponent, new Date().toISOString());
    profile = processed.profile;
    newRating = processed.newRating;
    newRD = processed.newRD;
    totalDelta += processed.delta;
  }

  return {
    newRating,
    newRD,
    delta: totalDelta,
    gamesInPeriod: games.length,
  };
}

export interface RealtimeRatingResult {
  playerA: { profile: Profile; newRating: number; newRD: number; delta: number };
  playerB: { profile: Profile; newRating: number; newRD: number; delta: number };
}

export async function processRealtimeMultiplayerGame(params: {
  playerAProfile: Profile;
  playerBProfile: Profile;
  playerAGame: RankedGame;
  playerBGame: RankedGame;
  ratingScale?: number;
  /**
   * Authoritative results for a match the scoreboard does not decide. Forfeits
   * pass these so the player who quit is scored as the loser whatever the
   * points said when they left. Omit for a match played to its conclusion.
   */
  playerAOutcome?: MatchOutcome;
  playerBOutcome?: MatchOutcome;
}) {
  const processedAt = new Date().toISOString();

  const [playerAResult, playerBResult] = await Promise.all([
    commitProcessedGame(
      params.playerAProfile,
      params.playerAGame,
      {
        rating: params.playerBProfile.glicko_rating,
        rd: params.playerBProfile.glicko_rd,
      },
      processedAt,
      { scale: params.ratingScale, outcome: params.playerAOutcome },
    ),
    commitProcessedGame(
      params.playerBProfile,
      params.playerBGame,
      {
        rating: params.playerAProfile.glicko_rating,
        rd: params.playerAProfile.glicko_rd,
      },
      processedAt,
      { scale: params.ratingScale, outcome: params.playerBOutcome },
    ),
  ]);

  return {
    playerA: playerAResult,
    playerB: playerBResult,
  };
}

export async function processAllPendingRatingGames() {
  // Paged: this scan had no limit, so one response carried every unprocessed
  // ranked game and grew with the backlog.
  const games = await fetchAllPages<{ player_id: string }>((offset, limit) =>
    supabaseFetch<Array<{ player_id: string }>>(
      '/rest/v1/ranked_games?select=player_id&rating_after=is.null' +
        `&order=id.asc&offset=${offset}&limit=${limit}`,
    ),
  );
  const userIds = [...new Set(games.map((game) => game.player_id))];

  let processed = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    try {
      const result = await processRatingPeriod(userId);
      processed += result.gamesInPeriod;
    } catch (err: unknown) {
      errors.push(`Error processing user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { processed, errors };
}

export async function decayInactivePlayers() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Paged, and projected: this was `select=*` with no limit, so a single
  // response carried every column of every inactive profile.
  const users = await fetchAllPages<Profile>((offset, limit) =>
    supabaseFetch<Profile[]>(
      `/rest/v1/profiles?or=(glicko_last_period.lt.${sevenDaysAgo},glicko_last_period.is.null)` +
        `&select=${PROFILE_COLUMNS}&order=id.asc&offset=${offset}&limit=${limit}`,
    ),
  );

  let processed = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      // Hand over the profile we already read: four sequential round-trips
      // per user becomes three.
      const result = await processRatingPeriod(user.id, {
        applyDecayIfNoGames: true,
        profile: user,
      });
      if (result.gamesInPeriod === 0) {
        processed++;
      }
    } catch (err: unknown) {
      errors.push(`Error decaying user ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { processed, errors };
}

export async function getLeaderboard(limit: number = 50) {
  const users = await supabaseFetch<Profile[]>(`/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&limit=${limit}`);
  return users.map((u) => ({
    userId: u.id,
    username: u.username,
    glicko_rating: u.glicko_rating,
    glicko_rd: u.glicko_rd,
    ranked_games_played: u.ranked_games_played,
    provisional: u.provisional,
  }));
}
