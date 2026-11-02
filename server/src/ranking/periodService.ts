
import { computeGlicko2, decayRD, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, getFritzConfig, isFritzId, isProvisional, type MatchOutcome } from './glicko2';
import { mayContinueDecay } from './ratingCutoverGate';
import { supabaseFetch } from '../supabaseUtils';
import { fetchProfilesExcludingGuests } from '../guests/guestEligibility';
import { fetchAllPages } from '../supabasePagination';
import { childLogger } from '../logger';
import { readRankedRatingContext, rankedRatingWeight } from './ratingContext';

const log = childLogger('ranking:catch-up');
export const RANKING_CATCHUP_SCAN_LIMIT = 100;
const RANKED_GAME_COLUMNS = 'id,player_id,opponent_id,player_score,opponent_score,played_at,rating_after,delta,outcome,rating_context,source_match_id';
let catchUpCursor: { playedAt: string; id: string } | undefined;
let catchUpRunning = false;
const failedGames = new Map<string, { attempts: number; retryAt: number }>();
const MAX_FAILURE_CACHE = 1000;
function isInfrastructureFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Supabase request (?:failed: (?:401|403|404|429|5\d\d)|timed out)|fetch failed|ECONN|ETIMEDOUT|^503 /i.test(message);
}
function deferFailedGame(id: string): void {
  const attempts = Math.min(6, (failedGames.get(id)?.attempts ?? 0) + 1);
  failedGames.delete(id);
  failedGames.set(id, { attempts, retryAt: Date.now() + Math.min(6 * 60 * 60_000, 30 * 60_000 * 2 ** (attempts - 1)) });
  if (failedGames.size > MAX_FAILURE_CACHE) failedGames.delete(failedGames.keys().next().value!);
}

export function resetRatingCatchUpForTests(): void {
  catchUpCursor = undefined;
  catchUpRunning = false;
  failedGames.clear();
}

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
  rating_context?: unknown;
  source_match_id?: string | null;
}

interface ProcessRatingPeriodOptions {
  applyDecayIfNoGames?: boolean;
  /**
   * A profile the caller already read. The decay sweep selects every inactive
   * profile up front and then called back in for each one individually; that
   * second read returned bytes it already had.
   */
  profile?: Profile;
  /** Internal catch-up page; foreground callers still read their own pending games. */
  games?: RankedGame[];
  onGameError?: (game: RankedGame, error: unknown) => void;
  onGameProcessed?: (game: RankedGame, applied: boolean) => void;
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
    `/rest/v1/ranked_games?select=${RANKED_GAME_COLUMNS}&player_id=eq.${userId}&rating_after=is.null&order=played_at.asc,id.asc&limit=1000`,
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

async function commitProcessedGame(
  profile: Profile,
  game: RankedGame,
  opponent: OpponentSnapshot,
  processedAt: string,
): Promise<{
  profile: Profile;
  newRating: number;
  newRD: number;
  delta: number;
  applied: boolean;
}> {
  const context = readRankedRatingContext(game.rating_context);
  if (context && game.outcome !== context.outcome) throw new Error('Ranked rating outcome/context mismatch');
  const authoritativeOpponent = context?.opponent ?? opponent;
  let currentProfile = profile;
  const player = context?.player;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = computeGlicko2(
      {
        rating: player?.rating ?? currentProfile.glicko_rating,
        rd: player?.rd ?? currentProfile.glicko_rd,
        vol: player?.vol ?? currentProfile.glicko_vol,
        gamesPlayed: player?.gamesPlayed ?? currentProfile.ranked_games_played,
      },
      [
        {
          opponent: authoritativeOpponent,
          result: {
            score: game.player_score,
            opponentScore: game.opponent_score,
            outcome: context?.outcome ?? game.outcome ?? undefined,
          },
        },
      ],
    );

    const before = player ?? { rating: currentProfile.glicko_rating, rd: currentProfile.glicko_rd, vol: currentProfile.glicko_vol, gamesPlayed: currentProfile.ranked_games_played, peakRating: currentProfile.peak_rating };
    if (![result.newRating, result.newRD, result.newVol].every(Number.isFinite)) throw new Error('Non-finite ranked rating result');
    const newGamesPlayed = before.gamesPlayed + 1;
    const delta = (result.newRating - before.rating) * rankedRatingWeight(context);
    const adjustedNewRating = before.rating + delta;
    const newPeakRating = Math.max(before.peakRating || 0, adjustedNewRating);

    try {
      await supabaseFetch('/rest/v1/rpc/commit_glicko_game_update', {
        method: 'POST',
        body: JSON.stringify({
          p_rating_context: context,
          p_profile_id: currentProfile.id,
          p_glicko_rating: adjustedNewRating,
          p_glicko_rd: result.newRD,
          p_glicko_vol: result.newVol,
          p_glicko_last_period: processedAt,
          p_provisional: isProvisional(newGamesPlayed),
          p_peak_rating: newPeakRating,
          p_ranked_games_played: newGamesPlayed,
          p_game_id: game.id,
          p_delta: delta,
          p_rating_before: before.rating,
          p_rd_before: before.rd,
          p_vol_before: before.vol,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ranked_already_processed')) {
        const fresh = await getProfile(currentProfile.id);
        return { profile: fresh, newRating: fresh.glicko_rating, newRD: fresh.glicko_rd, delta: 0, applied: false };
      }
      if (context || !message.includes('ranked_state_conflict') || attempt === 4) throw error;
      currentProfile = await getProfile(currentProfile.id);
      continue;
    }

    return {
      profile: {
        ...currentProfile,
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
      applied: true,
    };
  }
  throw new Error('Ranked rating state changed too many times.');
}

export async function processRatingPeriod(
  userId: string,
  options: ProcessRatingPeriodOptions = {},
) {
  const { applyDecayIfNoGames = false } = options;
  let profile = options.profile
    ? await normalizeLegacyStartingProfile(options.profile)
    : await getProfile(userId);
  const games = options.games ?? await getPendingGames(userId);

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

    try {
      await supabaseFetch('/rest/v1/rpc/commit_glicko_decay_update', {
        method: 'POST',
        body: JSON.stringify({
          p_profile_id: userId,
          p_new_rd: decayed.newRD,
          p_processed_at: processedAt,
          p_rating_before: profile.glicko_rating,
          p_rd_before: profile.glicko_rd,
          p_vol_before: profile.glicko_vol,
          p_games_before: profile.ranked_games_played,
        }),
      });
    } catch (error) {
      if (!String(error).includes('ranked_state_conflict')) throw error;
      return processRatingPeriod(userId, { applyDecayIfNoGames: false });
    }

    return {
      newRating: profile.glicko_rating,
      newRD: decayed.newRD,
      delta: 0,
      gamesInPeriod: 0,
      decayApplied: true,
    };
  }

  let newRating = profile.glicko_rating;
  let newRD = profile.glicko_rd;
  let totalDelta = 0;
  let appliedGames = 0;

  // Cache successful AND failed lookups within a page. A missing opponent
  // must not make 100 identical network requests or abort unrelated games.
  const opponentIds = [...new Set(games.filter((game) => game && game.rating_context == null && typeof game.opponent_id === 'string').map((game) => game.opponent_id))];
  // Keep the existing per-user snapshot semantics: all opponents are sampled
  // before committing any game for this user.
  const snapshots = await Promise.allSettled(opponentIds.map(getOpponentSnapshot));
  const opponentSnapshots = new Map(opponentIds.map((id, index) => [id, snapshots[index]!]));
  if (!options.onGameError) {
    const failure = snapshots.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  for (const game of games) {
    try {
      if (!game || typeof game.id !== 'string' || typeof game.opponent_id !== 'string'
        || !Number.isFinite(game.player_score) || !Number.isFinite(game.opponent_score)) {
        throw new Error('Malformed pending ranked game');
      }
      const context = readRankedRatingContext(game.rating_context);
      const snapshot = opponentSnapshots.get(game.opponent_id);
      if (snapshot?.status === 'rejected') throw snapshot.reason;
      const opponent = context?.opponent ?? (snapshot?.status === 'fulfilled' ? snapshot.value : undefined);
      if (!opponent) throw new Error('Missing ranked opponent snapshot');
      const processed = await commitProcessedGame(profile, game, opponent, new Date().toISOString());
      profile = processed.profile;
      newRating = processed.newRating;
      newRD = processed.newRD;
      totalDelta += processed.delta;
      if (processed.applied) appliedGames += 1;
      options.onGameProcessed?.(game, processed.applied);
    } catch (error) {
      if (!options.onGameError) throw error;
      options.onGameError(game, error);
    }
  }

  return {
    newRating,
    newRD,
    delta: totalDelta,
    gamesInPeriod: appliedGames,
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
    ),
    commitProcessedGame(
      params.playerBProfile,
      params.playerBGame,
      {
        rating: params.playerAProfile.glicko_rating,
        rd: params.playerAProfile.glicko_rd,
      },
      processedAt,
    ),
  ]);

  return {
    playerA: playerAResult,
    playerB: playerBResult,
  };
}

/** Drain predecessors before taking the immutable owner snapshot. The insert
 * trigger rechecks under the profile lock, closing the concurrent-insert race. */
export async function prepareRankedGameProfile(userId: string, excludeSourceMatchId?: string): Promise<Profile> {
  const games = await getPendingGames(userId); // missing expansion fails before normalization writes
  const profile = await getProfile(userId);
  if (!games.length) return profile;
  const sameMatch = excludeSourceMatchId && games.find((game) => game.source_match_id === excludeSourceMatchId);
  if (sameMatch) {
    const context = readRankedRatingContext(sameMatch.rating_context);
    return context ? { ...profile, glicko_rating: context.player.rating, glicko_rd: context.player.rd,
      glicko_vol: context.player.vol, ranked_games_played: context.player.gamesPlayed, peak_rating: context.player.peakRating } : profile;
  }
  await processRatingPeriod(userId, { profile, games });
  return getProfile(userId);
}
export async function readRankedOpponentSnapshot(opponentId: string, sourceMatchId?: string): Promise<OpponentSnapshot> {
  if (isFritzId(opponentId)) return getOpponentSnapshot(opponentId);
  // The other seat of this same match may already be inserted/applied. Its
  // immutable pre-game owner state is the shared opponent input, not its result.
  const sameMatchSnapshot = async () => {
    if (!sourceMatchId?.trim()) return null;
    const [sameMatch] = await supabaseFetch<RankedGame[]>(`/rest/v1/ranked_games?select=${RANKED_GAME_COLUMNS}&player_id=eq.${encodeURIComponent(opponentId)}&source_match_id=eq.${encodeURIComponent(sourceMatchId.trim())}&limit=1`);
    return sameMatch && readRankedRatingContext(sameMatch.rating_context);
  };
  let context = await sameMatchSnapshot();
  if (context) return { rating: context.player.rating, rd: context.player.rd };
  const profile = await prepareRankedGameProfile(opponentId, sourceMatchId?.trim());
  // Close the race where the other seat was inserted/applied between the
  // first lookup and the profile read. Never sample this match's own result.
  context = await sameMatchSnapshot();
  return context ? { rating: context.player.rating, rd: context.player.rd }
    : { rating: profile.glicko_rating, rd: profile.glicko_rd };
}

export async function processAllPendingRatingGames() {
  if (catchUpRunning) {
    log.info({ outcome: 'already_running' }, 'pending rating sweep');
    return { processed: 0, errors: [], scanned: 0, failed: 0, skipped: 0, paged: false, alreadyRunning: true };
  }
  catchUpRunning = true;
  const startedAt = Date.now();
  let scanned = 0;
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const paged = catchUpCursor !== undefined;
  let outcome = 'success';
  try {
    // Keyset over immutable chronology: one modest page per cadence, including
    // all inputs the rating operation needs. No list-users-then-refetch-games.
    const cursorFilter = catchUpCursor
      ? `&or=(played_at.gt.${encodeURIComponent(catchUpCursor.playedAt)},and(played_at.eq.${encodeURIComponent(catchUpCursor.playedAt)},id.gt.${encodeURIComponent(catchUpCursor.id)}))`
      : '';
    const games = await supabaseFetch<RankedGame[]>(
      `/rest/v1/ranked_games?select=${RANKED_GAME_COLUMNS}&rating_after=is.null&order=played_at.asc,id.asc&limit=${RANKING_CATCHUP_SCAN_LIMIT}${cursorFilter}`,
    );
    scanned = games.length;
    const byUser = new Map<string, RankedGame[]>();
    for (const game of games) {
      if (!game || typeof game.player_id !== 'string') {
        failed += 1;
        errors.push('Malformed pending ranked game identity');
        continue;
      }
      if ((failedGames.get(game.id)?.retryAt ?? 0) > Date.now()) continue;
      const userGames = byUser.get(game.player_id) ?? [];
      userGames.push(game);
      byUser.set(game.player_id, userGames);
    }
    for (const [userId, userGames] of byUser) {
      try {
        await processRatingPeriod(userId, {
          games: userGames,
          onGameProcessed: (game, applied) => {
            if (applied) processed += 1;
            failedGames.delete(game.id);
          },
          onGameError: (game, error) => {
            failed += 1;
            if (isInfrastructureFailure(error)) throw error;
            deferFailedGame(game.id);
            errors.push(`Game ${game?.id}: ${error instanceof Error ? error.message : String(error)}`);
          },
        });
      } catch (error) {
        if (isInfrastructureFailure(error)) throw error;
        failed += userGames.length;
        for (const game of userGames) deferFailedGame(game.id);
        errors.push(`User ${userId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const last = games[games.length - 1];
    catchUpCursor = games.length === RANKING_CATCHUP_SCAN_LIMIT && last
      ? { playedAt: last.played_at, id: last.id } : undefined;
    outcome = failed ? 'partial' : 'success';
    return { processed, errors, scanned, failed, skipped: scanned - processed - failed, paged, alreadyRunning: false };
  } catch (error) {
    outcome = 'failed';
    throw error; // Scan failure retains the cursor; it is not a row skip.
  } finally {
    catchUpRunning = false;
    log.info({ durationMs: Date.now() - startedAt, scanned, processed, failed, skipped: outcome === 'failed' ? 0 : scanned - processed - failed, unprocessed: outcome === 'failed' ? scanned - processed - failed : 0, paged, outcome }, 'pending rating sweep');
  }
}

export async function decayInactivePlayers() {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // Paged, and projected: this was `select=*` with no limit, so a single
  // response carried every column of every inactive profile.
  let afterId: string | undefined;
  let pages = 0;
  const users = await fetchAllPages<Profile>(async (_offset, limit) => {
    const page = await supabaseFetch<Profile[]>(
      `/rest/v1/profiles?or=(glicko_last_period.lt.${sevenDaysAgo},glicko_last_period.is.null)` +
        `&select=${PROFILE_COLUMNS}&order=id.asc&limit=${limit}` +
        (afterId ? `&id=gt.${encodeURIComponent(afterId)}` : ''),
    );
    pages += 1;
    afterId = page[page.length - 1]?.id;
    return page;
  });

  let processed = 0;
  let aborted = false;
  const errors: string[] = [];

  for (const user of users) {
    // Rating cutover gate: this profile was read before the loop; stop before
    // the write once the gate closes rather than apply a stale value.
    if (!(await mayContinueDecay())) {
      aborted = true;
      break;
    }
    try {
      // Hand over the profile we already read: four sequential round-trips
      // per user becomes three.
      const result = await processRatingPeriod(user.id, {
        applyDecayIfNoGames: true,
        profile: user,
      });
      if (result.decayApplied) processed++;
    } catch (err: unknown) {
      if (isInfrastructureFailure(err)) throw err;
      errors.push(`Error decaying user ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { processed, errors, aborted, scanned: users.length, pages, failed: errors.length };
}

export async function getLeaderboard(limit: number = 50) {
  const users = await fetchProfilesExcludingGuests<Profile[]>(`/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc&limit=${limit}`);
  return users.map((u) => ({
    userId: u.id,
    username: u.username,
    glicko_rating: u.glicko_rating,
    glicko_rd: u.glicko_rd,
    ranked_games_played: u.ranked_games_played,
    provisional: u.provisional,
  }));
}
