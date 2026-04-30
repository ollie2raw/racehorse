import './loadEnv';
import express from 'express';
import cors, { type CorsOptions } from 'cors';
import http from 'http';
import { createHash, randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import {
  completeGhostGame,
  getGhostProfileSummary,
  getGhostProfileSummaryByUsername,
} from './ghost/service';
import { assignPlayerToLeague } from './league/service';
import { generateLeagueFixtures } from './league/schedule';
import {
  recordLeagueAsyncResult,
  recordLeagueFixtureResult,
  openLeagueFixtureLiveRoom,
  recordLeagueLiveResult,
} from './league/results';
import { runLeagueForfeitJob } from './league/forfeit';
import { runLeagueSundayRollover } from './league/rollover';
import { getLeagueStateForPlayer } from './league/state';
import { getLeagueHistoryForPlayer } from './league/history';
import {
  makeCode,
  makeId,
  initStandings,
  buildRoundRobinMatches,
  sortedStandings,
  applyResult,
  type Tournament,
  type TournamentPlayer,
} from './tournament/tournament';
import { computeWeeklyAwards, appendMatch } from "./stats/matchLog";
import { supabaseFetch } from './supabaseUtils';
import {
  buildDailyFritzCompletionHash,
  generateDailyFritzRun,
  generateSingleDailyFritzHand,
  getDailyFritzSeed,
  sortDailyFritzLeaderboard,
  type DailyFritzAttemptStatus,
  type DailyFritzHandDeal,
  type DailyFritzLeaderboardEntry,
  type DailyFritzRunStatus,
  type DailyFritzTier,
} from './dailyFritz';
import {
  DEFAULT_RATING,
  DEFAULT_RD,
  FRITZ_ELITE_ID,
  FRITZ_GRANDMASTER_ID,
  FRITZ_MASTER_ID,
  FRITZ_ROOKIE_ID,
  FRITZ_STANDARD_ID,
  FRITZ_SYSTEM_ID,
  isFritzId,
} from './ranking/glicko2';
import { startRankingCron } from './ranking/cron';
import { getLeaderboard, processRatingPeriod, processRealtimeMultiplayerGame } from './ranking/periodService';

import {
  createRoom,
  createReservedRoom,
  joinRoom,
  startGame,
  act,
  nextHand,
  readyForNextHand,
  getRoom,
  deleteRoom,
  getRoomLegalMoves,
  getRoomCanDraw,
  getRoomMatchEventMeta,
  getRoomMatchEventSnapshot,
  type ManualDrawAnimationStep,
  type Room,
} from './rooms';
import { appendRoomEvent, resetRoomEventLog } from './roomEvents';
import type { GameState } from './game/types';
import { assertValidGameState } from './game/invariants';

const allowedOriginPatterns = [
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https:\/\/racehorsedoms\.vercel\.app$/i,
  /^https:\/\/.*\.vercel\.app$/i,
];

const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (configuredCorsOrigins.includes(origin)) return true;
  return allowedOriginPatterns.some((pattern) => pattern.test(origin));
};

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked for origin: ${origin ?? 'unknown'}`));
  },
  credentials: true,
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

async function getAuthenticatedUserId(req: express.Request): Promise<string | null> {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return getAuthenticatedUserIdFromToken(token ?? null);
}

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    error &&
    typeof error === 'object' &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.too.large'
  ) {
    res.status(413).json({ error: 'Match result payload is too large.' });
    return;
  }
  next(error);
});

async function getAuthenticatedUserIdFromToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const cached = authenticatedUserIdCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase auth configuration is required.');
  }

  const response = await fetch(new URL('/auth/v1/user', supabaseUrl), {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    authenticatedUserIdCache.set(token, { userId: null, expiresAt: Date.now() + 10_000 });
    return null;
  }

  const user = (await response.json()) as { id?: unknown };
  const userId = typeof user.id === 'string' ? user.id : null;
  authenticatedUserIdCache.set(token, { userId, expiresAt: Date.now() + AUTHENTICATED_USER_ID_TTL_MS });
  return userId;
}

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

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

    // Get rank among non-provisional players
    const allProfiles = await supabaseFetch<any[]>(`/rest/v1/profiles?provisional=eq.false&order=glicko_rating.desc`);
    const rankIndex = allProfiles.findIndex(p => p.id === userId);
    
    res.json({
      ok: true,
      glicko_rating: profile.glicko_rating,
      glicko_rd: profile.glicko_rd,
      provisional: profile.provisional,
      ranked_games_played: profile.ranked_games_played,
      peak_rating: profile.peak_rating,
      rank: rankIndex >= 0 ? rankIndex + 1 : null
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
  const adminKey = req.body?.adminKey;

  if (adminKey !== process.env.ADMIN_SECRET) {
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

app.get('/api/ghost/profile/:userId', async (req, res) => {
  const userId = typeof req.params.userId === 'string' ? req.params.userId.trim() : '';
  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }

  try {
    const summary = await getGhostProfileSummary(userId);
    res.json({ ok: true, summary });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load ghost profile.',
    });
  }
});

app.get('/api/ghost/profile-by-username/:username', async (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
  if (!username) {
    res.status(400).json({ error: 'username is required.' });
    return;
  }

  try {
    const result = await getGhostProfileSummaryByUsername(username);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load ghost profile.',
    });
  }
});

app.post('/api/ghost/complete', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const matchId =
    typeof req.body?.matchId === 'string' && req.body.matchId.trim() ? req.body.matchId.trim() : '';
  const opponentUserId =
    typeof req.body?.opponentUserId === 'string' && req.body.opponentUserId.trim()
      ? req.body.opponentUserId.trim()
      : null;
  const localMatchId =
    typeof req.body?.localMatchId === 'string' && req.body.localMatchId.trim()
      ? req.body.localMatchId.trim()
      : null;
  const finalScore = Number(req.body?.finalScore);
  const opponentScore = Number(req.body?.opponentScore);
  const moveLog = Array.isArray(req.body?.moveLog) ? req.body.moveLog : null;
  const playerMoveLog = Array.isArray(req.body?.playerMoveLog) ? req.body.playerMoveLog : undefined;

  if (!userId) {
    res.status(400).json({ error: 'userId is required.' });
    return;
  }
  if (!matchId) {
    res.status(400).json({ error: 'matchId is required.' });
    return;
  }
  if (!Number.isFinite(finalScore) || !Number.isFinite(opponentScore)) {
    res.status(400).json({ error: 'finalScore and opponentScore are required.' });
    return;
  }
  if (
    !Number.isInteger(finalScore) ||
    !Number.isInteger(opponentScore) ||
    finalScore < 0 ||
    opponentScore < 0 ||
    finalScore > 200 ||
    opponentScore > 200
  ) {
    res.status(400).json({ error: 'Scores must be integers between 0 and 200.' });
    return;
  }
  const isFritzMatch = Boolean(opponentUserId && isFritzId(opponentUserId));
  if (!isFritzMatch && (!moveLog || !isSafeGhostMoveLog(moveLog))) {
    res.status(400).json({ error: 'moveLog is required.' });
    return;
  }
  if (playerMoveLog && !isSafeGhostMoveLog(playerMoveLog)) {
    res.status(400).json({ error: 'playerMoveLog is invalid.' });
    return;
  }
  if (opponentUserId && opponentUserId === userId) {
    res.status(400).json({ error: 'opponentUserId must refer to another player.' });
    return;
  }
  if (localMatchId && localMatchId.length > 128) {
    res.status(400).json({ error: 'localMatchId is invalid.' });
    return;
  }
  const safeMoveLog = moveLog as import('./ghost/service').GhostMoveLogEntry[];
  const safePlayerMoveLog = playerMoveLog as import('./ghost/service').GhostMoveLogEntry[] | undefined;
  if (isFritzMatch && (!safePlayerMoveLog || safePlayerMoveLog.length === 0)) {
    res.status(400).json({ error: 'playerMoveLog is required for Fritz matches.' });
    return;
  }
  const trainingMoveLog =
    isFritzMatch && safePlayerMoveLog && safePlayerMoveLog.length > 0 ? safePlayerMoveLog : safeMoveLog;
  const playerScoredPoints = trainingMoveLog.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry.score_delta ?? 0)),
    0,
  );
  if (playerScoredPoints > finalScore) {
    res.status(400).json({ error: 'player scoring log exceeds finalScore.' });
    return;
  }
  if (!isFritzMatch) {
    const opponentScoredPoints = safeMoveLog
      .filter((entry) => entry.actor === 'ghost')
      .reduce((sum, entry) => sum + Math.max(0, Number(entry.score_delta ?? 0)), 0);
    if (opponentScoredPoints > opponentScore) {
      res.status(400).json({ error: 'ghost scoring log exceeds opponentScore.' });
      return;
    }
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const verifiedMatch = await getVerifiedSinglePlayerMatch(matchId);
    if (!verifiedMatch) {
      res.status(404).json({ error: 'Verified match not found.' });
      return;
    }
    if (verifiedMatch.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    if (verifiedMatch.localMatchId !== (localMatchId ?? verifiedMatch.localMatchId)) {
      res.status(409).json({ error: 'localMatchId does not match verified session.' });
      return;
    }
    if (verifiedMatch.opponentUserId !== opponentUserId) {
      res.status(409).json({ error: 'opponentUserId does not match verified session.' });
      return;
    }
    if (verifiedMatch.mode !== (isFritzMatch ? 'fritz' : 'ghost')) {
      res.status(409).json({ error: 'verified session mode mismatch.' });
      return;
    }
    const completionHash = buildGhostCompletionHash({
      userId,
      localMatchId,
      matchId,
      opponentUserId,
      finalScore,
      opponentScore,
      moveLog: safeMoveLog,
      playerMoveLog: safePlayerMoveLog,
    });
    if (verifiedMatch.status === 'completed') {
      if (verifiedMatch.completionHash === completionHash && verifiedMatch.completionResult) {
        res.json({ ok: true, result: verifiedMatch.completionResult, replayed: true });
        return;
      }
      res.status(409).json({ error: 'Match result already finalized.' });
      return;
    }
    if (verifiedMatch.status === 'abandoned') {
      res.status(409).json({ error: 'Verified match was already abandoned.' });
      return;
    }
    if (isFritzMatch && localMatchId) {
      const roomCode = `local:${localMatchId}`;
      const pendingRows = await supabaseFetch<any[]>(
        `/rest/v1/bot_match_pending?select=id,resolved&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&order=started_at.desc,id.desc&limit=1`,
      );
      if (!pendingRows?.[0]?.id) {
        res.status(409).json({ error: 'No pending Fritz match found for this local match.' });
        return;
      }
    }

    const result = await completeGhostGame({
      userId,
      opponentUserId,
      finalScore,
      opponentScore,
      moveLog: safeMoveLog,
      playerMoveLog: safePlayerMoveLog,
      matchId,
    });
    verifiedMatch.status = 'completed';
    verifiedMatch.completedAt = new Date().toISOString();
    verifiedMatch.completionHash = completionHash;
    verifiedMatch.completionResult = result;
    await persistVerifiedSinglePlayerMatch(verifiedMatch);
    if (isFritzMatch && localMatchId) {
      const roomCode = `local:${localMatchId}`;
      await supabaseFetch(
        `/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ resolved: true }),
        },
      );
    }
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete ghost game.',
    });
  }
});

app.post('/league/assign-player', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
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
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const assignment = await assignPlayerToLeague(userId);
    res.json({ ok: true, assignment });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to assign player to league.',
    });
  }
});

app.post('/league/generate-fixtures', async (req, res) => {
  const leagueId = typeof req.body?.leagueId === 'string' ? req.body.leagueId.trim() : '';
  if (!leagueId) {
    res.status(400).json({ error: 'leagueId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const membershipRows = await supabaseFetch<any[]>(
      `/rest/v1/league_members?select=id&league_id=eq.${leagueId}&player_user_id=eq.${encodeURIComponent(authenticatedUserId)}&limit=1`,
    );
    if (!membershipRows?.[0]?.id) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const schedule = await generateLeagueFixtures(leagueId);
    res.json({
      ok: true,
      schedule,
      note:
        'Seven-member round robin requires 7 matchdays with one bye per day. This supersedes the earlier 6-day assumption.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate league fixtures.',
    });
  }
});

app.post('/league/report-result', async (req, res) => {
  const fixtureId = typeof req.body?.fixtureId === 'string' ? req.body.fixtureId.trim() : '';
  const homeScore = req.body?.homeScore;
  const awayScore = req.body?.awayScore;
  const submittedMode = typeof req.body?.mode === 'string' ? req.body.mode.trim() : '';
  const playerMemberId =
    typeof req.body?.playerMemberId === 'string' ? req.body.playerMemberId.trim() : '';
  const opponentMemberId =
    typeof req.body?.opponentMemberId === 'string' ? req.body.opponentMemberId.trim() : '';
  const roomCode = typeof req.body?.roomCode === 'string' ? req.body.roomCode.trim() : '';

  if (!fixtureId) {
    res.status(400).json({ error: 'fixtureId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const parsedHomeScore = Number(homeScore);
    const parsedAwayScore = Number(awayScore);
    if (
      !Number.isInteger(parsedHomeScore) ||
      !Number.isInteger(parsedAwayScore) ||
      parsedHomeScore < 0 ||
      parsedAwayScore < 0 ||
      parsedHomeScore > 200 ||
      parsedAwayScore > 200
    ) {
      res.status(400).json({ error: 'Scores must be integers between 0 and 200.' });
      return;
    }

    const fixtureRows = await supabaseFetch<any[]>(
      `/rest/v1/fixtures?select=id,league_id,season,home_member_id,away_member_id,status&id=eq.${fixtureId}&limit=1`,
    );
    const fixture = fixtureRows?.[0];
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found.' });
      return;
    }
    if (fixture.status === 'completed' || fixture.status === 'forfeit') {
      res.status(409).json({ error: `Fixture ${fixtureId} is already ${fixture.status}.` });
      return;
    }
    const leagueRows = await supabaseFetch<any[]>(
      `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
    );
    const league = leagueRows?.[0];
    if (!league || league.status !== 'active') {
      res.status(409).json({ error: 'This fixture is no longer playable.' });
      return;
    }

    const membershipRows = await supabaseFetch<any[]>(
      `/rest/v1/league_members?select=id,player_user_id,member_type&id=in.("${fixture.home_member_id}","${fixture.away_member_id}")`,
    );
    const homeMember = membershipRows.find((member) => member?.id === fixture.home_member_id) ?? null;
    const awayMember = membershipRows.find((member) => member?.id === fixture.away_member_id) ?? null;
    if (!homeMember || !awayMember) {
      res.status(500).json({ error: 'Fixture membership is invalid.' });
      return;
    }

    const reporterMember =
      homeMember.player_user_id === authenticatedUserId
        ? homeMember
        : awayMember.player_user_id === authenticatedUserId
          ? awayMember
          : null;
    if (!reporterMember) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const otherMember = reporterMember.id === homeMember.id ? awayMember : homeMember;
    const resolvedMode =
      submittedMode === 'ghost' || submittedMode === 'bot' || submittedMode === 'live'
        ? submittedMode
        : otherMember.member_type === 'bot'
          ? 'bot'
          : 'ghost';

    if (playerMemberId && playerMemberId !== reporterMember.id) {
      res.status(400).json({ error: 'playerMemberId does not match the reporting fixture member.' });
      return;
    }
    if (opponentMemberId && opponentMemberId !== otherMember.id) {
      res.status(400).json({ error: 'opponentMemberId does not match the fixture opponent.' });
      return;
    }

    if (resolvedMode === 'live' && (homeMember.member_type !== 'player' || awayMember.member_type !== 'player')) {
      res.status(400).json({ error: 'Live mode is only valid for player-vs-player fixtures.' });
      return;
    }
    if ((resolvedMode === 'ghost' || resolvedMode === 'bot') && fixture.status !== 'scheduled' && fixture.status !== 'provisional') {
      res.status(409).json({ error: `Fixture ${fixtureId} is not currently playable async.` });
      return;
    }
    if (resolvedMode === 'ghost' && otherMember.member_type !== 'player') {
      res.status(400).json({ error: 'Ghost mode is only valid for player-vs-player fixtures.' });
      return;
    }
    if (resolvedMode === 'bot' && otherMember.member_type !== 'bot' && submittedMode === 'bot') {
      // Bot stand-in submissions for real opponents are allowed, but only if explicitly handled by the client.
      // This stays permissive for the async-first league flow.
    }

    const result =
      resolvedMode === 'live'
        ? await recordLeagueLiveResult({
            fixtureId,
            playerMemberId: reporterMember.id,
            opponentMemberId: otherMember.id,
            homeScore: parsedHomeScore,
            awayScore: parsedAwayScore,
            sourceUserId: authenticatedUserId,
            roomCode: roomCode || null,
            metadata: { via: 'league-report-route' },
          })
        : await recordLeagueAsyncResult({
            fixtureId,
            mode: resolvedMode,
            playerMemberId: reporterMember.id,
            opponentMemberId: otherMember.id,
            homeScore: parsedHomeScore,
            awayScore: parsedAwayScore,
            sourceUserId: authenticatedUserId,
            metadata: { via: 'league-report-route' },
          });
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to record league result.',
    });
  }
});

app.post('/league/run-forfeits', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const throughDate =
    typeof req.body?.throughDate === 'string' && req.body.throughDate.trim()
      ? req.body.throughDate.trim()
      : undefined;

  try {
    const result = await runLeagueForfeitJob(throughDate);
    res.json({
      ok: true,
      result,
      note:
        'Current Step 5 behavior only auto-forfeits fixtures where exactly one side is a bot. Real-vs-real and bot-vs-bot scheduled fixtures are reported as skipped for now.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run league forfeit job.',
    });
  }
});

app.post('/league/run-rollover', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const throughDate =
    typeof req.body?.throughDate === 'string' && req.body.throughDate.trim()
      ? req.body.throughDate.trim()
      : undefined;

  try {
    const result = await runLeagueSundayRollover(throughDate);
    res.json({
      ok: true,
      result,
      note:
        'Rollover is idempotent at the weekly level: once next-week active leagues exist, reruns will not create duplicate successor leagues.',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to run league Sunday rollover.',
    });
  }
});

app.get('/league/state/:userId', async (req, res) => {
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
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const state = await getLeagueStateForPlayer(userId);
    if (state?.todaysOpponent?.memberType === 'player') {
      const opponentMember =
        state.members.find((member) => member.id === state.todaysOpponent?.memberId) ?? null;
      const opponentUserId = opponentMember?.player_user_id ?? null;
      state.todaysOpponent.online = Boolean(opponentUserId && socketsByUserId.get(opponentUserId)?.size);
    }
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load league state.',
    });
  }
});

app.get('/league/history/:userId', async (req, res) => {
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
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const history = await getLeagueHistoryForPlayer(userId);
    res.json({ ok: true, history });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load league history.',
    });
  }
});

app.post('/league/fixture/:fixtureId/live-room', async (req, res) => {
  const fixtureId = typeof req.params.fixtureId === 'string' ? req.params.fixtureId.trim() : '';
  if (!fixtureId) {
    res.status(400).json({ error: 'fixtureId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const fixtureRows = await supabaseFetch<any[]>(
      `/rest/v1/fixtures?select=id,league_id,status,home_member_id,away_member_id,live_room_code&id=eq.${fixtureId}&limit=1`,
    );
    const fixture = fixtureRows?.[0];
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found.' });
      return;
    }
    if (fixture.status === 'completed' || fixture.status === 'forfeit') {
      res.status(409).json({ error: `Fixture ${fixtureId} is already ${fixture.status}.` });
      return;
    }
    const leagueRows = await supabaseFetch<any[]>(
      `/rest/v1/leagues?select=id,status&id=eq.${fixture.league_id}&limit=1`,
    );
    const league = leagueRows?.[0];
    if (!league || league.status !== 'active') {
      res.status(409).json({ error: 'This fixture is no longer available for live play.' });
      return;
    }

    const membershipRows = await supabaseFetch<any[]>(
      `/rest/v1/league_members?select=id,player_user_id,member_type&id=in.("${fixture.home_member_id}","${fixture.away_member_id}")`,
    );
    const homeMember = membershipRows.find((member) => member?.id === fixture.home_member_id) ?? null;
    const awayMember = membershipRows.find((member) => member?.id === fixture.away_member_id) ?? null;
    if (!homeMember || !awayMember) {
      res.status(500).json({ error: 'Fixture membership is invalid.' });
      return;
    }
    if (homeMember.member_type !== 'player' || awayMember.member_type !== 'player') {
      res.status(400).json({ error: 'Live play is only available for player-vs-player fixtures.' });
      return;
    }
    if (homeMember.player_user_id !== authenticatedUserId && awayMember.player_user_id !== authenticatedUserId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const existingCode =
      typeof fixture.live_room_code === 'string' && fixture.live_room_code.trim()
        ? fixture.live_room_code.trim().toUpperCase()
        : '';
    let roomCode = existingCode;
    if (roomCode) {
      try {
        getRoom(roomCode);
      } catch {
        createReservedRoom(roomCode, { winningScore: 30 });
      }
    } else {
      do {
        roomCode = `LG-${makeCode(4)}`;
        try {
          getRoom(roomCode);
          roomCode = '';
        } catch {
          // Unused room code, safe to reserve for this fixture.
        }
      } while (!roomCode);
      roomCode = createReservedRoom(roomCode, { winningScore: 30 }).code;
      await openLeagueFixtureLiveRoom(fixtureId, roomCode);
    }

    res.json({ ok: true, fixtureId, roomCode });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to open live room.',
    });
  }
});

app.post('/bot-matches/cleanup-stale', async (_req, res) => {
  try {
    const threshold = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const staleRows = await supabaseFetch<any[]>(
      `/rest/v1/bot_match_pending?select=id,user_id,room_code,fritz_tier,started_at,resolved&resolved=eq.false&started_at=lt.${encodeURIComponent(threshold)}&order=started_at.asc`,
    );

    let processed = 0;
    for (const row of staleRows ?? []) {
      if (!row?.id || !row?.user_id) continue;
      await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
      });
      await recordPendingFritzDisconnectLoss(row.user_id, row.fritz_tier);
      processed += 1;
    }

    res.json({ ok: true, processed });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to clean stale bot matches.',
    });
  }
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Socket.IO CORS blocked for origin: ${origin ?? 'unknown'}`));
    },
    credentials: true,
  },
});

type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomJoinConfig = { username?: string; userId?: string | null; authToken?: string | null };
type AckFn = (payload: any) => void;

const roomPlayersByCode = new Map<string, RoomPlayer[]>();
const RECONNECT_GRACE_MS = 5 * 60_000;
const ROOM_CLEANUP_GRACE_MS = 5 * 60_000;
type ReconnectSeat = {
  oldSocketId: string;
  username: string;
  userId: string | null;
  expiresAt: number;
};
const reconnectSeatsByCode = new Map<string, ReconnectSeat[]>();
const socketsByUserId = new Map<string, Set<string>>();
const roomCleanupTimersByCode = new Map<string, ReturnType<typeof setTimeout>>();
let finalizeTournamentMatchHook: ((room: any) => void) | null = null;

type VerifiedSinglePlayerMatch = {
  matchId: string;
  userId: string;
  localMatchId: string;
  mode: 'ghost' | 'fritz';
  opponentUserId: string | null;
  fritzTier: string | null;
  status: 'started' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt: string | null;
  completionHash: string | null;
  completionResult: Record<string, unknown> | null;
};

type VerifiedSinglePlayerMatchRow = {
  match_id: string;
  user_id: string;
  local_match_id: string;
  mode: 'ghost' | 'fritz';
  opponent_user_id: string | null;
  fritz_tier: string | null;
  status: 'started' | 'completed' | 'abandoned';
  started_at: string;
  completed_at: string | null;
  completion_hash: string | null;
  completion_result: Record<string, unknown> | null;
};

type DailyFritzRunRow = {
  run_date: string;
  seed: string;
  fritz_tier: DailyFritzTier;
  deal_size: number;
  winning_score: number;
  status: DailyFritzRunStatus;
  hand_deals: DailyFritzHandDeal[];
  generated_at: string;
  invalidated_at: string | null;
  metadata: Record<string, unknown> | null;
};

type DailyFritzAttemptRow = {
  id: string;
  run_date: string;
  user_id: string;
  status: DailyFritzAttemptStatus;
  current_hand_index: number;
  started_at: string;
  completed_at: string | null;
  verified_match_id: string | null;
  completion_hash: string | null;
  result: Record<string, unknown> | null;
  final_score: number | null;
  opponent_score: number | null;
  point_diff: number | null;
  won: boolean | null;
  moves_used: number | null;
  hands_played: number | null;
};

type DailyFritzRunRecord = {
  runDate: string;
  seed: string;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  status: DailyFritzRunStatus;
  handDeals: DailyFritzHandDeal[];
  generatedAt: string;
  invalidatedAt: string | null;
  metadata: Record<string, unknown> | null;
};

type DailyFritzRunSummary = {
  runDate: string;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  status: DailyFritzRunStatus;
};

type DailyFritzAttemptRecord = {
  id: string;
  runDate: string;
  userId: string;
  status: DailyFritzAttemptStatus;
  currentHandIndex: number;
  startedAt: string;
  completedAt: string | null;
  verifiedMatchId: string | null;
  completionHash: string | null;
  result: Record<string, unknown> | null;
  finalScore: number | null;
  opponentScore: number | null;
  pointDiff: number | null;
  won: boolean | null;
  movesUsed: number | null;
  handsPlayed: number | null;
};

type PersistedRoomMatchLogStatus = 'completed' | 'abandoned';

type PersistedRoomParticipant = {
  id: string;
  username: string;
  userId: string | null;
  seatIndex: number;
};

type PersistedRoomMatchLogRow = {
  match_id: string;
  room_code: string;
  status: PersistedRoomMatchLogStatus;
  event_log_version: number;
  last_event_sequence: number;
  event_count: number;
  started_at: string | null;
  archived_at: string;
  participant_user_ids: string[];
  participants: PersistedRoomParticipant[];
  summary: Record<string, unknown> | null;
  state_snapshot: Record<string, unknown> | null;
  events: ReturnType<typeof getRoomMatchEventSnapshot>['events'];
};

const verifiedSinglePlayerMatches = new Map<string, VerifiedSinglePlayerMatch>();
const verifiedSinglePlayerMatchesByLocalKey = new Map<string, string>();
let persistentVerifiedMatchesAvailable: boolean | null = null;
let persistentRoomMatchLogsAvailable: boolean | null = null;
const authenticatedUserIdCache = new Map<string, { userId: string | null; expiresAt: number }>();
const AUTHENTICATED_USER_ID_TTL_MS = 60_000;
const dailyFritzRunCache = new Map<string, DailyFritzRunRecord>();

function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

function normalizeUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  return raw || null;
}

function normalizeAuthToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  return raw || null;
}

async function resolveSocketIdentity(config: RoomJoinConfig): Promise<{ username: string; userId: string | null }> {
  const username = normalizeUsername(config.username);
  const claimedUserId = normalizeUserId(config.userId);
  const authToken = normalizeAuthToken(config.authToken);
  if (!authToken) {
    // Do not trust client-claimed production UUIDs without a verified token.
    // Non-UUID ids are kept for local smoke tests and legacy guest-style flows.
    return { username, userId: claimedUserId && !isUuidLike(claimedUserId) ? claimedUserId : null };
  }

  const verifiedUserId = await getAuthenticatedUserIdFromToken(authToken);
  return { username, userId: verifiedUserId };
}

function isUuidLike(value: string | null | undefined): boolean {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function isGhostTileKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-6]\|[0-6]$/.test(value);
}

function isGhostBranch(value: unknown): value is string | null {
  return (
    value == null ||
    value === 'left' ||
    value === 'right' ||
    value === 'draw' ||
    value === 'pass' ||
    (typeof value === 'string' && /^branch-\d+-\d+$/.test(value))
  );
}

function isSafeGhostMoveLog(raw: unknown): raw is Array<Record<string, unknown>> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) return false;
  let previousTurn = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return false;
    const record = entry as Record<string, unknown>;
    const turn = Number(record.turn);
    const handNumber = record.hand_number == null ? null : Number(record.hand_number);
    const scoreDelta = Number(record.score_delta ?? 0);
    const boardState = record.board_state;
    const handBefore = record.hand_before;
    const actor = record.actor;
    const tilePlayed = record.tile_played;
    const branch = record.branch;
    const forcedDraw = Boolean(record.forced_draw);
    if (!Number.isInteger(turn) || turn <= 0 || turn <= previousTurn) return false;
    if (handNumber != null && (!Number.isInteger(handNumber) || handNumber <= 0 || handNumber > 50)) {
      return false;
    }
    if (!Number.isFinite(scoreDelta) || scoreDelta < 0 || scoreDelta > 100) return false;
    if (typeof boardState !== 'string' || boardState.trim().length === 0 || boardState.length > 20000) {
      return false;
    }
    if (
      !Array.isArray(handBefore) ||
      handBefore.length > 28 ||
      handBefore.some((item) => !isGhostTileKey(item))
    ) {
      return false;
    }
    if (actor != null && actor !== 'you' && actor !== 'ghost') return false;
    if (!(tilePlayed == null || isGhostTileKey(tilePlayed))) return false;
    if (!isGhostBranch(branch)) return false;
    if (tilePlayed && !handBefore.includes(tilePlayed)) return false;
    if ((branch === 'draw' || branch === 'pass') && tilePlayed != null) return false;
    if ((branch === 'draw' || branch === 'pass') && scoreDelta !== 0) return false;
    if (forcedDraw && tilePlayed == null) return false;
    previousTurn = turn;
  }
  return true;
}

function makeVerifiedSinglePlayerKey(userId: string, localMatchId: string): string {
  return `${userId}:${localMatchId}`;
}

function buildGhostCompletionHash(params: {
  userId: string;
  localMatchId: string | null;
  matchId: string;
  opponentUserId: string | null;
  finalScore: number;
  opponentScore: number;
  moveLog: import('./ghost/service').GhostMoveLogEntry[];
  playerMoveLog?: import('./ghost/service').GhostMoveLogEntry[];
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        userId: params.userId,
        localMatchId: params.localMatchId,
        matchId: params.matchId,
        opponentUserId: params.opponentUserId,
        finalScore: params.finalScore,
        opponentScore: params.opponentScore,
        moveLog: params.moveLog,
        playerMoveLog: params.playerMoveLog ?? null,
      }),
    )
    .digest('hex');
}

function toVerifiedSinglePlayerMatch(row: VerifiedSinglePlayerMatchRow): VerifiedSinglePlayerMatch {
  return {
    matchId: row.match_id,
    userId: row.user_id,
    localMatchId: row.local_match_id,
    mode: row.mode,
    opponentUserId: row.opponent_user_id,
    fritzTier: row.fritz_tier,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completionHash: row.completion_hash,
    completionResult: row.completion_result,
  };
}

function toVerifiedSinglePlayerMatchRow(
  record: VerifiedSinglePlayerMatch,
): VerifiedSinglePlayerMatchRow {
  return {
    match_id: record.matchId,
    user_id: record.userId,
    local_match_id: record.localMatchId,
    mode: record.mode,
    opponent_user_id: record.opponentUserId,
    fritz_tier: record.fritzTier,
    status: record.status,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    completion_hash: record.completionHash,
    completion_result: record.completionResult,
  };
}

function cacheVerifiedSinglePlayerMatch(record: VerifiedSinglePlayerMatch): VerifiedSinglePlayerMatch {
  verifiedSinglePlayerMatches.set(record.matchId, record);
  verifiedSinglePlayerMatchesByLocalKey.set(
    makeVerifiedSinglePlayerKey(record.userId, record.localMatchId),
    record.matchId,
  );
  return record;
}

function isMissingVerifiedMatchesTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('verified_single_player_matches') &&
    (message.includes('does not exist') ||
      message.includes('pgrst205') ||
      message.includes('schema cache') ||
      message.includes('could not find the table'))
  );
}

async function queryVerifiedSinglePlayerMatchByLocalKey(
  userId: string,
  localMatchId: string,
): Promise<VerifiedSinglePlayerMatch | null> {
  const key = makeVerifiedSinglePlayerKey(userId, localMatchId);
  const cachedId = verifiedSinglePlayerMatchesByLocalKey.get(key);
  if (cachedId) {
    const cached = verifiedSinglePlayerMatches.get(cachedId);
    if (cached) return cached;
  }
  if (persistentVerifiedMatchesAvailable === false) return null;
  try {
    const rows = await supabaseFetch<VerifiedSinglePlayerMatchRow[]>(
      `/rest/v1/verified_single_player_matches?select=match_id,user_id,local_match_id,mode,opponent_user_id,fritz_tier,status,started_at,completed_at,completion_hash,completion_result&user_id=eq.${encodeURIComponent(userId)}&local_match_id=eq.${encodeURIComponent(localMatchId)}&limit=1`,
      { method: 'GET' },
    );
    persistentVerifiedMatchesAvailable = true;
    const row = rows[0];
    return row ? cacheVerifiedSinglePlayerMatch(toVerifiedSinglePlayerMatch(row)) : null;
  } catch (error) {
    if (isMissingVerifiedMatchesTable(error)) {
      persistentVerifiedMatchesAvailable = false;
      console.warn('[verified-matches] persistence table missing, using in-memory fallback');
      return null;
    }
    throw error;
  }
}

async function queryVerifiedSinglePlayerMatchByMatchId(
  matchId: string,
): Promise<VerifiedSinglePlayerMatch | null> {
  const cached = verifiedSinglePlayerMatches.get(matchId);
  if (cached) return cached;
  if (persistentVerifiedMatchesAvailable === false) return null;
  try {
    const rows = await supabaseFetch<VerifiedSinglePlayerMatchRow[]>(
      `/rest/v1/verified_single_player_matches?select=match_id,user_id,local_match_id,mode,opponent_user_id,fritz_tier,status,started_at,completed_at,completion_hash,completion_result&match_id=eq.${encodeURIComponent(matchId)}&limit=1`,
      { method: 'GET' },
    );
    persistentVerifiedMatchesAvailable = true;
    const row = rows[0];
    return row ? cacheVerifiedSinglePlayerMatch(toVerifiedSinglePlayerMatch(row)) : null;
  } catch (error) {
    if (isMissingVerifiedMatchesTable(error)) {
      persistentVerifiedMatchesAvailable = false;
      return null;
    }
    throw error;
  }
}

async function persistVerifiedSinglePlayerMatch(
  record: VerifiedSinglePlayerMatch,
): Promise<VerifiedSinglePlayerMatch> {
  cacheVerifiedSinglePlayerMatch(record);
  if (persistentVerifiedMatchesAvailable === false) return record;
  try {
    await supabaseFetch<VerifiedSinglePlayerMatchRow[]>(
      `/rest/v1/verified_single_player_matches?on_conflict=match_id`,
      {
        method: 'POST',
        headers: {
          Prefer: 'return=representation,resolution=merge-duplicates',
        },
        body: JSON.stringify([toVerifiedSinglePlayerMatchRow(record)]),
      },
    );
    persistentVerifiedMatchesAvailable = true;
    return record;
  } catch (error) {
    if (isMissingVerifiedMatchesTable(error)) {
      persistentVerifiedMatchesAvailable = false;
      console.warn('[verified-matches] persistence table missing, using in-memory fallback');
      return record;
    }
    throw error;
  }
}

async function startVerifiedSinglePlayerMatch(params: {
  userId: string;
  localMatchId: string;
  mode: 'ghost' | 'fritz';
  opponentUserId: string | null;
  fritzTier?: string | null;
}): Promise<VerifiedSinglePlayerMatch> {
  const existing = await queryVerifiedSinglePlayerMatchByLocalKey(params.userId, params.localMatchId);
  if (existing) {
    return existing;
  }

  const record: VerifiedSinglePlayerMatch = {
    matchId: randomUUID(),
    userId: params.userId,
    localMatchId: params.localMatchId,
    mode: params.mode,
    opponentUserId: params.opponentUserId,
    fritzTier: params.fritzTier ?? null,
    status: 'started',
    startedAt: new Date().toISOString(),
    completedAt: null,
    completionHash: null,
    completionResult: null,
  };
  return persistVerifiedSinglePlayerMatch(record);
}

async function getVerifiedSinglePlayerMatch(matchId: string): Promise<VerifiedSinglePlayerMatch | null> {
  return queryVerifiedSinglePlayerMatchByMatchId(matchId);
}

async function abandonVerifiedSinglePlayerMatch(userId: string, localMatchId: string): Promise<void> {
  const record = await queryVerifiedSinglePlayerMatchByLocalKey(userId, localMatchId);
  if (!record || record.status !== 'started') return;
  record.status = 'abandoned';
  await persistVerifiedSinglePlayerMatch(record);
}

function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getPacificDateTimeParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const getNumber = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: getNumber('year'),
    month: getNumber('month'),
    day: getNumber('day'),
    hour: getNumber('hour'),
    minute: getNumber('minute'),
    second: getNumber('second'),
  };
}

function getPacificOffsetMinutes(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-8';
  const match = raw.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return -8 * 60;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function getPacificDateKeyDaysFromNow(daysFromNow: number): string {
  return getPacificDateKey(new Date(Date.now() + daysFromNow * 86400000));
}

function getNextPacificWarmupAt(hour = 0, minute = 2): Date {
  const now = new Date();
  const pacific = getPacificDateTimeParts(now);
  const nextUtcGuess = new Date(Date.UTC(pacific.year, pacific.month - 1, pacific.day + 1, hour, minute, 0, 0));
  const offsetMinutes = getPacificOffsetMinutes(nextUtcGuess);
  return new Date(nextUtcGuess.getTime() - offsetMinutes * 60000);
}

function normalizeDailyFritzTier(value: unknown): DailyFritzTier | null {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'rookie' || raw === 'standard' || raw === 'elite' || raw === 'master') {
    return raw;
  }
  return null;
}

function normalizeDailyFritzStatus(value: unknown): DailyFritzRunStatus | null {
  return value === 'live' || value === 'archived' || value === 'invalidated' ? value : null;
}

function isTile(value: unknown): value is { low: number; high: number } {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return Number.isInteger(rec.low) && Number.isInteger(rec.high);
}

function normalizeTile(value: unknown): { low: number; high: number } | null {
  if (Array.isArray(value) && value.length === 2) {
    const low = Number(value[0]);
    const high = Number(value[1]);
    if (!Number.isInteger(low) || !Number.isInteger(high)) return null;
    return { low: Math.min(low, high), high: Math.max(low, high) };
  }
  if (!isTile(value)) return null;
  return {
    low: Math.min(value.low, value.high),
    high: Math.max(value.low, value.high),
  };
}

function normalizeTileArray(value: unknown): { low: number; high: number }[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((tile) => normalizeTile(tile))
    .filter((tile): tile is { low: number; high: number } => Boolean(tile));
}

function normalizeDailyFritzHandDeal(value: unknown): DailyFritzHandDeal | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const playerTiles = normalizeTileArray(rec.player_tiles);
  const fritzTiles = normalizeTileArray(rec.fritz_tiles);
  const boneyard = normalizeTileArray(rec.boneyard);
  const locked = normalizeTileArray(rec.locked);
  if (playerTiles.length === 0 || fritzTiles.length === 0) return null;
  return {
    player_tiles: playerTiles,
    fritz_tiles: fritzTiles,
    boneyard,
    locked,
  };
}

function toDailyFritzRunRecord(row: DailyFritzRunRow): DailyFritzRunRecord | null {
  const fritzTier = normalizeDailyFritzTier(row.fritz_tier);
  const status = normalizeDailyFritzStatus(row.status);
  const dealSize = Number(row.deal_size) === 14 ? 14 : Number(row.deal_size) === 7 ? 7 : null;
  const handDealsRaw = Array.isArray(row.hand_deals) ? row.hand_deals : [];
  const handDeals = handDealsRaw
    .map((deal) => normalizeDailyFritzHandDeal(deal))
    .filter((deal): deal is DailyFritzHandDeal => Boolean(deal));
  if (!fritzTier || !status || !dealSize || handDeals.length !== 12) return null;
  return {
    runDate: row.run_date,
    seed: row.seed,
    fritzTier,
    dealSize,
    winningScore: Number(row.winning_score) || 60,
    status,
    handDeals,
    generatedAt: row.generated_at,
    invalidatedAt: row.invalidated_at,
    metadata: row.metadata ?? null,
  };
}

function toDailyFritzRunRow(record: DailyFritzRunRecord): DailyFritzRunRow {
  return {
    run_date: record.runDate,
    seed: record.seed,
    fritz_tier: record.fritzTier,
    deal_size: record.dealSize,
    winning_score: record.winningScore,
    status: record.status,
    hand_deals: record.handDeals,
    generated_at: record.generatedAt,
    invalidated_at: record.invalidatedAt,
    metadata: record.metadata,
  };
}

function toDailyFritzAttemptRecord(row: DailyFritzAttemptRow): DailyFritzAttemptRecord {
  return {
    id: row.id,
    runDate: row.run_date,
    userId: row.user_id,
    status: row.status,
    currentHandIndex: Number(row.current_hand_index) || 0,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    verifiedMatchId: row.verified_match_id,
    completionHash: row.completion_hash,
    result: row.result ?? null,
    finalScore: row.final_score == null ? null : Number(row.final_score),
    opponentScore: row.opponent_score == null ? null : Number(row.opponent_score),
    pointDiff: row.point_diff == null ? null : Number(row.point_diff),
    won: typeof row.won === 'boolean' ? row.won : null,
    movesUsed: row.moves_used == null ? null : Number(row.moves_used),
    handsPlayed: row.hands_played == null ? null : Number(row.hands_played),
  };
}

function toDailyFritzAttemptRow(record: DailyFritzAttemptRecord): DailyFritzAttemptRow {
  return {
    id: record.id,
    run_date: record.runDate,
    user_id: record.userId,
    status: record.status,
    current_hand_index: record.currentHandIndex,
    started_at: record.startedAt,
    completed_at: record.completedAt,
    verified_match_id: record.verifiedMatchId,
    completion_hash: record.completionHash,
    result: record.result,
    final_score: record.finalScore,
    opponent_score: record.opponentScore,
    point_diff: record.pointDiff,
    won: record.won,
    moves_used: record.movesUsed,
    hands_played: record.handsPlayed,
  };
}

function isMissingDailyFritzTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('daily_fritz_') &&
    (message.includes('does not exist') ||
      message.includes('pgrst205') ||
      message.includes('schema cache') ||
      message.includes('could not find the table'))
  );
}

async function getDailyFritzRun(runDate: string): Promise<DailyFritzRunRecord | null> {
  const cached = dailyFritzRunCache.get(runDate);
  if (cached) return cached;
  const rows = await supabaseFetch<DailyFritzRunRow[]>(
    `/rest/v1/daily_fritz_runs?select=run_date,seed,fritz_tier,deal_size,winning_score,status,hand_deals,generated_at,invalidated_at,metadata&run_date=eq.${encodeURIComponent(runDate)}&limit=1`,
    { method: 'GET' },
  );
  const record = rows[0] ? toDailyFritzRunRecord(rows[0]) : null;
  if (record) dailyFritzRunCache.set(runDate, record);
  return record;
}

async function getDailyFritzRunSummary(runDate: string): Promise<DailyFritzRunSummary | null> {
  const cached = dailyFritzRunCache.get(runDate);
  if (cached) {
    return {
      runDate: cached.runDate,
      fritzTier: cached.fritzTier,
      dealSize: cached.dealSize,
      winningScore: cached.winningScore,
      status: cached.status,
    };
  }
  const rows = await supabaseFetch<Array<{
    run_date: string;
    fritz_tier: DailyFritzTier;
    deal_size: number;
    winning_score: number;
    status: DailyFritzRunStatus;
  }>>(
    `/rest/v1/daily_fritz_runs?select=run_date,fritz_tier,deal_size,winning_score,status&run_date=eq.${encodeURIComponent(runDate)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows[0];
  if (!row) return null;
  const dealSize = row.deal_size === 7 || row.deal_size === 14 ? row.deal_size : null;
  if (!dealSize) return null;
  return {
    runDate: row.run_date,
    fritzTier: row.fritz_tier,
    dealSize,
    winningScore: row.winning_score,
    status: row.status,
  };
}

async function upsertDailyFritzRun(record: DailyFritzRunRecord): Promise<DailyFritzRunRecord> {
  const rows = await supabaseFetch<DailyFritzRunRow[]>(
    '/rest/v1/daily_fritz_runs?on_conflict=run_date',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([toDailyFritzRunRow(record)]),
    },
  );
  const saved = rows[0] ? toDailyFritzRunRecord(rows[0]) : null;
  if (!saved) throw new Error('Failed to persist daily Fritz run.');
  dailyFritzRunCache.set(saved.runDate, saved);
  return saved;
}

async function ensureDailyFritzRunForDate(
  runDate: string,
  options?: { fritzTier?: DailyFritzTier; dealSize?: 7 | 14; winningScore?: number },
  diagnostics?: {
    requestId?: string;
    log: (label: string, ms: number, extra?: Record<string, unknown>) => void;
  },
): Promise<DailyFritzRunRecord | null> {
  try {
    const existingStartedAt = Date.now();
    const existing = await getDailyFritzRun(runDate);
    diagnostics?.log('ensure:getDailyFritzRun', Date.now() - existingStartedAt, {
      cacheHit: Boolean(existing),
      requestId: diagnostics.requestId,
      runDate,
    });
    if (existing) return existing;

    const generateStartedAt = Date.now();
    const generated = generateDailyFritzRun(
      runDate,
      options?.fritzTier ?? 'elite',
      options?.dealSize ?? 7,
      options?.winningScore ?? 60,
    );
    diagnostics?.log('ensure:generateDailyFritzRun', Date.now() - generateStartedAt, {
      requestId: diagnostics?.requestId,
      runDate,
      dealSize: generated.dealSize,
      winningScore: generated.winningScore,
      handCount: generated.handDeals.length,
    });

    const upsertStartedAt = Date.now();
    const saved = await upsertDailyFritzRun({
      runDate: generated.runDate,
      seed: generated.seed,
      fritzTier: generated.fritzTier,
      dealSize: generated.dealSize,
      winningScore: generated.winningScore,
      status: generated.status,
      handDeals: generated.handDeals,
      generatedAt: generated.generatedAt,
      invalidatedAt: generated.invalidatedAt,
      metadata: generated.metadata,
    });
    diagnostics?.log('ensure:upsertDailyFritzRun', Date.now() - upsertStartedAt, {
      requestId: diagnostics?.requestId,
      runDate,
      persisted: Boolean(saved),
    });
    return saved;
  } catch (error) {
    if (isMissingDailyFritzTable(error)) {
      console.warn('[daily-fritz] table missing; apply supabase/daily_fritz.sql');
      return null;
    }
    throw error;
  }
}

async function warmDailyFritzRuns(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-fritz-warmup] start', {
    reason,
    runDates,
  });
  try {
    const results = await Promise.all(
      runDates.map(async (runDate) => {
        const beforeCached = dailyFritzRunCache.has(runDate);
        const warmedStartedAt = Date.now();
        const run = await ensureDailyFritzRunForDate(runDate);
        return {
          runDate,
          ms: Date.now() - warmedStartedAt,
          beforeCached,
          afterCached: dailyFritzRunCache.has(runDate),
          status: run?.status ?? null,
        };
      }),
    );
    console.log('[daily-fritz-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-fritz-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleDailyFritzWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyFritzRuns('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyFritzWarmup();
  }, delayMs);
}

async function getDailyFritzAttempt(runDate: string, userId: string): Promise<DailyFritzAttemptRecord | null> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&run_date=eq.${encodeURIComponent(runDate)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
}

async function getDailyFritzAttemptById(
  attemptId: string,
  userId: string,
): Promise<DailyFritzAttemptRecord | null> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&id=eq.${encodeURIComponent(attemptId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
}

async function upsertDailyFritzAttempt(record: DailyFritzAttemptRecord): Promise<DailyFritzAttemptRecord> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    '/rest/v1/daily_fritz_attempts?on_conflict=id',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([toDailyFritzAttemptRow(record)]),
    },
  );
  const saved = rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
  if (!saved) throw new Error('Failed to persist daily Fritz attempt.');
  return saved;
}

async function createDailyFritzAttempt(runDate: string, userId: string): Promise<DailyFritzAttemptRecord> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    '/rest/v1/daily_fritz_attempts',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        run_date: runDate,
        user_id: userId,
        status: 'started',
        current_hand_index: 0,
      }]),
    },
  );
  const saved = rows[0] ? toDailyFritzAttemptRecord(rows[0]) : null;
  if (!saved) throw new Error('Failed to create daily Fritz attempt.');
  return saved;
}

async function listDailyFritzAttemptsForDate(runDate: string): Promise<DailyFritzAttemptRecord[]> {
  const rows = await supabaseFetch<DailyFritzAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,current_hand_index,started_at,completed_at,verified_match_id,completion_hash,result,final_score,opponent_score,point_diff,won,moves_used,hands_played&run_date=eq.${encodeURIComponent(runDate)}&status=eq.completed&order=completed_at.asc,id.asc`,
    { method: 'GET' },
  );
  return rows.map(toDailyFritzAttemptRecord);
}

async function fetchProfileNames(userIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map<string, string>();
  if (uniqueIds.length === 0) return out;
  const idClause = uniqueIds.map((id) => `"${id}"`).join(',');
  const rows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=in.(${encodeURIComponent(idClause)})`,
    { method: 'GET' },
  );
  for (const row of rows) {
    const username = typeof row.username === 'string' && row.username.trim()
      ? row.username.trim()
      : `user_${row.id.slice(0, 8)}`;
    out.set(row.id, username);
  }
  return out;
}

async function buildDailyFritzLeaderboard(
  runDate: string,
): Promise<Array<DailyFritzLeaderboardEntry & { rank: number; userId: string }>> {
  const attempts = await listDailyFritzAttemptsForDate(runDate);
  const names = await fetchProfileNames(attempts.map((attempt) => attempt.userId));
  const sorted = sortDailyFritzLeaderboard(
    attempts
      .filter(
        (attempt): attempt is DailyFritzAttemptRecord & {
          won: boolean;
          finalScore: number;
          opponentScore: number;
          pointDiff: number;
          movesUsed: number;
          completedAt: string;
        } =>
          typeof attempt.won === 'boolean' &&
          typeof attempt.finalScore === 'number' &&
          typeof attempt.opponentScore === 'number' &&
          typeof attempt.pointDiff === 'number' &&
          typeof attempt.movesUsed === 'number' &&
          typeof attempt.completedAt === 'string',
      )
      .map((attempt) => ({
        userId: attempt.userId,
        username: names.get(attempt.userId) ?? `user_${attempt.userId.slice(0, 8)}`,
        won: attempt.won,
        finalScore: attempt.finalScore,
        opponentScore: attempt.opponentScore,
        pointDiff: attempt.pointDiff,
        movesUsed: attempt.movesUsed,
        completedAt: attempt.completedAt,
      })),
  );
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function getDailyFritzStreak(userId: string, todayRunDate: string): Promise<number> {
  const rows = await supabaseFetch<Array<{ run_date: string; status: DailyFritzAttemptStatus }>>(
    `/rest/v1/daily_fritz_attempts?select=run_date,status&user_id=eq.${encodeURIComponent(userId)}&status=in.(started,completed,abandoned)&order=run_date.desc&limit=365`,
    { method: 'GET' },
  );
  const dates = Array.from(
    new Set(
      rows
        .map((row) => row.run_date)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ).sort((a, b) => b.localeCompare(a));
  if (!dates.includes(todayRunDate)) return 0;
  let streak = 0;
  let cursor = new Date(`${todayRunDate}T00:00:00-08:00`);
  while (true) {
    const key = getPacificDateKey(cursor);
    if (!dates.includes(key)) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

function isMissingRoomMatchLogsTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('room_match_logs') && message.includes('does not exist');
}

function buildPersistedRoomParticipants(roomCode: string, room: Room): PersistedRoomParticipant[] {
  const roster = getRoomPlayersWithFallback(roomCode, room.players);
  return roster.map((player, seatIndex) => ({
    id: player.id,
    username: player.username,
    userId: player.userId,
    seatIndex,
  }));
}

function buildPersistedRoomSummary(
  room: Room,
  status: PersistedRoomMatchLogStatus,
): Record<string, unknown> | null {
  if (!room.state) {
    return {
      status,
      gameStarted: false,
      playerCount: room.players.length,
      winningScore:
        typeof (room.config as Record<string, unknown>)?.winningScore === 'number'
          ? (room.config as Record<string, unknown>).winningScore
          : null,
    };
  }

  return {
    status,
    gameStarted: true,
    gameOver: room.state.gameOver,
    handOver: room.state.handOver,
    handNumber: room.state.handNumber,
    winnerId: room.state.winnerId ?? null,
    currentPlayerId: room.state.playerIds[room.state.currentPlayerIndex] ?? null,
    winningScore: room.state.config.winningScore,
    scores: Object.fromEntries(
      room.state.playerIds.map((playerId) => [playerId, room.state?.players[playerId]?.score ?? 0]),
    ),
    handCounts: Object.fromEntries(
      room.state.playerIds.map((playerId) => [playerId, room.state?.players[playerId]?.hand.length ?? 0]),
    ),
  };
}

function toPersistedRoomMatchLogRow(
  room: Room,
  status: PersistedRoomMatchLogStatus,
): PersistedRoomMatchLogRow {
  const snapshot = getRoomMatchEventSnapshot(room.code);
  const participants = buildPersistedRoomParticipants(room.code, room);
  const participantUserIds = participants
    .map((participant) => participant.userId)
    .filter((userId): userId is string => isUuidLike(userId));

  return {
    match_id: snapshot.matchId,
    room_code: snapshot.roomCode,
    status,
    event_log_version: snapshot.version,
    last_event_sequence: snapshot.lastEventSequence,
    event_count: snapshot.eventCount,
    started_at: snapshot.events[0]?.timestamp ?? null,
    archived_at: new Date().toISOString(),
    participant_user_ids: participantUserIds,
    participants,
    summary: buildPersistedRoomSummary(room, status),
    state_snapshot: room.state ? (room.state as unknown as Record<string, unknown>) : null,
    events: snapshot.events,
  };
}

async function persistRoomMatchLog(room: Room, status: PersistedRoomMatchLogStatus): Promise<void> {
  if (room.events.length === 0) return;
  if (persistentRoomMatchLogsAvailable === false) return;

  try {
    await supabaseFetch<PersistedRoomMatchLogRow[]>(
      '/rest/v1/room_match_logs?on_conflict=match_id',
      {
        method: 'POST',
        headers: {
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify([toPersistedRoomMatchLogRow(room, status)]),
      },
    );
    persistentRoomMatchLogsAvailable = true;
  } catch (error) {
    if (isMissingRoomMatchLogsTable(error)) {
      persistentRoomMatchLogsAvailable = false;
      console.warn('[room-match-logs] persistence table missing, skipping archive');
      return;
    }
    throw error;
  }
}

async function queryPersistedRoomMatchLog(matchId: string): Promise<PersistedRoomMatchLogRow | null> {
  if (persistentRoomMatchLogsAvailable === false) return null;

  try {
    const rows = await supabaseFetch<PersistedRoomMatchLogRow[]>(
      `/rest/v1/room_match_logs?select=match_id,room_code,status,event_log_version,last_event_sequence,event_count,started_at,archived_at,participant_user_ids,participants,summary,state_snapshot,events&match_id=eq.${encodeURIComponent(matchId)}&limit=1`,
      { method: 'GET' },
    );
    persistentRoomMatchLogsAvailable = true;
    return rows[0] ?? null;
  } catch (error) {
    if (isMissingRoomMatchLogsTable(error)) {
      persistentRoomMatchLogsAvailable = false;
      return null;
    }
    throw error;
  }
}

function getFritzTierForRoom(room: Room, botPlayerId: string | null): string {
  const cfg = (room as any).config ?? {};
  if (typeof cfg.fritzTier === 'string' && cfg.fritzTier.trim()) {
    return cfg.fritzTier.trim().toLowerCase();
  }

  const rawBotId = typeof botPlayerId === 'string' ? botPlayerId.toLowerCase() : '';
  if (rawBotId.includes('rookie')) return 'rookie';
  if (rawBotId.includes('standard')) return 'standard';
  if (rawBotId.includes('grandmaster')) return 'grandmaster';
  if (rawBotId.includes('master')) return 'master';
  return 'elite';
}

function getPendingFritzMatchContext(room: Room): { realPlayer: RoomPlayer; fritzTier: string } | null {
  const roster = roomPlayersByCode.get(room.code) ?? getRoomPlayersWithFallback(room.code, room.players);
  const botPlayer = roster.find((player) => typeof player.id === 'string' && player.id.startsWith('bot:fritz:')) ?? null;
  const realPlayers = roster.filter((player) => player.userId);
  if (!botPlayer || realPlayers.length !== 1) return null;
  return {
    realPlayer: realPlayers[0],
    fritzTier: getFritzTierForRoom(room, botPlayer.id),
  };
}

function getFritzIdentityForTier(rawTier: unknown): { fritzId: string; gameType: string } {
  const tier = typeof rawTier === 'string' ? rawTier.trim().toLowerCase() : '';
  // Keep storage-compatible legacy game_type while rating identity stays distinct via opponent_id.
  if (tier === 'rookie') return { fritzId: FRITZ_ROOKIE_ID, gameType: 'fritz' };
  if (tier === 'standard') return { fritzId: FRITZ_STANDARD_ID, gameType: 'fritz' };
  if (tier === 'master') return { fritzId: FRITZ_MASTER_ID, gameType: 'fritz' };
  if (tier === 'grandmaster') return { fritzId: FRITZ_GRANDMASTER_ID, gameType: 'fritz' };
  return { fritzId: FRITZ_ELITE_ID, gameType: 'fritz' };
}

async function insertPendingFritzMatch(room: Room) {
  const pendingContext = getPendingFritzMatchContext(room);
  if (!pendingContext) return;

  await supabaseFetch('/rest/v1/bot_match_pending', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: pendingContext.realPlayer.userId,
      fritz_tier: pendingContext.fritzTier,
      room_code: room.code,
      resolved: false,
    }),
  });
}

async function resolvePendingFritzMatch(roomCode: string) {
  await supabaseFetch(
    `/rest/v1/bot_match_pending?room_code=eq.${roomCode}&resolved=eq.false`,
    {
      method: 'PATCH',
      body: JSON.stringify({ resolved: true }),
    },
  );
}

async function recordPendingFritzDisconnectLoss(userId: string, fritzTier: unknown = 'elite') {
  const profileRows = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${userId}&limit=1`);
  const profile = profileRows?.[0];
  if (!profile) {
    throw new Error(`Ranking profile not found for user ${userId}`);
  }
  const { fritzId, gameType } = getFritzIdentityForTier(fritzTier);

  await supabaseFetch('/rest/v1/ranked_games', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      player_id: userId,
      opponent_id: fritzId,
      player_score: 0,
      opponent_score: 60,
      game_type: gameType,
      rating_before: profile.glicko_rating,
      rd_before: profile.glicko_rd,
      played_at: new Date().toISOString(),
    }),
  });

  await processRatingPeriod(userId);
}

app.post('/api/bot-matches/local/start', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const fritzTier = typeof req.body?.fritzTier === 'string' ? req.body.fritzTier.trim().toLowerCase() : 'elite';
  const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
  if (!userId || !localMatchId) {
    res.status(400).json({ error: 'userId and localMatchId are required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const roomCode = `local:${localMatchId}`;
    const verifiedMatch = await startVerifiedSinglePlayerMatch({
      userId,
      localMatchId,
      mode: 'fritz',
      opponentUserId: getFritzIdentityForTier(fritzTier).fritzId,
      fritzTier,
    });
    const existing = await supabaseFetch<any[]>(
      `/rest/v1/bot_match_pending?select=id&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&limit=1`,
    );
    if (!existing?.[0]?.id) {
      await supabaseFetch('/rest/v1/bot_match_pending', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: userId,
          fritz_tier: fritzTier,
          room_code: roomCode,
          resolved: false,
        }),
      });
    }
    res.json({ ok: true, roomCode, matchId: verifiedMatch.matchId });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start pending bot match.',
    });
  }
});

app.post('/api/ghost/start', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
  const opponentUserId =
    typeof req.body?.opponentUserId === 'string' && req.body.opponentUserId.trim()
      ? req.body.opponentUserId.trim()
      : null;
  if (!userId || !localMatchId) {
    res.status(400).json({ error: 'userId and localMatchId are required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const verifiedMatch = await startVerifiedSinglePlayerMatch({
      userId,
      localMatchId,
      mode: 'ghost',
      opponentUserId,
    });
    res.json({ ok: true, matchId: verifiedMatch.matchId });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start verified ghost match.',
    });
  }
});

app.post('/api/bot-matches/local/resolve', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
  if (!userId || !localMatchId) {
    res.status(400).json({ error: 'userId and localMatchId are required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const roomCode = `local:${localMatchId}`;
    await supabaseFetch(`/rest/v1/bot_match_pending?room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved: true }),
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to resolve pending bot match.',
    });
  }
});

app.post('/api/bot-matches/local/abandon', async (req, res) => {
  const userId = typeof req.body?.userId === 'string' ? req.body.userId.trim() : '';
  const localMatchId = typeof req.body?.localMatchId === 'string' ? req.body.localMatchId.trim() : '';
  const bodyToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
  if (!userId || !localMatchId) {
    res.status(400).json({ error: 'userId and localMatchId are required.' });
    return;
  }
  try {
    const authenticatedUserId =
      (await getAuthenticatedUserId(req)) || (await getAuthenticatedUserIdFromToken(bodyToken || null));
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    await abandonVerifiedSinglePlayerMatch(userId, localMatchId);
    const roomCode = `local:${localMatchId}`;
    const pendingRows = await supabaseFetch<any[]>(
      `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
    );
    const pending = pendingRows?.[0];
    if (!pending?.id) {
      res.json({ ok: true, processed: false });
      return;
    }
    await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${pending.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved: true }),
    });
    await recordPendingFritzDisconnectLoss(userId, pending.fritz_tier);
    res.json({ ok: true, processed: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to abandon bot match.',
    });
  }
});

app.get('/api/daily-fritz/today', async (req, res) => {
  const requestStartedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  const isDevLike = process.env.NODE_ENV !== 'production';
  const mark = (label: string, startedAt: number, extra?: Record<string, unknown>) => {
    const now = Date.now();
    console.log('[daily-fritz-server] today', {
      requestId,
      label,
      ms: now - startedAt,
      totalMs: now - requestStartedAt,
      ...extra,
    });
  };
  try {
    console.log('[daily-fritz-server] today', {
      requestId,
      label: 'entry',
      totalMs: 0,
      method: req.method,
      path: req.path,
    });

    const authStartedAt = Date.now();
    const authenticatedUserId = await getAuthenticatedUserId(req);
    mark('auth', authStartedAt, { authenticated: Boolean(authenticatedUserId) });
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const dateCalcStartedAt = Date.now();
    const requestedDebugDate = typeof req.query.debugDate === 'string' ? req.query.debugDate.trim() : '';
    if (requestedDebugDate && !isDevLike) {
      res.status(400).json({ error: 'debugDate is only available outside production.' });
      return;
    }
    if (requestedDebugDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDebugDate)) {
      res.status(400).json({ error: 'debugDate must be in YYYY-MM-DD format.' });
      return;
    }
    const runDate = requestedDebugDate || getPacificDateKey();
    mark('dateKey', dateCalcStartedAt, {
      runDate,
      usedDebugDate: Boolean(requestedDebugDate),
    });

    const cacheProbeStartedAt = Date.now();
    const hadCachedRun = dailyFritzRunCache.has(runDate);
    mark('cacheProbe', cacheProbeStartedAt, { runDate, hadCachedRun });

    const runSummaryStartedAt = Date.now();
    let run = await getDailyFritzRunSummary(runDate);
    mark('getDailyFritzRunSummary', runSummaryStartedAt, {
      runDate,
      cacheHit: Boolean(run),
      hadCachedRun,
    });
    if (!run) {
      const ensureStartedAt = Date.now();
      const generated = await ensureDailyFritzRunForDate(
        runDate,
        undefined,
        {
          requestId,
          log: (label, ms, extra) => {
            console.log('[daily-fritz-server] today', {
              requestId,
              label,
              ms,
              totalMs: Date.now() - requestStartedAt,
              ...extra,
            });
          },
        },
      );
      mark('ensureDailyFritzRunForDate', ensureStartedAt, {
        runDate,
        generated: Boolean(generated),
      });
      run = generated
        ? {
            runDate: generated.runDate,
            fritzTier: generated.fritzTier,
            dealSize: generated.dealSize,
            winningScore: generated.winningScore,
            status: generated.status,
          }
        : null;
    }
    if (!run) {
      res.status(500).json({ error: 'Daily Fritz storage is not available.' });
      return;
    }
    if (run.status === 'invalidated') {
      res.status(409).json({ error: 'Today’s Daily Fritz run was invalidated.', runDate, status: run.status });
      return;
    }

    const userStateStartedAt = Date.now();
    const attemptPromiseStartedAt = Date.now();
    const streakPromiseStartedAt = Date.now();
    const [attempt, streak] = await Promise.all([
      getDailyFritzAttempt(runDate, authenticatedUserId).then((value) => {
        mark('getDailyFritzAttempt', attemptPromiseStartedAt, {
          runDate,
          status: value?.status ?? 'none',
        });
        return value;
      }),
      getDailyFritzStreak(authenticatedUserId, runDate).then((value) => {
        mark('getDailyFritzStreak', streakPromiseStartedAt, {
          runDate,
          streak: value,
        });
        return value;
      }),
    ]);
    mark('userStateCombined', userStateStartedAt, { runDate });
    let ownRank: number | null = null;
    if (attempt?.status === 'completed') {
      const leaderboardStartedAt = Date.now();
      const leaderboard = await buildDailyFritzLeaderboard(runDate);
      mark('buildDailyFritzLeaderboard', leaderboardStartedAt, {
        runDate,
        entryCount: leaderboard.length,
      });
      ownRank = leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null;
    }

    const serializeStartedAt = Date.now();
    const payload = {
      ok: true,
      run_date: run.runDate,
      fritz_tier: run.fritzTier,
      deal_size: run.dealSize,
      winning_score: run.winningScore,
      attempt_status: attempt?.status ?? 'none',
      streak,
      result: attempt?.status === 'completed' ? attempt.result : null,
      rank: ownRank,
      leaderboard_preview: [],
    };
    mark('serializeResponse', serializeStartedAt, {
      runDate,
      payloadKeys: Object.keys(payload).length,
    });
    console.log('[daily-fritz-server] today', {
      requestId,
      label: 'response',
      totalMs: Date.now() - requestStartedAt,
      attemptStatus: attempt?.status ?? 'none',
      runDate,
      hadCachedRun,
      cacheMiss: !hadCachedRun,
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load today’s Daily Fritz run.',
    });
  }
});

app.post('/api/daily-fritz/start', async (req, res) => {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const runDate = getPacificDateKey();
    const run = await ensureDailyFritzRunForDate(runDate);
    if (!run) {
      res.status(500).json({ error: 'Daily Fritz storage is not available.' });
      return;
    }
    if (run.status === 'invalidated') {
      res.status(409).json({ error: 'Today’s Daily Fritz run was invalidated.', runDate });
      return;
    }

    let attempt = await getDailyFritzAttempt(runDate, authenticatedUserId);
    if (attempt?.status === 'completed' || attempt?.status === 'abandoned') {
      res.status(409).json({ error: 'Today’s Daily Fritz attempt is already locked.', status: attempt.status });
      return;
    }
    if (!attempt) {
      attempt = await createDailyFritzAttempt(runDate, authenticatedUserId);
    }

    let verifiedMatchId = attempt.verifiedMatchId;
    if (!verifiedMatchId) {
      const localMatchId = `daily-fritz:${runDate}:${attempt.id}`;
      const verifiedMatch = await startVerifiedSinglePlayerMatch({
        userId: authenticatedUserId,
        localMatchId,
        mode: 'fritz',
        opponentUserId: getFritzIdentityForTier(run.fritzTier).fritzId,
        fritzTier: run.fritzTier,
      });
      verifiedMatchId = verifiedMatch.matchId;
      attempt.verifiedMatchId = verifiedMatch.matchId;
      attempt.status = 'started';
      attempt = await upsertDailyFritzAttempt(attempt);
    }

    const handDeal = run.handDeals[attempt.currentHandIndex] ?? run.handDeals[0];
    res.json({
      ok: true,
      attempt_id: attempt.id,
      verified_match_id: verifiedMatchId,
      run_date: run.runDate,
      current_hand_index: attempt.currentHandIndex,
      fritz_tier: run.fritzTier,
      deal_size: run.dealSize,
      winning_score: run.winningScore,
      first_hand: handDeal,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start Daily Fritz.',
    });
  }
});

app.post('/api/daily-fritz/next-hand', async (req, res) => {
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const verifiedMatchId =
    typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
  const runDateFromClient =
    typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const completedHandIndex = Number(req.body?.completed_hand_index);
  if (!attemptId || !verifiedMatchId || !Number.isInteger(completedHandIndex) || completedHandIndex < 0) {
    res.status(400).json({ error: 'attempt_id, verified_match_id, and completed_hand_index are required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyFritzAttemptById(attemptId, authenticatedUserId);
    if (!attempt || attempt.id !== attemptId) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    if (runDateFromClient && runDateFromClient !== attempt.runDate) {
      res.status(400).json({ error: 'Daily Fritz run date does not match this attempt.' });
      return;
    }
    if (attempt.status !== 'started') {
      res.status(409).json({ error: 'Daily Fritz attempt is not active.' });
      return;
    }
    if (attempt.verifiedMatchId !== verifiedMatchId) {
      res.status(403).json({ error: 'Verified match does not match this attempt.' });
      return;
    }
    const run = await getDailyFritzRun(attempt.runDate);
    if (!run) {
      res.status(404).json({ error: 'Daily Fritz run not found.' });
      return;
    }
    if (completedHandIndex > attempt.currentHandIndex) {
      res.status(400).json({ error: 'Requested completed hand is ahead of the persisted attempt.' });
      return;
    }

    const respondWithCurrentHand = (
      currentHandIndex: number,
      options: { replayed?: boolean; ignored?: boolean } = {},
    ) => {
      const hand =
        run.handDeals[currentHandIndex] ??
        generateSingleDailyFritzHand(run.seed, currentHandIndex, run.dealSize as 7 | 14);
      res.json({
        ok: true,
        run_date: run.runDate,
        current_hand_index: currentHandIndex,
        hand,
        replayed: Boolean(options.replayed),
        ignored: Boolean(options.ignored),
      });
    };

    if (attempt.currentHandIndex === completedHandIndex + 1) {
      respondWithCurrentHand(attempt.currentHandIndex, { replayed: true });
      return;
    }
    if (attempt.currentHandIndex > completedHandIndex + 1) {
      respondWithCurrentHand(attempt.currentHandIndex, { replayed: true, ignored: true });
      return;
    }
    // Do NOT cap by hand count — Daily Fritz plays to the winning score (e.g.
    // 60 points), not a fixed number of hands.  The pre-stored handDeals array
    // covers the common case; any hand beyond it is generated on-demand from
    // the same deterministic seed so all players still get identical tiles.
    attempt.currentHandIndex += 1;
    const saved = await upsertDailyFritzAttempt(attempt);
    respondWithCurrentHand(saved.currentHandIndex);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to advance Daily Fritz hand.',
    });
  }
});

app.post('/api/daily-fritz/complete', async (req, res) => {
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const verifiedMatchId =
    typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
  const runDateFromClient =
    typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const completionHash =
    typeof req.body?.completion_hash === 'string' ? req.body.completion_hash.trim() : '';
  const finalScore = Number(req.body?.final_score);
  const opponentScore = Number(req.body?.opponent_score);
  const won = Boolean(req.body?.won);
  const movesUsed = Number(req.body?.moves_used);
  const handsPlayed = Number(req.body?.hands_played);
  const moveLog = req.body?.move_log ?? null;

  if (!attemptId || !verifiedMatchId || !completionHash) {
    res.status(400).json({ error: 'attempt_id, verified_match_id, and completion_hash are required.' });
    return;
  }
  if (
    !Number.isFinite(finalScore) ||
    !Number.isFinite(opponentScore) ||
    !Number.isFinite(movesUsed) ||
    !Number.isFinite(handsPlayed)
  ) {
    res.status(400).json({ error: 'final_score, opponent_score, moves_used, and hands_played are required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyFritzAttemptById(attemptId, authenticatedUserId);
    if (!attempt || attempt.id !== attemptId) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    if (runDateFromClient && runDateFromClient !== attempt.runDate) {
      res.status(400).json({ error: 'Daily Fritz run date does not match this attempt.' });
      return;
    }
    if (attempt.verifiedMatchId !== verifiedMatchId) {
      res.status(403).json({ error: 'Verified match does not match this attempt.' });
      return;
    }
    const runDate = attempt.runDate;
    const run = await getDailyFritzRun(runDate);
    if (!run) {
      res.status(404).json({ error: 'Daily Fritz run not found.' });
      return;
    }
    const expectedHash = buildDailyFritzCompletionHash({
      runDate,
      attemptId,
      verifiedMatchId,
      currentHandIndex: attempt.currentHandIndex,
      finalScore,
      opponentScore,
      won,
      movesUsed,
      handsPlayed,
      moveLog,
    });
    if (completionHash !== expectedHash) {
      res.status(400).json({ error: 'Completion hash mismatch.' });
      return;
    }

    if (attempt.status === 'completed') {
      if (attempt.completionHash === completionHash) {
        const leaderboard = await buildDailyFritzLeaderboard(runDate);
        const rank = leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null;
        res.json({
          ok: true,
          replayed: true,
          rank,
          leaderboard_preview: leaderboard.slice(0, 10).map(({ userId: _userId, ...entry }) => entry),
        });
        return;
      }
      res.status(409).json({ error: 'Daily Fritz attempt already completed.' });
      return;
    }
    if (attempt.status !== 'started') {
      res.status(409).json({ error: 'Daily Fritz attempt is not active.' });
      return;
    }

    const pointDiff = finalScore - opponentScore;
    attempt.status = 'completed';
    attempt.completedAt = new Date().toISOString();
    attempt.completionHash = completionHash;
    attempt.finalScore = Math.round(finalScore);
    attempt.opponentScore = Math.round(opponentScore);
    attempt.pointDiff = Math.round(pointDiff);
    attempt.won = won;
    attempt.movesUsed = Math.round(movesUsed);
    attempt.handsPlayed = Math.round(handsPlayed);
    attempt.result = {
      run_date: runDate,
      final_score: attempt.finalScore,
      opponent_score: attempt.opponentScore,
      point_diff: attempt.pointDiff,
      won,
      moves_used: attempt.movesUsed,
      hands_played: attempt.handsPlayed,
    };
    await upsertDailyFritzAttempt(attempt);

    const verifiedMatch = await getVerifiedSinglePlayerMatch(verifiedMatchId);
    if (verifiedMatch && verifiedMatch.userId === authenticatedUserId) {
      verifiedMatch.status = 'completed';
      verifiedMatch.completedAt = attempt.completedAt;
      verifiedMatch.completionHash = completionHash;
      verifiedMatch.completionResult = attempt.result;
      await persistVerifiedSinglePlayerMatch(verifiedMatch);
    }

    const leaderboard = await buildDailyFritzLeaderboard(runDate);
    const rank = leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null;
    res.json({
      ok: true,
      rank,
      leaderboard_preview: leaderboard.slice(0, 10).map(({ userId: _userId, ...entry }) => entry),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete Daily Fritz attempt.',
    });
  }
});

app.post('/api/daily-fritz/abandon', async (req, res) => {
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  if (!attemptId) {
    res.status(400).json({ error: 'attempt_id is required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDate = getPacificDateKey();
    const attempt = await getDailyFritzAttempt(runDate, authenticatedUserId);
    if (!attempt || attempt.id !== attemptId) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    if (attempt.status === 'completed' || attempt.status === 'abandoned') {
      res.status(409).json({ error: 'Daily Fritz attempt is already locked.', status: attempt.status });
      return;
    }
    attempt.status = 'abandoned';
    attempt.completedAt = new Date().toISOString();
    await upsertDailyFritzAttempt(attempt);
    if (attempt.verifiedMatchId) {
      const verifiedMatch = await getVerifiedSinglePlayerMatch(attempt.verifiedMatchId);
      if (verifiedMatch && verifiedMatch.userId === authenticatedUserId) {
        verifiedMatch.status = 'abandoned';
        verifiedMatch.completedAt = attempt.completedAt;
        await persistVerifiedSinglePlayerMatch(verifiedMatch);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to abandon Daily Fritz attempt.',
    });
  }
});

app.get('/api/daily-fritz/leaderboard/:date', async (req, res) => {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDate = typeof req.params.date === 'string' ? req.params.date.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
      res.status(400).json({ error: 'Valid date is required.' });
      return;
    }
    const leaderboard = await buildDailyFritzLeaderboard(runDate);
    res.json({
      ok: true,
      run_date: runDate,
      leaderboard: leaderboard.map(({ userId, ...entry }) => ({
        ...entry,
        is_current_user: userId === authenticatedUserId,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Daily Fritz leaderboard.',
    });
  }
});

app.post('/api/daily-fritz/generate', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const runDate = typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const fritzTier = normalizeDailyFritzTier(req.body?.fritz_tier);
  const dealSize = Number(req.body?.deal_size) === 14 ? 14 : Number(req.body?.deal_size) === 7 ? 7 : null;
  const winningScore = Number(req.body?.winning_score);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || !fritzTier || !dealSize || !Number.isFinite(winningScore)) {
    res.status(400).json({ error: 'run_date, fritz_tier, deal_size, and winning_score are required.' });
    return;
  }
  try {
    const generated = generateDailyFritzRun(runDate, fritzTier, dealSize, Math.round(winningScore));
    const saved = await upsertDailyFritzRun({
      runDate: generated.runDate,
      seed: generated.seed,
      fritzTier: generated.fritzTier,
      dealSize: generated.dealSize,
      winningScore: generated.winningScore,
      status: generated.status,
      handDeals: generated.handDeals,
      generatedAt: generated.generatedAt,
      invalidatedAt: generated.invalidatedAt,
      metadata: generated.metadata,
    });
    res.json({ ok: true, run_date: saved.runDate, seed: getDailyFritzSeed(saved.runDate) });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate Daily Fritz run.',
    });
  }
});

app.post('/api/daily-fritz/invalidate', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const runDate = typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    res.status(400).json({ error: 'run_date is required.' });
    return;
  }
  try {
    const run = await getDailyFritzRun(runDate);
    if (!run) {
      res.status(404).json({ error: 'Daily Fritz run not found.' });
      return;
    }
    run.status = 'invalidated';
    run.invalidatedAt = new Date().toISOString();
    run.metadata = { ...(run.metadata ?? {}), invalidation_reason: reason || null };
    await upsertDailyFritzRun(run);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to invalidate Daily Fritz run.',
    });
  }
});

app.post('/api/daily-fritz/reset-attempt', async (req, res) => {
  if (req.body?.adminKey !== process.env.ADMIN_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const runDate = typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const userId = typeof req.body?.user_id === 'string' ? req.body.user_id.trim() : '';
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || !userId) {
    res.status(400).json({ error: 'run_date and user_id are required.' });
    return;
  }
  try {
    const attempt = await getDailyFritzAttempt(runDate, userId);
    if (!attempt) {
      res.status(404).json({ error: 'Daily Fritz attempt not found.' });
      return;
    }
    await supabaseFetch(`/rest/v1/daily_fritz_attempts?id=eq.${encodeURIComponent(attempt.id)}`, {
      method: 'DELETE',
    });
    if (attempt.verifiedMatchId) {
      const verifiedMatch = await getVerifiedSinglePlayerMatch(attempt.verifiedMatchId);
      if (verifiedMatch) {
        verifiedMatch.status = 'abandoned';
        verifiedMatch.completedAt = new Date().toISOString();
        verifiedMatch.completionResult = reason ? { reset_reason: reason } : null;
        await persistVerifiedSinglePlayerMatch(verifiedMatch);
      }
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to reset Daily Fritz attempt.',
    });
  }
});

app.get('/api/room-events/:matchId', async (req, res) => {
  const matchId = typeof req.params.matchId === 'string' ? req.params.matchId.trim() : '';
  if (!matchId) {
    res.status(400).json({ error: 'matchId is required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const log = await queryPersistedRoomMatchLog(matchId);
    if (!log) {
      if (persistentRoomMatchLogsAvailable === false) {
        res.status(503).json({ error: 'Room event persistence is not configured.' });
        return;
      }
      res.status(404).json({ error: 'Room event log not found.' });
      return;
    }

    if (!log.participant_user_ids.includes(authenticatedUserId)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.json({
      ok: true,
      log: {
        matchId: log.match_id,
        roomCode: log.room_code,
        status: log.status,
        eventLogVersion: log.event_log_version,
        lastEventSequence: log.last_event_sequence,
        eventCount: log.event_count,
        startedAt: log.started_at,
        archivedAt: log.archived_at,
        participants: log.participants,
        summary: log.summary,
        stateSnapshot: log.state_snapshot,
        events: log.events,
      },
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load room event log.',
    });
  }
});

function getRoomPlayersWithFallback(roomCode: string, socketIds: string[]): RoomPlayer[] {
  const existing = roomPlayersByCode.get(roomCode) ?? [];
  const byId = new Map(existing.map((p) => [p.id, p]));
  const next = socketIds.map((id) => byId.get(id) ?? { id, username: 'Guest', userId: null });
  roomPlayersByCode.set(roomCode, next);
  return next;
}

function pruneReconnectSeats(roomCode: string): ReconnectSeat[] {
  const now = Date.now();
  const seats = (reconnectSeatsByCode.get(roomCode) ?? []).filter((seat) => seat.expiresAt > now);
  if (seats.length > 0) reconnectSeatsByCode.set(roomCode, seats);
  else reconnectSeatsByCode.delete(roomCode);
  return seats;
}

function reserveReconnectSeat(roomCode: string, seat: Omit<ReconnectSeat, 'expiresAt'>) {
  const seats = pruneReconnectSeats(roomCode).filter((s) => s.oldSocketId !== seat.oldSocketId);
  seats.push({ ...seat, expiresAt: Date.now() + RECONNECT_GRACE_MS });
  reconnectSeatsByCode.set(roomCode, seats);
}

function clearRoomMetadata(roomCode: string) {
  roomPlayersByCode.delete(roomCode);
  reconnectSeatsByCode.delete(roomCode);
}

function cancelRoomCleanup(roomCode: string) {
  const timer = roomCleanupTimersByCode.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    roomCleanupTimersByCode.delete(roomCode);
  }
}

function scheduleRoomCleanup(roomCode: string) {
  if (!roomCode || roomCleanupTimersByCode.has(roomCode)) return;
  const timer = setTimeout(async () => {
    roomCleanupTimersByCode.delete(roomCode);
    let room;
    try {
      room = getRoom(roomCode);
    } catch {
      clearRoomMetadata(roomCode);
      return;
    }
    const activePlayers = room.players.filter((pid) => io.sockets.sockets.has(pid));
    if (activePlayers.length > 0) return;
    try {
      await persistRoomMatchLog(room, room.state?.gameOver ? 'completed' : 'abandoned');
    } catch (error) {
      console.error('[room-match-logs] failed to archive room before cleanup:', error);
    }
    deleteRoom(roomCode);
    clearRoomMetadata(roomCode);
  }, ROOM_CLEANUP_GRACE_MS);
  roomCleanupTimersByCode.set(roomCode, timer);
}

function evaluateRoomLifecycle(roomCode: string | undefined) {
  if (!roomCode) return;
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    clearRoomMetadata(roomCode);
    cancelRoomCleanup(roomCode);
    return;
  }
  const activePlayers = room.players.filter((pid) => io.sockets.sockets.has(pid));
  if (activePlayers.length === 0 || room.state?.gameOver) {
    scheduleRoomCleanup(roomCode);
    return;
  }
  cancelRoomCleanup(roomCode);
}

function joinSocketToRoom(socketId: string, roomCode: string, preservePrefixes: string[] = []) {
  const target = io.sockets.sockets.get(socketId);
  if (!target) return;
  const currentRooms = [...target.rooms].filter(
    (joined) =>
      joined !== target.id && !preservePrefixes.some((prefix) => joined.startsWith(prefix)),
  );
  currentRooms.forEach((joined) => {
    target.leave(joined);
    evaluateRoomLifecycle(joined);
  });
  target.join(roomCode);
  target.data.roomId = roomCode;
}

function identityMatchesReconnectSeat(
  seat: ReconnectSeat,
  identity: { username: string; userId: string | null },
): boolean {
  // Prefer userId match — strongest signal
  if (seat.userId && identity.userId) {
    return seat.userId === identity.userId;
  }
  // If one has userId and the other doesn't, no match
  if (seat.userId || identity.userId) {
    return false;
  }
  // Both are guests — username match is acceptable only
  // if the username is not a generic default
  const genericNames = new Set(['guest', 'player', '']);
  const normalized = identity.username.toLowerCase().trim();
  if (genericNames.has(normalized)) {
    return false; // Too ambiguous to trust username alone
  }
  return seat.username === identity.username;
}

function migrateRoomSeat(roomCode: string, oldSocketId: string, newSocketId: string) {
  const room = getRoom(roomCode);
  const idx = room.players.indexOf(oldSocketId);
  if (idx < 0) return;
  room.players[idx] = newSocketId;

  if (room.state) {
    const nextPlayerIds = room.state.playerIds.map((pid) =>
      pid === oldSocketId ? newSocketId : pid,
    );
    const nextPlayers: Record<string, any> = { ...room.state.players };
    if (nextPlayers[oldSocketId]) {
      nextPlayers[newSocketId] = {
        ...nextPlayers[oldSocketId],
        id: newSocketId,
      };
      delete nextPlayers[oldSocketId];
    }
    room.state = {
      ...room.state,
      playerIds: nextPlayerIds,
      players: nextPlayers,
    } as any;
    if (room.lastBroadcastScores[oldSocketId] !== undefined) {
      room.lastBroadcastScores[newSocketId] = room.lastBroadcastScores[oldSocketId];
      delete room.lastBroadcastScores[oldSocketId];
    }
  }
  if (room.ghostMoveLogs[oldSocketId]) {
    room.ghostMoveLogs[newSocketId] = room.ghostMoveLogs[oldSocketId];
    delete room.ghostMoveLogs[oldSocketId];
  }

  if (room.nextHandReady.has(oldSocketId)) {
    room.nextHandReady.delete(oldSocketId);
    room.nextHandReady.add(newSocketId);
  }
  if (room.rematchReady.has(oldSocketId)) {
    room.rematchReady.delete(oldSocketId);
    room.rematchReady.add(newSocketId);
    // Broadcast updated status so the opponent's "Waiting for…" UI reflects
    // the migrated socket id without requiring another game:rematch event.
    emitRematchStatus(roomCode);
  }

  const roster = roomPlayersByCode.get(roomCode) ?? [];
  const rosterIdx = roster.findIndex((p) => p.id === oldSocketId);
  if (rosterIdx >= 0) {
    roster[rosterIdx] = { ...roster[rosterIdx], id: newSocketId };
    roomPlayersByCode.set(roomCode, roster);
  }
}

function emitRematchStatus(roomCode: string) {
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    return;
  }
  const readyPlayerIds = room.players.filter((pid) => room.rematchReady.has(pid));
  io.to(room.code).emit('game:rematch:status', {
    roomCode: room.code,
    readyPlayerIds,
    readyCount: readyPlayerIds.length,
    needed: room.players.length,
  });
}

function emitManualDrawAnimationPayload(
  roomCode: string,
  payload: {
    playerId: string;
    sequence: number;
    steps: ManualDrawAnimationStep[];
    stoppedReason: 'playable' | 'locked_pass';
    finalState: GameState;
  },
) {
  const hasPlayableFollowUp = getRoomLegalMoves(roomCode, payload.playerId).some((move) => move.type === 'play');
  io.to(payload.playerId).emit('game:draw_animation', {
    playerId: payload.playerId,
    sequence: payload.sequence,
    mode: 'manual_draw',
    steps: payload.steps.map((step) => ({
      tile: step.tile,
      boneyardCount: step.boneyardCount,
      drawerHandCount: step.drawerHandCount,
    })),
    final: {
      drewCount: payload.steps.length,
      stoppedReason: payload.stoppedReason,
      canPlayNow: hasPlayableFollowUp,
      handOver: payload.finalState.handOver,
      gameOver: payload.finalState.gameOver,
    },
  });

  io.to(roomCode).except(payload.playerId).emit('game:draw_animation', {
    playerId: payload.playerId,
    sequence: payload.sequence,
    mode: 'manual_draw',
    steps: payload.steps.map((step) => ({
      tile: null,
      boneyardCount: step.boneyardCount,
      drawerHandCount: step.drawerHandCount,
    })),
    final: {
      drewCount: payload.steps.length,
      stoppedReason: payload.stoppedReason,
      canPlayNow: false,
      handOver: payload.finalState.handOver,
      gameOver: payload.finalState.gameOver,
    },
  });
}

function emitForcedDrawAnimationPayload(
  roomCode: string,
  payload: {
    playerId: string;
    sequence: number;
    steps: ManualDrawAnimationStep[];
    stoppedReason: 'playable' | 'locked_pass' | 'locked_no_pass';
    finalState: GameState;
  },
) {
  const hasPlayableFollowUp = getRoomLegalMoves(roomCode, payload.playerId).some((move) => move.type === 'play');
  io.to(payload.playerId).emit('game:draw_animation', {
    playerId: payload.playerId,
    sequence: payload.sequence,
    mode: 'forced_draw',
    steps: payload.steps.map((step) => ({
      tile: step.tile,
      boneyardCount: step.boneyardCount,
      drawerHandCount: step.drawerHandCount,
    })),
    final: {
      drewCount: payload.steps.length,
      stoppedReason: payload.stoppedReason,
      canPlayNow: hasPlayableFollowUp,
      handOver: payload.finalState.handOver,
      gameOver: payload.finalState.gameOver,
    },
  });

  io.to(roomCode).except(payload.playerId).emit('game:draw_animation', {
    playerId: payload.playerId,
    sequence: payload.sequence,
    mode: 'forced_draw',
    steps: payload.steps.map((step) => ({
      tile: null,
      boneyardCount: step.boneyardCount,
      drawerHandCount: step.drawerHandCount,
    })),
    final: {
      drewCount: payload.steps.length,
      stoppedReason: payload.stoppedReason,
      canPlayNow: false,
      handOver: payload.finalState.handOver,
      gameOver: payload.finalState.gameOver,
    },
  });
}

function clearSocketRematchReady(roomCode: string | undefined, socketId: string) {
  if (!roomCode) return;
  try {
    const room = getRoom(roomCode);
    const changed = room.rematchReady.delete(socketId);
    if (changed) emitRematchStatus(room.code);
  } catch {
    // room no longer exists
  }
}

/**
 * Build a personalized hand:ended payload for a specific player.
 */
function buildHandEndedPayload(room: Room, playerId: string) {
  if (!room.state) return null;
  const opponentId = room.state.playerIds.find((id) => id !== playerId) ?? null;
  const opponentHand = opponentId ? (room.state.players[opponentId]?.hand ?? []) : [];
  const myHand = room.state.players[playerId]?.hand ?? [];

  // Compute awards directly from remaining tiles — do NOT use score deltas
  // (scores are already applied to room.state before this runs)
  const opponentPipSum = opponentHand.reduce((s, t) => s + t.high + t.low, 0);
  const myPipSum = myHand.reduce((s, t) => s + t.high + t.low, 0);

  // Winner is whoever went out (hand.length === 0), or lowest pips in blocked hand
  const iWentOut = myHand.length === 0;
  const opponentWentOut = opponentHand.length === 0;

  const youScoreDelta = iWentOut
    ? Math.round(opponentPipSum / 5)
    : opponentWentOut
    ? 0
    : myPipSum <= opponentPipSum
    ? Math.round(opponentPipSum / 5) // blocked hand, I had lower pips
    : 0;

  const opponentScoreDelta = opponentWentOut
    ? Math.round(myPipSum / 5)
    : iWentOut
    ? 0
    : opponentPipSum <= myPipSum
    ? Math.round(myPipSum / 5) // blocked hand, opponent had lower pips
    : 0;

  let handWinnerId: string | null = null;
  if (iWentOut) handWinnerId = playerId;
  else if (opponentWentOut) handWinnerId = opponentId;
  else if (myPipSum <= opponentPipSum) handWinnerId = playerId;
  else handWinnerId = opponentId;

  return {
    handNumber: room.state.handNumber,
    opponentRemainingTiles: opponentHand,
    yourRemainingTiles: myHand,
    pointsAwarded: {
      you: youScoreDelta,
      opponent: opponentScoreDelta,
    },
    whoWentOut: iWentOut ? playerId : opponentWentOut ? opponentId : null,
    winnerId: handWinnerId,
    handWinnerId: handWinnerId,
  };
}

/**
 * Send state update to all players in a room.
 * Each player receives:
 * - The game state
 * - Their legal moves (if it's their turn)
 * - Whether they can draw
 */
function broadcastStateUpdate(roomCode: string) {
  const room = getRoom(roomCode);
  if (!room.state) return;
  assertValidGameState(room.state, `broadcastStateUpdate:${roomCode}`);

  // WEEKLY_STATS_LOGGING (non-tournament only)
  const cfg = (room as any).config ?? {};
  const isTournamentRoom = Boolean(cfg.tournamentId);
  // WEEKLY_STATS_LEAD_TRACKER (score-based comeback)
  const pidsForLead = room.state.playerIds;
  if (Array.isArray(pidsForLead) && pidsForLead.length === 2) {
    const aId = pidsForLead[0];
    const bId = pidsForLead[1];
    const scoreA = room.state.players[aId]?.score ?? 0;
    const scoreB = room.state.players[bId]?.score ?? 0;
    const diff = scoreA - scoreB; // + means A is leading
    const t = ((room as any)._leadTracker ??= { aId, bId, maxLeadA: 0, maxLeadB: 0 });
    if (t.aId !== aId || t.bId !== bId) {
      (room as any)._leadTracker = { aId, bId, maxLeadA: 0, maxLeadB: 0 };
    } else {
      if (diff > 0) t.maxLeadA = Math.max(t.maxLeadA, diff);
      if (diff < 0) t.maxLeadB = Math.max(t.maxLeadB, -diff);
    }
  }

  if (room.state.gameOver && !isTournamentRoom && !(room as any)._matchLogged) {
    const pids = room.state.playerIds;
    if (Array.isArray(pids) && pids.length === 2) {
      const roster = roomPlayersByCode.get(room.code) ?? [];
      const byId = new Map(roster.map((p) => [p.id, p]));
      const aId = pids[0];
      const bId = pids[1];
      const a = byId.get(aId) ?? { id: aId, username: "Guest", userId: null };
      const b = byId.get(bId) ?? { id: bId, username: "Guest", userId: null };
      const scoreA = room.state.players[aId]?.score ?? 0;
      const scoreB = room.state.players[bId]?.score ?? 0;
      const winnerSocketId = room.state.winnerId ?? (scoreA >= scoreB ? aId : bId);

      void (async () => {
        try {
          if (getPendingFritzMatchContext(room)) {
            await resolvePendingFritzMatch(room.code);
          }

          await appendMatch({
            endedAtMs: Date.now(),
            roomCode: room.code,
            tournamentId: typeof cfg.tournamentId === 'string' ? cfg.tournamentId : undefined,
            tournamentMatchId: typeof cfg.tournamentMatchId === 'string' ? cfg.tournamentMatchId : undefined,
            maxDeficitWinner: (() => {
              const t = (room as any)._leadTracker;
              if (!t) return 0;
              if (winnerSocketId === aId) return t.maxLeadB ?? 0;
              if (winnerSocketId === bId) return t.maxLeadA ?? 0;
              return 0;
            })(),
            a: { socketId: a.id, userId: a.userId, username: a.username },
            b: { socketId: b.id, userId: b.userId, username: b.username },
            scoreA,
            scoreB,
            winnerSocketId,
            pointDiff: Math.abs(scoreA - scoreB),
          });

          // RANKED GAMES LOGGING
          const rankingParticipants = [
            { me: a, opp: b, myScore: scoreA, oppScore: scoreB },
            { me: b, opp: a, myScore: scoreB, oppScore: scoreA }
          ];
          const rankingProfiles = new Map<string, any>();
          const insertedRankedGames = new Map<string, any>();

          for (const p of rankingParticipants) {
            if (p.me.userId) {
              const opponentId = p.opp.userId || (p.opp.id.startsWith('bot:fritz:') ? FRITZ_SYSTEM_ID : null);
              if (opponentId) {
                let profile = rankingProfiles.get(p.me.userId);
                if (!profile) {
                  const profileData = await supabaseFetch<any[]>(`/rest/v1/profiles?id=eq.${p.me.userId}`);
                  profile = profileData?.[0];
                  if (profile) {
                    rankingProfiles.set(p.me.userId, profile);
                  }
                }
                if (profile) {
                  const insertedGames = await supabaseFetch<any[]>('/rest/v1/ranked_games', {
                    method: 'POST',
                    headers: {
                      Prefer: 'return=representation',
                    },
                    body: JSON.stringify({
                      player_id: p.me.userId,
                      opponent_id: opponentId,
                      player_score: p.myScore,
                      opponent_score: p.oppScore,
                      game_type: opponentId === FRITZ_SYSTEM_ID ? 'fritz' : 'multiplayer',
                      rating_before: profile.glicko_rating,
                      rd_before: profile.glicko_rd,
                      played_at: new Date().toISOString()
                    })
                  });
                  const insertedGame = insertedGames?.[0];
                  if (insertedGame) {
                    insertedRankedGames.set(p.me.userId, insertedGame);
                  }
                }

                const moveLog = room.ghostMoveLogs[p.me.id] ?? [];
                if (moveLog.length > 0) {
                  await completeGhostGame({
                    userId: p.me.userId,
                    opponentUserId: opponentId,
                    finalScore: p.myScore,
                    opponentScore: p.oppScore,
                    moveLog,
                  });
                }
              }
            }
          }

          if (a.userId && b.userId) {
            const playerAProfile = rankingProfiles.get(a.userId);
            const playerBProfile = rankingProfiles.get(b.userId);
            const playerAGame = insertedRankedGames.get(a.userId);
            const playerBGame = insertedRankedGames.get(b.userId);

            if (playerAProfile && playerBProfile && playerAGame && playerBGame) {
              try {
                await processRealtimeMultiplayerGame({
                  playerAProfile,
                  playerBProfile,
                  playerAGame,
                  playerBGame,
                });
                console.log('[Ranking] Real-time update complete', {
                  playerA: a.userId,
                  playerB: b.userId,
                });
              } catch (err) {
                console.error('[Ranking] Real-time update failed:', err);
              }
            } else {
              console.warn('[Ranking] Skipping real-time update — missing data', {
                hasPlayerAProfile: !!playerAProfile,
                hasPlayerBProfile: !!playerBProfile,
                hasPlayerAGame: !!playerAGame,
                hasPlayerBGame: !!playerBGame,
              });
            }
          }

          const linkedFixtureRows = await supabaseFetch<any[]>(
            `/rest/v1/fixtures?select=id,status,home_member_id,away_member_id,live_room_code&live_room_code=eq.${room.code}&limit=1`,
          );
          const linkedFixture = linkedFixtureRows?.[0];
          if (linkedFixture && linkedFixture.status !== 'completed' && linkedFixture.status !== 'forfeit') {
            const fixtureMembers = await supabaseFetch<any[]>(
              `/rest/v1/league_members?select=id,player_user_id&id=in.("${linkedFixture.home_member_id}","${linkedFixture.away_member_id}")`,
            );
            const homeMember = fixtureMembers.find((member) => member?.id === linkedFixture.home_member_id) ?? null;
            const awayMember = fixtureMembers.find((member) => member?.id === linkedFixture.away_member_id) ?? null;
            const livePlayers = [a, b];
            const homePlayer = livePlayers.find((player) => player.userId === homeMember?.player_user_id) ?? null;
            const awayPlayer = livePlayers.find((player) => player.userId === awayMember?.player_user_id) ?? null;

            if (homeMember && awayMember && homePlayer && awayPlayer) {
              const homeScore = homePlayer.id === a.id ? scoreA : scoreB;
              const awayScore = awayPlayer.id === a.id ? scoreA : scoreB;
              try {
                await recordLeagueLiveResult({
                  fixtureId: linkedFixture.id,
                  playerMemberId: homeMember.id,
                  opponentMemberId: awayMember.id,
                  homeScore,
                  awayScore,
                  sourceUserId: a.userId ?? b.userId ?? null,
                  roomCode: room.code,
                  metadata: { via: 'live-room-auto-finalize' },
                });
                console.log('[League] Live fixture finalized', {
                  fixtureId: linkedFixture.id,
                  roomCode: room.code,
                });
              } catch (err) {
                console.error('[League] Live fixture finalization failed:', err);
              }
            } else {
              console.warn('[League] Skipping live fixture finalization — player mapping missing', {
                fixtureId: linkedFixture.id,
                roomCode: room.code,
                hasHomeMember: !!homeMember,
                hasAwayMember: !!awayMember,
                hasHomePlayer: !!homePlayer,
                hasAwayPlayer: !!awayPlayer,
              });
            }
          }
        } catch (err) {
          console.warn('Ranking/Match logging failed', err);
        }
      })();
      (room as any)._matchLogged = true;
    }
  }

  // Self-heal Socket.IO room membership for active (human) match players.
  for (const pid of room.state.playerIds) {
    if (pid.startsWith('bot:fritz:')) continue;
    const playerSocket = io.sockets.sockets.get(pid);
    if (!playerSocket) continue;
    if (!playerSocket.rooms.has(roomCode)) {
      playerSocket.join(roomCode);
      playerSocket.data.roomId = roomCode;
      playerSocket.data.playerId = pid;
    }
  }

  const sockets = io.sockets.adapter.rooms.get(roomCode);
  if (!sockets) return;

  const currentScores = Object.fromEntries(
    room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.score ?? 0]),
  );
  const previousScores = room.lastBroadcastScores;

  for (const socketId of sockets) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      const isPlayer = room.state.playerIds.includes(socketId);
      const recipientPlayerId =
        room.state.playerIds.includes(socketId)
          ? socketId
          : typeof socket.data?.playerId === 'string' && room.state.playerIds.includes(socket.data.playerId)
            ? socket.data.playerId
            : null;

      const legalMoves = isPlayer ? getRoomLegalMoves(roomCode, socketId) : [];
      const canDraw = isPlayer ? getRoomCanDraw(roomCode, socketId) : false;

      const handCounts = Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const ps = room.state!.players[pid];
          return [pid, ps?.hand?.length ?? 0];
        }),
      );

      const maskedPlayers = Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const playerState = room.state!.players[pid];
          if (!playerState) {
            return [pid, { id: pid, hand: [], score: 0 }];
          }
          const canReveal =
            room.state!.handOver ||
            room.state!.gameOver ||
            pid === recipientPlayerId;
          return [
            pid,
            {
              ...playerState,
              hand: canReveal ? playerState.hand : [],
            },
          ];
        }),
      );

      socket.emit('state:update', {
        state: {
          ...room.state,
          players: maskedPlayers,
          handCounts,
        },
        legalMoves,
        canDraw,
        eventMeta: getRoomMatchEventMeta(room.code),
      });

      if (
        room.state.handOver &&
        !room.state.gameOver &&
        room.lastHandEndedNotifiedHand !== room.state.handNumber
      ) {
        room.lastHandEndedNotifiedHand = room.state.handNumber;
        for (const pid of room.state.playerIds) {
          if (pid.startsWith('bot:fritz:')) continue;
          const playerSocket = io.sockets.sockets.get(pid);
          if (!playerSocket) continue;

          const payload = buildHandEndedPayload(room, pid);
          if (payload) {
            playerSocket.emit('hand:ended', payload);
          }
        }
      }
    }
  }

  room.lastBroadcastScores = currentScores;

  // TOURNAMENT_SPECTATE_BROADCAST
  // Spectator-safe broadcast only to non-player sockets. Active players already
  // received personalized state:update above; sending this to them would hide
  // their own hand with the same sequence number.
  if (room.state) {
    const stateForSpectators = {
      ...room.state,
      players: Object.fromEntries(
        room.state.playerIds.map((pid) => {
          const ps = room.state!.players[pid];
          return [pid, { ...ps, hand: [] }];
        }),
      ),
      handCounts: Object.fromEntries(
        room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
      ),
    };
    const spectatorPayload = {
      state: stateForSpectators,
      eventMeta: getRoomMatchEventMeta(room.code),
    };
    const currentRoomSockets = io.sockets.adapter.rooms.get(room.code);
    if (currentRoomSockets) {
      for (const socketId of currentRoomSockets) {
        const recipient = io.sockets.sockets.get(socketId);
        if (!recipient) continue;
        const playerId =
          room.state.playerIds.includes(socketId)
            ? socketId
            : typeof recipient.data?.playerId === 'string' && room.state.playerIds.includes(recipient.data.playerId)
              ? recipient.data.playerId
              : null;
        if (playerId) continue;
        recipient.emit('state:spectate', spectatorPayload);
      }
    }
  }

  const roomAfter = (() => { try { return getRoom(roomCode); } catch { return null; } })();

  // Auto-ready bots for next hand
  if (roomAfter?.state?.handOver && !roomAfter.state.gameOver) {
    for (const pid of roomAfter.players) {
      if (pid.startsWith('bot:fritz:') && !roomAfter.nextHandReady.has(pid)) {
        setTimeout(async () => {
          try {
            const result = await readyForNextHand(roomCode, pid, io);
            if (result.started) {
              broadcastStateUpdate(roomCode);
              const freshRoom = (() => { try { return getRoom(roomCode); } catch { return null; } })();
              if (freshRoom?.state && !freshRoom.state.handOver && !freshRoom.state.gameOver) {
                // no-op
              }
            }
          } catch (e) {
            console.warn('[bot] auto-ready error', e);
          }
        }, 800);
      }
    }
  }

  if (room.state.gameOver) {
    if (isTournamentRoom) {
      finalizeTournamentMatchHook?.(room);
    }
    evaluateRoomLifecycle(room.code);
  }
}

io.on('connection', (socket: Socket) => {
  /* ROOM_REACTIONS_CHAT_EMOTE */
  const leaveTrackedRoom = (
    roomCode: string | undefined,
    options: { preserveSeat?: boolean } = {},
  ) => {
    if (!roomCode) return;
    const code = roomCode.trim().toUpperCase();
    if (!code) return;

    const preserveSeat = Boolean(options.preserveSeat);
    socket.leave(code);
    if (socket.data.roomId === code) {
      socket.data.roomId = undefined;
    }

    let room: Room | null = null;
    try {
      room = getRoom(code);
    } catch {
      clearRoomMetadata(code);
      cancelRoomCleanup(code);
      return;
    }

    const wasPlayer = room.players.includes(socket.id);
    clearSocketRematchReady(code, socket.id);

    if (!preserveSeat && wasPlayer) {
      appendRoomEvent(room, {
        type: 'player_left',
        actorSocketId: socket.id,
        actorUserId: normalizeUserId(socket.data?.userId),
        payload: {
          preserveSeat,
        },
      });
      room.players = room.players.filter((pid) => pid !== socket.id);
      const nextRoster = (roomPlayersByCode.get(code) ?? []).filter((player) => player.id !== socket.id);
      if (nextRoster.length > 0) {
        roomPlayersByCode.set(code, nextRoster);
      } else {
        roomPlayersByCode.delete(code);
      }

      const nextSeats = (reconnectSeatsByCode.get(code) ?? []).filter((seat) => seat.oldSocketId !== socket.id);
      if (nextSeats.length > 0) {
        reconnectSeatsByCode.set(code, nextSeats);
      } else {
        reconnectSeatsByCode.delete(code);
      }

      io.to(code).emit('room:update', { players: nextRoster });
    }

    evaluateRoomLifecycle(code);
  };

  const leaveExistingSocketRooms = () => {
    const previousRooms = [...socket.rooms].filter((roomId) => roomId !== socket.id);
    previousRooms.forEach((roomId) => leaveTrackedRoom(roomId));
    socket.data.roomId = undefined;
  };

  const removeSocketPresence = () => {
    const userId = normalizeUserId(socket.data?.userId);
    if (!userId) return;
    const set = socketsByUserId.get(userId);
    if (!set) return;
    set.delete(socket.id);
    if (set.size === 0) socketsByUserId.delete(userId);
  };

  socket.on(
    'presence:identify',
    async (payload: RoomJoinConfig, cb?: AckFn) => {
    try {
      const { username, userId } = await resolveSocketIdentity(payload ?? {});
      if (!userId) return cb?.({ ok: false });
      console.log('[presence] identify received', userId);
      removeSocketPresence();
      socket.data.userId = userId;
      socket.data.username = username;
      const existing = socketsByUserId.get(userId) ?? new Set<string>();
      existing.add(socket.id);
      socketsByUserId.set(userId, existing);
      cb?.({ ok: true });
    } catch {
      cb?.({ ok: false });
    }
  });

  socket.on('presence:online', (argUserIds: unknown, cb?: AckFn) => {
    const userIds = Array.isArray(argUserIds)
      ? argUserIds
          .map((id) => normalizeUserId(id))
          .filter((id): id is string => Boolean(id))
      : [];
    const onlineUserIds = userIds.filter((id) => (socketsByUserId.get(id)?.size ?? 0) > 0);
    console.log(
      '[presence] online check',
      JSON.stringify({
        requested: userIds.length,
        online: onlineUserIds.length,
        registeredUsers: socketsByUserId.size,
      }),
    );
    cb?.({ ok: true, onlineUserIds });
  });

  socket.on(
    'friend:invite',
    (payload: { toUserId: string; fromUsername: string; roomCode: string; inviteUrl: string }) => {
      const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
      try {
        getRoom(roomCode);
      } catch {
        console.log(`[friend:invite] ERROR room_not_found code=${roomCode} from=${socket.id}`);
        socket.emit('friend:invite:error', { ok: false, error: 'room_not_found' });
        return;
      }
      const toUserId = normalizeUserId(payload?.toUserId);
      if (!toUserId) return;
      const targetSockets = socketsByUserId.get(toUserId);
      if (!targetSockets) return;
      for (const socketId of targetSockets) {
        io.to(socketId).emit('friend:invited', {
          fromUsername: normalizeUsername(payload?.fromUsername),
          roomCode,
          inviteUrl: String(payload?.inviteUrl ?? ''),
        });
      }
    },
  );

  const nowMs = () => Date.now();
  const clampString = (s: string, max: number) => {
    const t = (s ?? '').trim();
    return t.length > max ? t.slice(0, max) : t;
  };

  const makeRateLimiter = (burst: number, perMs: number) => {
    let tokens = burst;
    let last = nowMs();
    return () => {
      const t = nowMs();
      const refill = ((t - last) / perMs) * burst;
      tokens = Math.min(burst, tokens + refill);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  };

  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:chat:send', (payload: { text: string }) => {
    try {
      if (!canSendChat()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const text = clampString(String(payload?.text ?? ''), 200);
      if (!text) return;

      const msg = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        text,
      };

      socket.to(roomId).emit('room:chat', msg);
    } catch (e) {
      console.warn('room:chat:send failed', e);
    }
  });

  socket.on('room:emote:send', (payload: { emote: string }) => {
    try {
      if (!canSendEmote()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const emote = clampString(String(payload?.emote ?? ''), 16);
      if (!emote) return;

      const evt = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        emote,
      };

      socket.to(roomId).emit('room:emote', evt);
    } catch (e) {
      console.warn('room:emote:send failed', e);
    }
  });

  // WEEKLY_STATS
  socket.on("stats:weekly", async (cb?: any) => {
    try {
      const awards = await computeWeeklyAwards(Date.now());
      cb?.({ ok: true, awards });
    } catch {
      cb?.({ ok: false, error: "stats_failed" });
    }
  });


  console.log('Client connected:', socket.id);

  // TOURNAMENT_HELPERS
  // Global in-memory tournament storage (per server process).
  const tournamentsById = ((globalThis as any).__tournamentsById ??= new Map<string, Tournament>()) as Map<
    string,
    Tournament
  >;
  const tournamentsByCode = ((globalThis as any).__tournamentsByCode ??= new Map<string, string>()) as Map<
    string,
    string
  >;

  const emitTournament = (t: Tournament) => {
    const standings = sortedStandings(t.standings);
    io.to(`tourn:${t.id}`).emit('tournament:state', {
      id: t.id,
      hostSocketId: t.hostSocketId,
      lobbyCode: t.lobbyCode,
      status: t.status,
      players: t.players,
      matches: t.matches,
      currentMatchIndex: t.currentMatchIndex,
      activeMatchId: t.activeMatchId ?? null,
      activeRoomCode: t.activeRoomCode ?? null,
      standings,
    });
  };

  const getTournamentForSocket = (): Tournament | null => {
    const tid = (socket.data?.tournamentId as string | undefined) ?? undefined;
    if (!tid) return null;
    return tournamentsById.get(tid) ?? null;
  };

  const startNextMatch = (t: Tournament) => {
    // advance to next pending match
    while (t.currentMatchIndex < t.matches.length && t.matches[t.currentMatchIndex].status === 'done') {
      t.currentMatchIndex += 1;
    }
    if (t.currentMatchIndex >= t.matches.length) {
      t.status = 'complete';
      t.activeMatchId = null;
      t.activeRoomCode = null;
      emitTournament(t);
      return;
    }

    const m = t.matches[t.currentMatchIndex];
    m.status = 'active';
    t.activeMatchId = m.id;

    // Create a normal 2-player room for this match with a 30-point winning score.
    // Attach tournament metadata so we can record results later on gameOver.
    const room = createRoom(m.a, {
      winningScore: 30,
      tournamentId: t.id,
      tournamentMatchId: m.id,
      tournamentMode: 'round_robin',
    } as any);

    // Defensive: ensure config is accessible later even if createRoom doesn't persist arbitrary config
    (room as any).config = { ...(room as any).config, winningScore: 30, tournamentId: t.id, tournamentMatchId: m.id };

    m.roomCode = room.code;
    t.activeRoomCode = room.code;

    // Join the second player in the engine + socket room
    joinRoom(room.code, m.b);
    joinSocketToRoom(m.a, room.code, ['tourn:']);
    joinSocketToRoom(m.b, room.code, ['tourn:']);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    roomPlayersByCode.set(room.code, roomPlayers);
    io.to(room.code).emit('room:update', { players: roomPlayers });

    // Announce active match (players + spectators)
    io.to(`tourn:${t.id}`).emit('tournament:match:assigned', {
      matchId: m.id,
      roomCode: room.code,
      a: m.a,
      b: m.b,
      aName: roomPlayers[0].username,
      bName: roomPlayers[1].username,
    });

    // Start match now
    void startGame(room.code, io)
      .then(() => {
        broadcastStateUpdate(room.code);
        emitTournament(t);
      })
      .catch((err) => {
        console.warn('[tournament] failed to start match room', err);
      });

  };

  const maybeFinalizeTournamentMatch = (room: any) => {
    if (!room?.state?.gameOver) return;

    const cfg = (room as any).config ?? {};
    const tid = cfg.tournamentId as string | undefined;
    const mid = cfg.tournamentMatchId as string | undefined;
    if (!tid || !mid) return;

    const t = tournamentsById.get(tid);
    if (!t) return;

    const match = t.matches.find((mm) => mm.id === mid);
    if (!match || match.status === 'done') return;

    const a = match.a;
    const b = match.b;
    const scoreA = room.state.players[a]?.score ?? 0;
    const scoreB = room.state.players[b]?.score ?? 0;
    const winner = scoreA >= scoreB ? a : b;

    applyResult(t, mid, winner, scoreA, scoreB);

    // advance (one match at a time)
    t.currentMatchIndex += 1;
    t.activeMatchId = null;
    t.activeRoomCode = null;

    emitTournament(t);
    startNextMatch(t);
  };
  finalizeTournamentMatchHook = maybeFinalizeTournamentMatch;

// TOURNAMENT_HANDLERS
  socket.on('tournament:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as any;
    try {
            const username = normalizeUsername(config.username ?? socket.data?.username);
      const userId = normalizeUserId(config.userId ?? socket.data?.userId);
      socket.data.username = username;
      socket.data.userId = userId;

      const id = makeId('t');
      const lobbyCode = makeCode(4);

      const players: TournamentPlayer[] = [{
        socketId: socket.id,
        username,
        userId,
      }];

      const t: Tournament = {
        id,
        lobbyCode,
        hostSocketId: socket.id,
        status: 'lobby',
        players,
        matches: [],
        currentMatchIndex: 0,
        standings: initStandings(players),
        activeMatchId: null,
        activeRoomCode: null,
      };

      (globalThis as any).__tournamentsById.set(id, t);
      (globalThis as any).__tournamentsByCode.set(lobbyCode, id);

      socket.data.tournamentId = id;
      socket.join(`tourn:${id}`);

      cb?.({ ok: true, id, lobbyCode });
      // broadcast lobby state
      io.to(`tourn:${id}`).emit('tournament:lobby:update', { players: t.players, lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'create_failed';
      console.warn('[tournament:create] failed', e);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('tournament:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const lobbyCode = String(argCode ?? '');
    const config = (
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? arg2 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as any;
    try {
      const code = String(lobbyCode ?? '').trim().toUpperCase();
      const tid = (globalThis as any).__tournamentsByCode.get(code) as string | undefined;
      if (!tid) return cb?.({ ok: false, error: 'not_found' });

      const t = (globalThis as any).__tournamentsById.get(tid) as Tournament | undefined;
      if (!t) return cb?.({ ok: false, error: 'not_found' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });

      if (!t.players.some((p) => p.socketId === socket.id)) {
                const username = normalizeUsername(config.username ?? socket.data?.username);
        const userId = normalizeUserId(config.userId ?? socket.data?.userId);
        socket.data.username = username;
        socket.data.userId = userId;
        t.players.push({ socketId: socket.id, username, userId });
        t.standings[socket.id] = {
          socketId: socket.id,
          username,
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
      }

      socket.data.tournamentId = tid;
      socket.join(`tourn:${tid}`);

      cb?.({ ok: true, id: tid, lobbyCode: t.lobbyCode });
      io.to(`tourn:${tid}`).emit('tournament:lobby:update', { players: t.players, lobbyCode: t.lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      cb?.({ ok: false, error: 'join_failed' });
    }
  });

  socket.on('tournament:add_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:remove_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:start', (cb?: any) => {
    try {
      const t = getTournamentForSocket();
      if (!t) return cb?.({ ok: false, error: 'no_tournament' });
      if (socket.id != t.hostSocketId) return cb?.({ ok: false, error: 'not_host' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });
      // Tournament bots are disabled; prune any stale bot entries before start.
      const humanPlayers = t.players.filter(
        (p) => !p.isBot && !p.socketId.startsWith('bot:fritz:') && !p.username.startsWith('Fritz'),
      );
      t.players = humanPlayers;
      t.standings = Object.fromEntries(
        Object.entries(t.standings).filter(([socketId]) =>
          humanPlayers.some((player) => player.socketId === socketId),
        ),
      ) as typeof t.standings;

      if (t.players.length < 2) return cb?.({ ok: false, error: 'need_2' });

      t.status = 'running';
      t.matches = buildRoundRobinMatches(t.players);
      t.currentMatchIndex = 0;
      t.activeMatchId = null;
      t.activeRoomCode = null;

      emitTournament(t);
      startNextMatch(t);

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: 'start_failed' });
    }
  });


  socket.on('room:create', async (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as RoomJoinConfig;
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
    const {
      username: _ignoredUsername,
      userId: _ignoredUserId,
      authToken: _ignoredAuthToken,
      ...roomConfig
    } = config as Record<string, unknown>;
    console.log(`[room:create] socket=${socket.id}`);
    try {
      const { username, userId } = await resolveSocketIdentity(config);
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
      const room = createRoom(socket.id, roomConfig as Record<string, unknown>);
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      socket.data.playerId = socket.id;
      const roomPlayers: RoomPlayer[] = [{ id: socket.id, username, userId }];
      roomPlayersByCode.set(room.code, roomPlayers);
      appendRoomEvent(room, {
        type: 'player_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
          via: 'room:create',
        },
      });
      console.log(`[room:create] created room=${room.code}, players=${room.players.length}`);
      cb?.({
        ok: true,
        roomCode: room.code,
        you: socket.id,
        players: roomPlayers,
        eventMeta: getRoomMatchEventMeta(room.code),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:create] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  
socket.on('room:spectate', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const config =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : {};
    const code = String(argCode ?? '').trim().toUpperCase();
    try {
      const { username, userId } = await resolveSocketIdentity(config);
      if (!code) return cb?.({ ok: false, error: 'missing_code' });
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();

      let room: Room | null = null;
      try {
        room = getRoom(code);
      } catch {
        return cb?.({ ok: false, error: 'not_found' });
      }

      // Socket room only — DO NOT join the game engine.
      socket.join(code);
      socket.data.roomId = code;
      socket.data.username = username;
      socket.data.userId = userId;
      socket.data.playerId = socket.id;

      // Send roster snapshot
      const roster = roomPlayersByCode.get(code) ?? [];
      socket.emit('room:update', { players: roster });

      // Send a spectator-safe snapshot to just this socket.
      if (room.state) {
        const stateWithCounts = {
          ...room.state,
          players: Object.fromEntries(
            room.state.playerIds.map((pid: string) => {
              const playerState = room.state!.players[pid];
              if (!playerState) {
                return [pid, { id: pid, hand: [], score: 0 }];
              }
              const canReveal = room.state!.handOver || room.state!.gameOver || pid === socket.id || pid === socket.data?.playerId;
              return [
                pid,
                {
                  ...playerState,
                  hand: canReveal ? playerState.hand : [],
                },
              ];
            }),
          ),
          handCounts: Object.fromEntries(
            room.state.playerIds.map((pid: string) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
          ),        };
        socket.emit('state:update', {
          state: stateWithCounts,
          legalMoves: [],
          canDraw: false,
          eventMeta: getRoomMatchEventMeta(code),
        });
      }

      appendRoomEvent(room, {
        type: 'spectator_joined',
        actorSocketId: socket.id,
        actorUserId: userId,
        payload: {
          username,
        },
      });

      cb?.({ ok: true, roomCode: code, players: roster, eventMeta: getRoomMatchEventMeta(code) });
    } catch (e) {
      cb?.({ ok: false, error: 'spectate_failed' });
    }
  });

  socket.on('room:join', async (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const cb = (
      typeof arg3 === 'function' ? arg3 : typeof arg2 === 'function' ? arg2 : undefined
    ) as AckFn | undefined;
    const explicitConfig =
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? (arg2 as RoomJoinConfig) : null;
    const codeFromObject =
      argCode && typeof argCode === 'object' && !Array.isArray(argCode)
        ? (argCode as { roomCode?: unknown; username?: unknown; userId?: unknown; authToken?: unknown })
        : null;
    const configFromCodeObject: RoomJoinConfig | null = codeFromObject
      ? {
          username:
            typeof codeFromObject.username === 'string' ? codeFromObject.username : undefined,
          userId: typeof codeFromObject.userId === 'string' ? codeFromObject.userId : null,
          authToken: typeof codeFromObject.authToken === 'string' ? codeFromObject.authToken : null,
        }
      : null;
    const config = explicitConfig ?? configFromCodeObject ?? {};
    const rawCode = codeFromObject?.roomCode ?? argCode;
    const roomCode = String(rawCode ?? '')
      .trim()
      .toUpperCase();
    console.log(`[room:join] socket=${socket.id}, code=${roomCode}`);
    try {
      const { username, userId } = await resolveSocketIdentity(config);
      console.log(`[room:join] identity user=${username} (${userId})`);
      clearSocketRematchReady((socket.data?.roomId as string | undefined) ?? undefined, socket.id);
      leaveExistingSocketRooms();
      let room: Room | null = null;
      let roster: RoomPlayer[] = [];
      let migratedByUserId = false;
      const existingRoom = getRoom(roomCode);
      roster = (
        roomPlayersByCode.get(roomCode) ??
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).slice();
      if (existingRoom && userId) {
        const existingPlayer = roster.find((player) => player.userId === userId);
        if (existingPlayer) {
          const oldSocket = io.sockets.sockets.get(existingPlayer.id);
          if (oldSocket && oldSocket.id !== socket.id && oldSocket.connected) {
            console.log(`[room:join] REJECTED: user ${userId} already connected via ${oldSocket.id}`);
            return cb?.({ ok: false, error: 'already_connected' });
          }

          console.log(`[room:join] RECONNECT: migrating ${existingPlayer.id} -> ${socket.id} for userId=${userId}`);
          migrateRoomSeat(roomCode, existingPlayer.id, socket.id);
          roster = roster
            .map((player) =>
              player.id === existingPlayer.id ? { ...player, id: socket.id, username, userId } : player,
            );
          roomPlayersByCode.set(roomCode, roster);
          socket.data.roomId = roomCode;
          socket.data.playerId = socket.id;
          room = existingRoom;
          migratedByUserId = true;
          appendRoomEvent(room, {
            type: 'player_reconnected',
            actorSocketId: socket.id,
            actorUserId: userId,
            payload: {
              previousSocketId: existingPlayer.id,
              username,
            },
          });
        }
      }
      if (!migratedByUserId) {
        try {
          room = joinRoom(roomCode, socket.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown error';
          if (!message.toLowerCase().includes('room is full')) {
            throw err;
          }
          const seats = pruneReconnectSeats(roomCode);
          const match = seats.find((seat) =>
            identityMatchesReconnectSeat(seat, {
              username,
              userId,
            }),
          );
          if (!match) throw err;
          migrateRoomSeat(roomCode, match.oldSocketId, socket.id);
          reconnectSeatsByCode.set(
            roomCode,
            seats.filter((seat) => seat.oldSocketId !== match.oldSocketId),
          );
          roster = roster
            .map((player) =>
              player.id === match.oldSocketId ? { ...player, id: socket.id, username, userId } : player,
            )
            .filter((player) => player.id !== match.oldSocketId);
          room = getRoom(roomCode);
        }
      }
      if (!room) throw new Error('Room not found.');
      socket.join(room.code);
      socket.data.roomId = room.code;
      socket.data.username = username;
      socket.data.userId = userId;
      socket.data.playerId = socket.id;
      const existingIdx = roster.findIndex((p) => p.id === socket.id);
      if (existingIdx >= 0) {
        roster[existingIdx] = { id: socket.id, username, userId };
      } else {
        roster.push({ id: socket.id, username, userId });
        appendRoomEvent(room, {
          type: 'player_joined',
          actorSocketId: socket.id,
          actorUserId: userId,
          payload: {
            username,
            via: migratedByUserId ? 'reconnect' : 'room:join',
          },
        });
      }
      roomPlayersByCode.set(room.code, roster);
      io.to(room.code).emit('room:update', { players: roster });
      console.log(`[room:join] joined room=${room.code}, players=${room.players.length}`);
      const stateWithCounts = room.state
        ? {
            ...room.state,
            players: Object.fromEntries(
              room.state.playerIds.map((pid) => {
                const playerState = room.state!.players[pid];
                if (!playerState) {
                  return [pid, { id: pid, hand: [], score: 0 }];
                }
                const canReveal = room.state!.handOver || room.state!.gameOver || pid === socket.id || pid === socket.data?.playerId;
                return [
                  pid,
                  {
                    ...playerState,
                    hand: canReveal ? playerState.hand : [],
                  },
                ];
              }),
            ),
            handCounts: Object.fromEntries(
              room.state.playerIds.map((pid) => [pid, room.state!.players[pid]?.hand.length ?? 0]),
            ),
          }
        : null;
      const rejoinLegalMoves = room.state ? getRoomLegalMoves(room.code, socket.id) : [];
      const rejoinCanDraw = room.state ? getRoomCanDraw(room.code, socket.id) : false;
      cb?.({
        ok: true,
        roomCode: room.code,
        you: socket.id,
        players: roster,
        state: stateWithCounts,
        legalMoves: rejoinLegalMoves,
        canDraw: rejoinCanDraw,
        eventMeta: getRoomMatchEventMeta(room.code),
      });
      // Broadcast updated state so the rejoined socket
      // receives legal moves immediately as a fallback.
      if (room.state) {
        try {
          broadcastStateUpdate(room.code);
        } catch {
          // non-fatal
        }

        // REPLAY hand:ended if rejoining into a handOver state
        if (room.state.handOver && !room.state.gameOver) {
          const payload = buildHandEndedPayload(room, socket.id);
          if (payload) {
            socket.emit('hand:ended', payload);
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[room:join] ERROR: ${message}`);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('room:leave', (roomCode: unknown, cb?: AckFn) => {
    const code = typeof roomCode === 'string' ? roomCode.trim().toUpperCase() : '';
    if (!code) {
      cb?.({ ok: false, error: 'missing_code' });
      return;
    }

    leaveTrackedRoom(code);
    cb?.({ ok: true, roomCode: code });
  });

  socket.on('game:start', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:start] socket=${socket.id}, code=${roomCode}`);
    try {
      const existingRoom = getRoom(roomCode);
      if (!existingRoom.players.includes(socket.id)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only room players can start the game.' });
        return;
      }
      if (existingRoom.players[0] !== socket.id) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only the room host can start the game.' });
        return;
      }
      const liveCount = io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
      const rosterCount = (
        roomPlayersByCode.get(roomCode) ??
        getRoomPlayersWithFallback(roomCode, existingRoom.players)
      ).length;
      if (liveCount < 2 || rosterCount < 2) {
        if (typeof cb === 'function') cb({ ok: false, error: 'waiting_for_players' });
        return;
      }
      const room = await startGame(roomCode, io);
      console.log(
        `[game:start] game started, handNumber=${room.state?.handNumber}, handOver=${room.state?.handOver}`,
      );
      if (getPendingFritzMatchContext(room)) {
        await insertPendingFritzMatch(room);
      }
      broadcastStateUpdate(room.code);
      if (typeof cb === 'function') cb({ ok: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:start] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('game:action', async (code, action, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[game:action] socket=${socket.id}, code=${roomCode}, action=${action?.type}`);
    try {
      const existingRoom = getRoom(roomCode);
      if (!existingRoom.players.includes(socket.id)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Spectators cannot act.' });
        return;
      }
      const result = await act(roomCode, socket.id, action, io, (code) => broadcastStateUpdate(code));
      const room = result.room;
      if (result.forcedDrawAnimation) {
        emitForcedDrawAnimationPayload(room.code, result.forcedDrawAnimation);
      }
      broadcastStateUpdate(room.code);
      if (result.manualDrawAnimation) {
        emitManualDrawAnimationPayload(room.code, result.manualDrawAnimation);
      }
      maybeFinalizeTournamentMatch(room);
      if (process.env.NODE_ENV !== 'production' || process.env.MP_DEBUG === '1' || process.env.DEBUG_MP === '1') {
        console.log('[mp-action-ack]', {
          roomCode: room.code,
          playerId: socket.id,
          action: action?.type,
          sequence: room.state?.sequence ?? null,
        });
      }
      if (typeof cb === 'function') cb({ ok: true, sequence: room.state?.sequence ?? null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[game:action] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:next', async (code, cb) => {
    const roomCode = String(code).trim().toUpperCase();
    console.log(`[hand:next] socket=${socket.id}, code=${roomCode}`);
    try {
      const room = getRoom(roomCode);
      if (!room.players.includes(socket.id)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Only room players can advance hands.' });
        return;
      }
      if (typeof cb === 'function') {
        cb({ ok: false, error: 'Use hand:ready to advance hands.' });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      console.log(`[hand:next] ERROR: ${message}`);
      if (typeof cb === 'function') cb({ ok: false, error: message });
    }
  });

  socket.on('hand:ready', async (code, arg2?: unknown, arg3?: unknown) => {
    const roomCode = String(code).trim().toUpperCase();
    const handNumber = typeof arg2 === 'number' && Number.isFinite(arg2) ? arg2 : undefined;
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as AckFn | undefined;
    try {
      const result = await readyForNextHand(roomCode, socket.id, io, handNumber, (code) => {
        broadcastStateUpdate(code);
      });
      if (result.started) {
        broadcastStateUpdate(result.room.code);
        maybeFinalizeTournamentMatch(result.room);
      }
      cb?.({
        ok: !result.ignored,
        started: result.started,
        ignored: Boolean(result.ignored),
        handNumber: result.room.state?.handNumber ?? null,
        waitMs: result.waitMs ?? 0,
        error: result.ignored ? 'stale_or_duplicate_hand_ready' : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('game:rematch', async (code: unknown, cb?: AckFn) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    try {
      const room = getRoom(roomCode);
      const cfg = (room as any).config ?? {};

      if (cfg.tournamentId) {
        return cb?.({ ok: false, error: 'Rematch is unavailable in tournament rooms.' });
      }
      if (!room.players.includes(socket.id)) {
        return cb?.({ ok: false, error: 'Only room players can request rematch.' });
      }
      if (!room.state) {
        return cb?.({ ok: false, error: 'Game not started.' });
      }
      if (!room.state.gameOver) {
        return cb?.({ ok: false, error: 'Rematch is only available after game over.' });
      }

      room.rematchReady.add(socket.id);
      appendRoomEvent(room, {
        type: 'rematch_requested',
        actorSocketId: socket.id,
        actorUserId: normalizeUserId(socket.data?.userId),
        payload: {
          readyCount: room.rematchReady.size,
          requiredCount: room.players.length,
        },
      });
      emitRematchStatus(room.code);

      const bothReady =
        room.players.length === 2 && room.players.every((playerId) => room.rematchReady.has(playerId));
      if (!bothReady) {
        return cb?.({ ok: true, started: false });
      }

      room.rematchReady.clear();
      (room as any)._matchLogged = false;
      (room as any)._leadTracker = {
        aId: room.players[0],
        bId: room.players[1],
        maxLeadA: 0,
        maxLeadB: 0,
      };
      try {
        await persistRoomMatchLog(room, room.state?.gameOver ? 'completed' : 'abandoned');
      } catch (error) {
        console.error('[room-match-logs] failed to archive room before rematch reset:', error);
      }
      resetRoomEventLog(room);
      appendRoomEvent(room, {
        type: 'rematch_started',
        actorSocketId: socket.id,
        actorUserId: normalizeUserId(socket.data?.userId),
        payload: {
          players: [...room.players],
        },
      });
      await startGame(room.code, io, { allowRestart: true });
      broadcastStateUpdate(room.code);
      io.to(room.code).emit('game:rematch:started', { roomCode: room.code });
      emitRematchStatus(room.code);
      cb?.({ ok: true, started: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('player:dragging', (code: unknown, payload?: { dragging?: boolean }) => {
    const roomCode = String(code ?? '').trim().toUpperCase();
    if (!roomCode) return;
    try {
      const room = getRoom(roomCode);
      if (!room.players.includes(socket.id)) return;
      socket.to(roomCode).emit('player:dragging', {
        playerId: socket.id,
        dragging: Boolean(payload?.dragging),
      });
    } catch {
      // ignore invalid room
    }
  });

  socket.on('disconnect', () => {
    removeSocketPresence();
    const roomCode = (socket.data?.roomId as string | undefined) ?? undefined;
    const userId = normalizeUserId(socket.data?.userId);
    let wasActiveRoomPlayer = false;
    if (roomCode) {
      try {
        const room = getRoom(roomCode);
        if (room.players.includes(socket.id)) {
          wasActiveRoomPlayer = true;
          reserveReconnectSeat(roomCode, {
            oldSocketId: socket.id,
            username: normalizeUsername(socket.data?.username),
            userId,
          });
        }
      } catch {
        // room no longer exists
      }
    }
    leaveTrackedRoom(roomCode, { preserveSeat: wasActiveRoomPlayer });
    if (isUuidLike(userId) && roomCode && wasActiveRoomPlayer) {
      const verifiedUserId = userId as string;
      void (async () => {
        try {
          const pendingRows = await supabaseFetch<any[]>(
            `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${roomCode}&user_id=eq.${verifiedUserId}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
          );
          const pending = pendingRows?.[0];
          if (!pending?.id) return;

          await supabaseFetch(`/rest/v1/bot_match_pending?id=eq.${pending.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ resolved: true }),
          });
          await recordPendingFritzDisconnectLoss(verifiedUserId, pending.fritz_tier);
        } catch (error) {
          console.error('[Fritz] disconnect loss handling failed:', error);
        }
      })();
    }
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = 3001;

void warmDailyFritzRuns('startup', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
scheduleDailyFritzWarmup();

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  startRankingCron();
});
