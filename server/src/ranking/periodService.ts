
import { computeGlicko2, decayRD, FRITZ_RATING, FRITZ_RD, FRITZ_SYSTEM_ID } from './glicko2';
import { supabaseFetch } from '../supabaseUtils';

interface Profile {
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

interface RankedGame {
  id: string;
  player_id: string;
  opponent_id: string;
  player_score: number;
  opponent_score: number;
  played_at: string;
}

export async function processRatingPeriod(userId: string) {
  const [profile] = await supabaseFetch<Profile[]>(`/rest/v1/profiles?id=eq.${userId}`);
  if (!profile) throw new Error('Player not found');

  const lastPeriod = profile.glicko_last_period;
  let gamesQuery = `/rest/v1/ranked_games?player_id=eq.${userId}`;
  if (lastPeriod) {
    gamesQuery += `&played_at=gt.${lastPeriod}`;
  }

  const games = await supabaseFetch<RankedGame[]>(gamesQuery);

  let newRating = profile.glicko_rating;
  let newRD = profile.glicko_rd;
  let newVol = profile.glicko_vol;
  const gamesInPeriod = games.length;

  if (gamesInPeriod === 0) {
    const decayed = decayRD({
      rating: profile.glicko_rating,
      rd: profile.glicko_rd,
      vol: profile.glicko_vol,
      gamesPlayed: profile.ranked_games_played,
    });
    newRD = decayed.newRD;
  } else {
    // Fetch opponent info
    const opponentIds = [...new Set(games.map((g) => g.opponent_id).filter((id) => id !== FRITZ_SYSTEM_ID))];
    let opponents: Profile[] = [];
    if (opponentIds.length > 0) {
      opponents = await supabaseFetch<Profile[]>(`/rest/v1/profiles?id=in.(${opponentIds.map((id) => `"${id}"`).join(',')})`);
    }

    const opponentMap = new Map<string, { rating: number; rd: number }>();
    for (const opp of opponents) {
      opponentMap.set(opp.id, { rating: opp.glicko_rating, rd: opp.glicko_rd });
    }

    const glickoGames = games.map((g) => {
      let oppRating = FRITZ_RATING;
      let oppRD = FRITZ_RD;

      if (g.opponent_id !== FRITZ_SYSTEM_ID) {
        const opp = opponentMap.get(g.opponent_id);
        if (opp) {
          oppRating = opp.rating;
          oppRD = opp.rd;
        } else {
          // If opponent not found, use default? Or skip?
          // The instructions say "fetch the opponent's glicko_rating and glicko_rd from profiles"
          // If they don't exist, we might have an issue. For now default to standard.
          oppRating = 1500;
          oppRD = 350;
        }
      }

      return {
        opponent: { rating: oppRating, rd: oppRD },
        result: { score: g.player_score, opponentScore: g.opponent_score },
      };
    });

    const result = computeGlicko2(
      {
        rating: profile.glicko_rating,
        rd: profile.glicko_rd,
        vol: profile.glicko_vol,
        gamesPlayed: profile.ranked_games_played,
      },
      glickoGames,
    );

    newRating = result.newRating;
    newRD = result.newRD;
    newVol = result.newVol;
  }

  const newGamesPlayed = profile.ranked_games_played + gamesInPeriod;
  const isProvisional = newGamesPlayed < 20;
  const newPeakRating = Math.max(profile.peak_rating || 0, newRating);
  const now = new Date().toISOString();

  // Update profile
  await supabaseFetch(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      glicko_rating: newRating,
      glicko_rd: newRD,
      glicko_vol: newVol,
      glicko_last_period: now,
      provisional: isProvisional,
      peak_rating: newPeakRating,
      ranked_games_played: newGamesPlayed,
    }),
  });

  // Update games with new ratings
  if (gamesInPeriod > 0) {
    const gameIds = games.map((g) => g.id);
    // Ideally we should update individually if we want to store EXACT rating at that moment,
    // but the instruction says "filled at period end". 
    // We'll update all games in this period with the final rating/delta.
    for (const g of games) {
        const delta = newRating - profile.glicko_rating;
        await supabaseFetch(`/rest/v1/ranked_games?id=eq.${g.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
                rating_after: newRating,
                delta: delta
            })
        });
    }
  }

  // Insert rating period record
  await supabaseFetch(`/rest/v1/rating_periods`, {
    method: 'POST',
    body: JSON.stringify({
      user_id: userId,
      rating_before: profile.glicko_rating,
      rating_after: newRating,
      rd_before: profile.glicko_rd,
      rd_after: newRD,
      vol_before: profile.glicko_vol,
      vol_after: newVol,
      processed_at: now,
    }),
  });

  return {
    newRating,
    newRD,
    delta: newRating - profile.glicko_rating,
    gamesInPeriod,
  };
}

export async function processAllRatingPeriods() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch all users who need processing
  // profiles where glicko_last_period < sevenDaysAgo OR glicko_last_period is null
  const users = await supabaseFetch<Profile[]>(`/rest/v1/profiles?or=(glicko_last_period.lt.${sevenDaysAgo},glicko_last_period.is.null)`);

  let processed = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      await processRatingPeriod(user.id);
      processed++;
    } catch (err: any) {
      errors.push(`Error processing user ${user.id}: ${err.message}`);
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
