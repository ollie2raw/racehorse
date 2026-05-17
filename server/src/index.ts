import './loadEnv';
import fs from 'node:fs';
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
import { computeOnlineCurrentWinStreak } from './stats/onlineWinStreak';
import { recordPublicOnlineMatch } from './stats/recordPublicMatch';
import { socialRouter } from './social/routes';
import { upsertPresence } from './social/presence';
import { writeMatchActivity, writePuzzleActivity, writeDailyFritzActivity } from './social/activityWriter';
import { supabaseFetch } from './supabaseUtils';
import {
  buildDailyFritzCompletionHash,
  generateDailyFritzRun,
  generateSingleDailyFritzGameHand,
  getDailyFritzGameSeed,
  getDailyFritzSeed,
  sortDailyFritzLeaderboard,
  type DailyFritzAttemptStatus,
  type DailyFritzHandDeal,
  type DailyFritzLeaderboardEntry,
  type DailyFritzRunStatus,
  type DailyFritzSetGameNumber,
  type DailyFritzSetGameResult,
  type DailyFritzSetResult,
  type DailyFritzTier,
} from './dailyFritz';
import {
  appendDailyFritzGameToSet,
  getDailyFritzSkunkLossRank,
  getDailyFritzSkunkWinRank,
  normalizeDailyFritzSetSkunkFields,
} from './dailyFritzSkunk';
import {
  buildDailyPuzzleLeaderboard,
  calculateDailyPuzzleAwardedPoints,
  findReadyDailyPuzzleLadderSlots,
  isDailyPuzzleLadderReady,
  normalizeDailyPuzzleAttempt,
  normalizeDailyPuzzleSlot,
  normalizeDailyPuzzleSlotResult,
  sortDailyPuzzleSlots,
  type DailyPuzzleAttempt,
  type DailyPuzzleAttemptRow,
  type DailyPuzzleLeaderboardEntry,
  type DailyPuzzleSlot,
  type DailyPuzzleSlotIndex,
  type DailyPuzzleSlotResult,
  type DailyPuzzleSlotResultRow,
  type DailyPuzzleSlotRow,
} from './dailyPuzzle';
import { ensureDailyPuzzleLadderForDate } from './seedDailyPuzzleLadder';
import {
  buildHomeDailySummary,
  createHomeDailyCompletionMap,
} from './homeDailySummary';
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
  peekRoom,
  deleteRoom,
  getRoomLegalMoves,
  getRoomCanDraw,
  getRoomMatchEventMeta,
  getRoomMatchEventSnapshot,
  getRoomRuntimeStats,
  type DrawAnimationStep,
  type Room,
} from './rooms';
import { appendRoomEvent, resetRoomEventLog } from './roomEvents';
import { registerMatchmakingHandlers } from './matchmaking';
import { recordMatchEnd } from './matchmaking/persistence';
import {
  bootstrapScheduledTournamentInfrastructure,
  initScheduledTournaments,
  applyMatchResult as applyTournamentMatchResult,
} from './scheduledTournament';
import {
  clearDisconnectGrace,
  onActivePlayerSocketDisconnect,
  onPlayerSocketRejoined,
} from './multiplayer/disconnectGrace';
import {
  allocatePlayerSeatId,
  cancelRoomCleanup,
  clearReconnectSeatsForSocket,
  clearRoomMetadata,
  ensureSocketDataSeat,
  evaluateRoomLifecycle,
  getEngineSeatSocketIds,
  getRoomPlayersWithFallback,
  getRoomRoster,
  getSeatIdForSocket,
  getSocketForSeat,
  deleteRoomRoster,
  identityMatchesReconnectSeat,
  initRoomSession,
  joinSocketToRoom,
  broadcastStateUpdate,
  buildHandEndedPayload,
  buildMatchStartDeps,
  clearSocketRematchReady,
  emitForcedDrawAnimationPayload,
  emitRematchStatus,
  getHandCounts,
  maskStateForRecipient,
  migrateRoomSeat,
  pruneReconnectSeats,
  ROOM_CLEANUP_GRACE_MS,
  releaseReconnectSeat,
  reserveReconnectSeat,
  resolveActorSeatId,
  scheduleRoomCleanup,
  setRoomRoster,
  type AckFn,
  type GameOverPersistInput,
  type RoomJoinConfig,
  type RoomPlayer,
} from './multiplayer/roomSession';
import {
  handleRoomPlayerDisconnect,
  registerRoomSessionHandlers,
} from './multiplayer/registerRoomSessionHandlers';
import { markMatchStartReady, tryStartMatchIfReady } from './multiplayer/matchStartReady';
import type { BranchArm, GameState } from './game/types';
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

/** Public web app URL (e.g. Vercel). Set on Render so CORS matches your deployed client. */
const CLIENT_DEPLOY_URL = process.env.CLIENT_URL?.trim() || undefined;

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (CLIENT_DEPLOY_URL && origin === CLIENT_DEPLOY_URL) return true;
  if (configuredCorsOrigins.includes(origin)) return true;
  return allowedOriginPatterns.some((pattern) => pattern.test(origin));
};

/** Exact origins always tried before pattern-based `isAllowedOrigin` (Socket.IO + docs clarity). */
const socketIoExplicitOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(CLIENT_DEPLOY_URL ? [CLIENT_DEPLOY_URL] : []),
  ...configuredCorsOrigins,
];
const uniqueSocketIoExplicitOrigins = [...new Set(socketIoExplicitOrigins)];

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
app.use('/api/social', socialRouter);
app.use('/api/profile', socialRouter);

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

  const controller = new AbortController();
  const authTimeoutMs = 12_000;
  const authTimeout = setTimeout(() => controller.abort(), authTimeoutMs);
  let response: Response;
  try {
    response = await fetch(new URL('/auth/v1/user', supabaseUrl), {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.warn('[auth] token validation timed out', { authTimeoutMs });
      return null;
    }
    throw error;
  } finally {
    clearTimeout(authTimeout);
  }
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

app.get('/ping', (_, res) => {
  res.json({ status: 'ok' });
});

/** Multiplayer process-local stats (in-memory rooms; resets on deploy / spin-down). */
app.get('/api/mp-stats', (_req, res) => {
  const { roomCount, gamesInProgress } = getRoomRuntimeStats();
  res.json({
    ok: true,
    pid: process.pid,
    roomCount,
    gamesInProgress,
    connectedSockets: io.sockets.sockets.size,
    roomCleanupGraceMs: ROOM_CLEANUP_GRACE_MS,
  });
});

app.get('/api/home/daily-summary', async (req, res) => {
  const today = getPacificDateKey();
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);

    if (!authenticatedUserId) {
      res.json({
        ok: true,
        ...buildHomeDailySummary(today, {}, new Date()),
      });
      return;
    }

    const [fritzDates, ladderPuzzleDates, legacyPuzzleDates] = await Promise.all([
      listCompletedDailyFritzDatesForUser(authenticatedUserId),
      listCompletedDailyPuzzleLadderDatesForUser(authenticatedUserId),
      listCompletedLegacyDailyPuzzleDatesForUser(authenticatedUserId),
    ]);

    const puzzleDates = Array.from(new Set([...ladderPuzzleDates, ...legacyPuzzleDates]));
    const completionMap = createHomeDailyCompletionMap(fritzDates, puzzleDates);

    res.json({
      ok: true,
      ...buildHomeDailySummary(today, completionMap, new Date()),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load homepage daily summary.';
    const timedOut = error instanceof Error && /timed out|aborted/i.test(message);
    if (timedOut) {
      console.warn('[home:daily-summary] upstream timeout; returning anonymous fallback', { message });
      res.json({
        ok: true,
        warning: 'completion_history_unavailable',
        ...buildHomeDailySummary(today, {}, new Date()),
      });
      return;
    }
    res.status(500).json({ error: message });
  }
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
/** Ladder / Fritz warmups can hold the event loop; avoid closing reused proxy sockets mid-request. */
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (uniqueSocketIoExplicitOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Socket.IO CORS blocked for origin: ${origin ?? 'unknown'}`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  /** Longer windows help mobile / cold Render instances; defaults are easy to false-positive disconnect. */
  pingTimeout: 60_000,
  pingInterval: 25_000,
  connectTimeout: 45_000,
  maxHttpBufferSize: 1e6,
});

const socketsByUserId = new Map<string, Set<string>>();

/**
 * After Render/deploy the in-memory Map is empty but matchmaking still has an
 * `in_progress` row. Recreate a reserved room shell so players can re-seat;
 * game state is not restored (would require separate persisted snapshots).
 */
async function tryHydrateMatchmakingRoomShell(roomCode: string): Promise<'skipped' | 'already' | 'hydrated' | 'miss'> {
  const code = roomCode.trim().toUpperCase();
  if (!code.startsWith('MM')) return 'skipped';
  if (peekRoom(code)) return 'already';
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matchmaking_matches?room_code=eq.${encodeURIComponent(code)}&status=eq.in_progress&select=id&limit=1`,
    );
    const id = typeof rows[0]?.id === 'string' ? rows[0].id : null;
    if (!id) return 'miss';
    const room = createReservedRoom(code, { winningScore: 60 });
    room.matchmakingMatchId = id;
    console.log('[room:hydrate] matchmaking shell restored', { roomCode: code, matchmakingMatchId: id });
    return 'hydrated';
  } catch (err) {
    console.warn('[room:hydrate] failed', err instanceof Error ? err.message : err);
    return 'miss';
  }
}

/** Matchmaking: allow the second client up to this long after both seats fill before attempting deal. */
const MATCHMAKING_JOIN_SYNC_MAX_MS = 5000;

/**
 * Ensures both engine seat sockets have executed `socket.join(roomCode)` so the
 * subsequent `broadcastStateUpdate` reliably reaches everyone.
 */
async function waitUntilMatchmakingRoomSocketsReady(
  io: Server,
  roomCode: string,
  engineSeatSocketIds: string[],
): Promise<void> {
  if (engineSeatSocketIds.length < 2) return;
  const deadline = Date.now() + MATCHMAKING_JOIN_SYNC_MAX_MS;
  while (Date.now() < deadline) {
    const members = io.sockets.adapter.rooms.get(roomCode);
    if (members && engineSeatSocketIds.every((id) => members.has(id))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

// Emit presence:update to all sockets of friends who are currently connected.
function emitPresenceUpdateToFriends(userId: string, status: string): void {
  void (async () => {
    try {
      const enc = encodeURIComponent(userId);
      const rows = await supabaseFetch<Array<{ user_id: string; friend_user_id: string }>>(
        `/rest/v1/friends?or=(user_id.eq.${enc},friend_user_id.eq.${enc})` +
        `&status=eq.accepted&select=user_id,friend_user_id`,
      );
      for (const r of rows) {
        const friendId = r.user_id === userId ? r.friend_user_id : r.user_id;
        const friendSockets = socketsByUserId.get(friendId);
        if (!friendSockets?.size) continue;
        for (const socketId of friendSockets) {
          io.to(socketId).emit('presence:update', { userId, status });
        }
      }
    } catch { /* non-critical */ }
  })();
}
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

function normalizeDailyFritzSetGameNumber(value: unknown): DailyFritzSetGameNumber | null {
  return value === 1 || value === 2 || value === 3 ? value : null;
}

function normalizeDailyFritzSetGameResult(value: unknown): DailyFritzSetGameResult | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const gameNumber = normalizeDailyFritzSetGameNumber(Number(rec.gameNumber));
  const seed = typeof rec.seed === 'string' ? rec.seed.trim() : '';
  const playerScore = Number(rec.playerScore);
  const fritzScore = Number(rec.fritzScore);
  const pointDiff = Number(rec.pointDiff);
  const completedAt = typeof rec.completedAt === 'string' ? rec.completedAt : '';
  if (
    !gameNumber ||
    !seed ||
    typeof rec.playerWon !== 'boolean' ||
    !Number.isFinite(playerScore) ||
    !Number.isFinite(fritzScore) ||
    !Number.isFinite(pointDiff) ||
    !completedAt
  ) {
    return null;
  }
  const movesUsed = rec.movesUsed == null ? undefined : Number(rec.movesUsed);
  const handsPlayed = rec.handsPlayed == null ? undefined : Number(rec.handsPlayed);
  const safeMovesUsed = movesUsed == null || !Number.isFinite(movesUsed) ? undefined : Math.round(movesUsed);
  const safeHandsPlayed = handsPlayed == null || !Number.isFinite(handsPlayed) ? undefined : Math.round(handsPlayed);
  const skunk = rec.skunk === true;
  const skunkByRaw = rec.skunkBy ?? rec.skunk_by;
  const skunkBy = skunkByRaw === 'player' || skunkByRaw === 'fritz' ? skunkByRaw : undefined;
  return {
    gameNumber,
    seed,
    playerWon: rec.playerWon,
    playerScore: Math.round(playerScore),
    fritzScore: Math.round(fritzScore),
    pointDiff: Math.round(pointDiff),
    ...(safeMovesUsed != null ? { movesUsed: safeMovesUsed } : {}),
    ...(safeHandsPlayed != null ? { handsPlayed: safeHandsPlayed } : {}),
    completedAt,
    ...(skunk ? { skunk: true } : {}),
    ...(skunkBy ? { skunkBy } : {}),
  };
}

function normalizeDailyFritzSetResult(value: unknown): DailyFritzSetResult | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (rec.version !== 2 || rec.format !== 'best_of_3' || !Array.isArray(rec.games)) return null;
  const games = rec.games
    .map((game) => normalizeDailyFritzSetGameResult(game))
    .filter((game): game is DailyFritzSetGameResult => Boolean(game))
    .sort((a, b) => a.gameNumber - b.gameNumber);
  if (games.length !== rec.games.length || games.length > 3) return null;
  for (let index = 0; index < games.length; index += 1) {
    if (games[index].gameNumber !== index + 1) return null;
  }
  const totalPointDiff = games.reduce((sum, game) => sum + game.pointDiff, 0);
  const skunkFields = normalizeDailyFritzSetSkunkFields(games, rec);
  return {
    version: 2,
    format: 'best_of_3',
    totalPointDiff,
    games,
    ...skunkFields,
  };
}

function getDailyFritzSetPointDiff(setResult: DailyFritzSetResult | null): number | null {
  if (!setResult || setResult.version !== 2 || setResult.format !== 'best_of_3') return null;
  if (Number.isFinite(setResult.totalPointDiff)) return Math.round(setResult.totalPointDiff);
  if (setResult.games.length === 0) return 0;
  return Math.round(
    setResult.games.reduce(
      (sum, game) => sum + (Number.isFinite(game.pointDiff) ? Number(game.pointDiff) : Number(game.playerScore) - Number(game.fritzScore)),
      0,
    ),
  );
}

function getCurrentDailyFritzGameNumber(result: Record<string, unknown> | null): DailyFritzSetGameNumber {
  const setResult = normalizeDailyFritzSetResult(result);
  if (!setResult || setResult.setWinner) return 1;
  return Math.min(setResult.games.length + 1, 3) as DailyFritzSetGameNumber;
}

function getDailyFritzHandForGame(
  run: DailyFritzRunRecord,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
): DailyFritzHandDeal {
  return generateSingleDailyFritzGameHand(run.runDate, gameNumber, handIndex, run.dealSize as 7 | 14);
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

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** Off by default in production; set ENABLE_STARTUP_FRITZ_WARMUP=true to run on boot. */
function isStartupDailyFritzWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_FRITZ_WARMUP);
}

/** Off by default in production; set ENABLE_STARTUP_PUZZLE_WARMUP=true to run on boot. */
function isStartupDailyPuzzleWarmupEnabled(): boolean {
  return isTruthyEnvFlag(process.env.ENABLE_STARTUP_PUZZLE_WARMUP);
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

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function warmDailyPuzzleLadders(reason: 'startup' | 'scheduled', runDates: string[]): Promise<void> {
  const startedAt = Date.now();
  console.log('[daily-puzzle-ladder-warmup] start', { reason, runDates });
  try {
    const results: Array<{ runDate: string; ms: number; outcome: 'skipped' | 'seeded' | 'failed' }> = [];
    for (const runDate of runDates) {
      await yieldEventLoop();
      const slotStartedAt = Date.now();
      const outcome = await ensureDailyPuzzleLadderForDate(runDate, { force: false });
      results.push({ runDate, ms: Date.now() - slotStartedAt, outcome });
    }
    console.log('[daily-puzzle-ladder-warmup] success', {
      reason,
      totalMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.warn('[daily-puzzle-ladder-warmup] error', {
      reason,
      totalMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleDailyPuzzleLadderWarmup(): void {
  const nextWarmupAt = getNextPacificWarmupAt(0, 2);
  const delayMs = Math.max(1000, nextWarmupAt.getTime() - Date.now());
  setTimeout(async () => {
    await warmDailyPuzzleLadders('scheduled', [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)]);
    scheduleDailyPuzzleLadderWarmup();
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
      .map((attempt) => {
        const setResult = normalizeDailyFritzSetResult(attempt.result);
        const pointDiff = getDailyFritzSetPointDiff(setResult) ?? attempt.pointDiff;
        if (
          typeof attempt.won !== 'boolean' ||
          typeof attempt.finalScore !== 'number' ||
          typeof attempt.opponentScore !== 'number' ||
          typeof pointDiff !== 'number' ||
          typeof attempt.movesUsed !== 'number' ||
          typeof attempt.completedAt !== 'string'
        ) {
          return null;
        }
        return {
          userId: attempt.userId,
          username: names.get(attempt.userId) ?? `user_${attempt.userId.slice(0, 8)}`,
          won: attempt.won,
          finalScore: attempt.finalScore,
          opponentScore: attempt.opponentScore,
          pointDiff,
          movesUsed: attempt.movesUsed,
          completedAt: attempt.completedAt,
          ...(setResult
            ? {
                skunkWinRank: getDailyFritzSkunkWinRank(setResult),
                skunkLossRank: getDailyFritzSkunkLossRank(setResult),
              }
            : {}),
          ...(setResult?.games.length
            ? {
                games: setResult.games.map((game) => ({
                  gameNumber: game.gameNumber,
                  playerScore: game.playerScore,
                  fritzScore: game.fritzScore,
                  playerWon: game.playerWon,
                  pointDiff: game.pointDiff,
                  ...(game.skunk ? { skunk: true } : {}),
                  ...(game.skunkBy ? { skunkBy: game.skunkBy } : {}),
                })),
              }
            : {}),
        };
      })
      .filter((attempt): attempt is DailyFritzLeaderboardEntry & { userId: string } => Boolean(attempt)),
  );
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function listDailyPuzzleSlotsForDate(runDate: string): Promise<DailyPuzzleSlot[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotRow[]>(
    `/rest/v1/daily_puzzles?select=id,puzzle_date,title,starting_board,starting_hand,max_moves,target_score,puzzle_type,deal_size,slot_index,slot_title,tier,slot_max_points,objective_type,objective_payload,set_version,published&published=eq.true&puzzle_date=eq.${encodeURIComponent(runDate)}&order=set_version.asc,slot_index.asc,id.asc`,
    { method: 'GET' },
  );
  return sortDailyPuzzleSlots(rows.map(normalizeDailyPuzzleSlot));
}

/** If no ready ladder exists for this Pacific date, generate and upsert three slots (idempotent). */
async function listDailyPuzzleSlotsForDateWithAutoSeed(runDate: string): Promise<DailyPuzzleSlot[]> {
  try {
    let slots = await listDailyPuzzleSlotsForDate(runDate);
    if (isDailyPuzzleLadderReady(slots)) return slots;
    const outcome = await ensureDailyPuzzleLadderForDate(runDate, { force: false });
    if (outcome === 'seeded') {
      slots = await listDailyPuzzleSlotsForDate(runDate);
    }
    return slots;
  } catch (error) {
    console.warn('[daily-puzzle-ladder] listDailyPuzzleSlotsForDateWithAutoSeed failed', {
      runDate,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function isAuthorizedDailyPuzzleCronRequest(req: express.Request): boolean {
  const secret = process.env.DAILY_PUZZLE_CRON_SECRET?.trim();
  if (!secret) return false;
  const headerRaw = req.headers['x-daily-puzzle-cron-secret'];
  const fromHeader = typeof headerRaw === 'string' ? headerRaw.trim() : '';
  if (fromHeader === secret) return true;
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  return Boolean(m?.[1]?.trim() && m[1].trim() === secret);
}

async function getDailyPuzzleAttempt(runDate: string, userId: string): Promise<DailyPuzzleAttempt | null> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    `/rest/v1/daily_puzzle_attempts?select=id,puzzle_date,user_id,username,status,set_version,current_slot_index,puzzles_completed,total_score,master_chain_score,completed_at,started_at,updated_at,review_unlocked,result&puzzle_date=eq.${encodeURIComponent(runDate)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows[0];
  if (!row) return null;
  const slotResults = await listDailyPuzzleSlotResults(row.id);
  return normalizeDailyPuzzleAttempt(row, slotResults);
}

async function getDailyPuzzleAttemptById(
  attemptId: string,
  userId: string,
): Promise<DailyPuzzleAttempt | null> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    `/rest/v1/daily_puzzle_attempts?select=id,puzzle_date,user_id,username,status,set_version,current_slot_index,puzzles_completed,total_score,master_chain_score,completed_at,started_at,updated_at,review_unlocked,result&id=eq.${encodeURIComponent(attemptId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const row = rows[0];
  if (!row) return null;
  const slotResults = await listDailyPuzzleSlotResults(row.id);
  return normalizeDailyPuzzleAttempt(row, slotResults);
}

async function listDailyPuzzleSlotResults(attemptId: string): Promise<DailyPuzzleSlotResult[]> {
  const rows = await supabaseFetch<DailyPuzzleSlotResultRow[]>(
    `/rest/v1/daily_puzzle_slot_results?select=id,attempt_id,puzzle_id,puzzle_date,user_id,slot_index,tier,slot_title,puzzle_type,raw_score,awarded_points,best_possible_score,slot_max_points,solved,perfect,moves_used,elapsed_seconds,submitted_line,result,completed_at&attempt_id=eq.${encodeURIComponent(attemptId)}&order=slot_index.asc,completed_at.asc,id.asc`,
    { method: 'GET' },
  );
  return rows.map(normalizeDailyPuzzleSlotResult);
}

async function createDailyPuzzleAttempt(params: {
  runDate: string;
  userId: string;
  username: string | null;
  setVersion: number;
}): Promise<DailyPuzzleAttempt> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    '/rest/v1/daily_puzzle_attempts',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        puzzle_date: params.runDate,
        user_id: params.userId,
        username: params.username,
        status: 'started',
        set_version: params.setVersion,
        current_slot_index: 1,
        puzzles_completed: 0,
        total_score: 0,
        master_chain_score: 0,
        review_unlocked: false,
        result: {},
      }]),
    },
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create daily puzzle attempt.');
  return normalizeDailyPuzzleAttempt(row, []);
}

async function persistDailyPuzzleAttempt(attempt: DailyPuzzleAttempt): Promise<DailyPuzzleAttempt> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    '/rest/v1/daily_puzzle_attempts?on_conflict=id',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([{
        id: attempt.id,
        puzzle_date: attempt.puzzleDate,
        user_id: attempt.userId,
        username: attempt.username,
        status: attempt.status,
        set_version: attempt.setVersion,
        current_slot_index: attempt.currentSlotIndex,
        puzzles_completed: attempt.puzzlesCompleted,
        total_score: attempt.totalScore,
        master_chain_score: attempt.masterChainScore,
        completed_at: attempt.completedAt,
        started_at: attempt.startedAt,
        updated_at: new Date().toISOString(),
        review_unlocked: attempt.reviewUnlocked,
        result: {
          slots: attempt.result.slots,
          ...(attempt.result.final ? { final: attempt.result.final } : {}),
        },
      }]),
    },
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to persist daily puzzle attempt.');
  const slotResults = await listDailyPuzzleSlotResults(row.id);
  return normalizeDailyPuzzleAttempt(row, slotResults);
}

async function createDailyPuzzleSlotResult(input: {
  attempt: DailyPuzzleAttempt;
  slot: DailyPuzzleSlot;
  rawScore: number;
  awardedPoints: number;
  solved: boolean;
  perfect: boolean;
  movesUsed: number;
  elapsedSeconds: number;
  submittedLine: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
}): Promise<DailyPuzzleSlotResult> {
  const rows = await supabaseFetch<DailyPuzzleSlotResultRow[]>(
    '/rest/v1/daily_puzzle_slot_results',
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        attempt_id: input.attempt.id,
        puzzle_id: input.slot.id,
        puzzle_date: input.attempt.puzzleDate,
        user_id: input.attempt.userId,
        slot_index: input.slot.slotIndex,
        tier: input.slot.tier,
        slot_title: input.slot.slotTitle,
        puzzle_type: input.slot.puzzleType,
        raw_score: input.rawScore,
        awarded_points: input.awardedPoints,
        best_possible_score: input.slot.bestPossibleScore ?? 0,
        slot_max_points: input.slot.slotMaxPoints,
        solved: input.solved,
        perfect: input.perfect,
        moves_used: input.movesUsed,
        elapsed_seconds: input.elapsedSeconds,
        submitted_line: input.submittedLine,
        result: input.result,
      }]),
    },
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to persist daily puzzle slot result.');
  return normalizeDailyPuzzleSlotResult(row);
}

async function listDailyPuzzleAttemptsForDate(runDate: string): Promise<DailyPuzzleAttempt[]> {
  const rows = await supabaseFetch<DailyPuzzleAttemptRow[]>(
    `/rest/v1/daily_puzzle_attempts?select=id,puzzle_date,user_id,username,status,set_version,current_slot_index,puzzles_completed,total_score,master_chain_score,completed_at,started_at,updated_at,review_unlocked,result&puzzle_date=eq.${encodeURIComponent(runDate)}&order=completed_at.asc.nullslast,id.asc`,
    { method: 'GET' },
  );
  if (rows.length === 0) return [];
  const attemptIds = rows.map((row) => row.id);
  const idClause = attemptIds.map((id) => `"${id}"`).join(',');
  const resultRows = await supabaseFetch<DailyPuzzleSlotResultRow[]>(
    `/rest/v1/daily_puzzle_slot_results?select=id,attempt_id,puzzle_id,puzzle_date,user_id,slot_index,tier,slot_title,puzzle_type,raw_score,awarded_points,best_possible_score,slot_max_points,solved,perfect,moves_used,elapsed_seconds,submitted_line,result,completed_at&attempt_id=in.(${encodeURIComponent(idClause)})&order=slot_index.asc,completed_at.asc,id.asc`,
    { method: 'GET' },
  );
  const resultsByAttempt = new Map<string, DailyPuzzleSlotResult[]>();
  for (const row of resultRows) {
    const result = normalizeDailyPuzzleSlotResult(row);
    const list = resultsByAttempt.get(result.attemptId);
    if (list) list.push(result);
    else resultsByAttempt.set(result.attemptId, [result]);
  }
  return rows.map((row) => normalizeDailyPuzzleAttempt(row, resultsByAttempt.get(row.id) ?? []));
}

async function buildDailyPuzzleLeaderboardForDate(runDate: string): Promise<DailyPuzzleLeaderboardEntry[]> {
  const attempts = await listDailyPuzzleAttemptsForDate(runDate);
  return buildDailyPuzzleLeaderboard(attempts);
}

async function getUsernameForUserId(userId: string): Promise<string | null> {
  const profileRows = await supabaseFetch<Array<{ id: string; username: string | null }>>(
    `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const username = profileRows[0]?.username?.trim();
  return username || null;
}

async function getDailyPuzzleLadderStreak(userId: string, todayPuzzleDate: string): Promise<number> {
  const dates = await listCompletedDailyPuzzleLadderDatesForUser(userId);
  const sortedUnique = [...new Set(dates)].sort((a, b) => b.localeCompare(a));
  if (!sortedUnique.includes(todayPuzzleDate)) return 0;
  let streak = 0;
  let cursor = new Date(`${todayPuzzleDate}T00:00:00-08:00`);
  while (true) {
    const key = getPacificDateKey(cursor);
    if (!sortedUnique.includes(key)) break;
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

async function getDailyFritzStreak(userId: string, todayRunDate: string): Promise<number> {
  const rows = await supabaseFetch<Array<{ run_date: string; status: DailyFritzAttemptStatus }>>(
    `/rest/v1/daily_fritz_attempts?select=run_date,status&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=run_date.desc&limit=365`,
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

function isMissingRelationError(error: unknown, relationName: string): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes(relationName.toLowerCase()) && (message.includes('does not exist') || message.includes('could not find'));
}

async function listCompletedDailyFritzDatesForUser(userId: string): Promise<string[]> {
  const rows = await supabaseFetch<Array<{ run_date: string | null }>>(
    `/rest/v1/daily_fritz_attempts?select=run_date&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=run_date.desc&limit=365`,
    { method: 'GET' },
  );
  return Array.from(
    new Set(
      rows
        .map((row) => row.run_date)
        .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  );
}

async function listCompletedDailyPuzzleLadderDatesForUser(userId: string): Promise<string[]> {
  const rows = await supabaseFetch<Array<{ puzzle_date: string | null }>>(
    `/rest/v1/daily_puzzle_attempts?select=puzzle_date&user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&order=puzzle_date.desc&limit=365`,
    { method: 'GET' },
  );
  return Array.from(
    new Set(
      rows
        .map((row) => row.puzzle_date)
        .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
    ),
  );
}

async function listCompletedLegacyDailyPuzzleDatesForUser(userId: string): Promise<string[]> {
  try {
    const rows = await supabaseFetch<Array<{ puzzle_date: string | null }>>(
      `/rest/v1/daily_puzzle_completions?select=puzzle_date&user_id=eq.${encodeURIComponent(userId)}&order=puzzle_date.desc&limit=365`,
      { method: 'GET' },
    );
    return Array.from(
      new Set(
        rows
          .map((row) => row.puzzle_date)
          .filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)),
      ),
    );
  } catch (error) {
    if (isMissingRelationError(error, 'daily_puzzle_completions')) return [];
    throw error;
  }
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
  const rosterCached = getRoomRoster(room.code);
  const roster =
    rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(room.code, room.players);
  const botPlayer = roster.find((player) => typeof player.id === 'string' && player.id.startsWith('bot:fritz:')) ?? null;
  const realPlayers = roster.filter((player) => player.userId);
  if (!botPlayer || realPlayers.length !== 1) return null;
  return {
    realPlayer: realPlayers[0],
    fritzTier: getFritzTierForRoom(room, botPlayer.id),
  };
}

/** Activity feed copy: "Fritz (Elite)", "Fritz (Master)", etc. */
function formatFritzActivityOpponentLabel(rawTier: string): string {
  const tier = rawTier.trim().toLowerCase();
  if (tier === 'grandmaster') return 'Fritz (Grandmaster)';
  if (tier === 'rookie' || tier === 'standard' || tier === 'elite' || tier === 'master') {
    return `Fritz (${tier.charAt(0).toUpperCase()}${tier.slice(1)})`;
  }
  return 'Fritz';
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
  
  console.log('[Local Fritz Start] Received request:', { userId, fritzTier, localMatchId });

  if (!userId || !localMatchId) {
    res.status(400).json({ error: 'userId and localMatchId are required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    console.log('[Local Fritz Start] Authenticated user:', authenticatedUserId);

    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (authenticatedUserId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const roomCode = `local:${localMatchId}`;
    
    const fritzIdentity = getFritzIdentityForTier(fritzTier);
    console.log('[Local Fritz Start] Fritz identity:', fritzIdentity);

    const verifiedMatch = await startVerifiedSinglePlayerMatch({
      userId,
      localMatchId,
      mode: 'fritz',
      opponentUserId: fritzIdentity.fritzId,
      fritzTier,
    });
    console.log('[Local Fritz Start] Verified match created:', verifiedMatch);

    const existing = await supabaseFetch<any[]>(
      `/rest/v1/bot_match_pending?select=id&room_code=eq.${encodeURIComponent(roomCode)}&user_id=eq.${encodeURIComponent(userId)}&resolved=eq.false&limit=1`,
    );
    console.log('[Local Fritz Start] Existing pending match:', existing?.[0]);

    if (!existing?.[0]?.id) {
      const pendingResponse = await supabaseFetch('/rest/v1/bot_match_pending', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          user_id: userId,
          fritz_tier: fritzTier,
          room_code: roomCode,
          resolved: false,
        }),
      });
      console.log('[Local Fritz Start] Pending match inserted:', pendingResponse);
    }
    res.json({ ok: true, roomCode, matchId: verifiedMatch.matchId });
  } catch (error) {
    console.error('[Local Fritz Start] FAILED:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
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

app.get('/api/daily-puzzle/today', async (req, res) => {
  try {
    let authenticatedUserId: string | null = null;
    try {
      authenticatedUserId = await getAuthenticatedUserId(req);
    } catch (authError) {
      console.warn('[daily-puzzle-today] auth lookup failed; continuing without user', {
        error: authError instanceof Error ? authError.message : String(authError),
      });
    }
    const runDate = getPacificDateKey();
    const allSlots = await listDailyPuzzleSlotsForDateWithAutoSeed(runDate);
    const ladderSlots = findReadyDailyPuzzleLadderSlots(allSlots);
    const ready = ladderSlots !== null;
    const slots = ladderSlots ?? allSlots;
    let leaderboard: DailyPuzzleLeaderboardEntry[] = [];
    try {
      leaderboard = await buildDailyPuzzleLeaderboardForDate(runDate);
    } catch (leaderboardError) {
      console.warn('[daily-puzzle-today] leaderboard load failed', {
        runDate,
        error: leaderboardError instanceof Error ? leaderboardError.message : String(leaderboardError),
      });
    }
    let attempt: DailyPuzzleAttempt | null = null;
    if (authenticatedUserId) {
      try {
        attempt = await getDailyPuzzleAttempt(runDate, authenticatedUserId);
      } catch (attemptError) {
        console.warn('[daily-puzzle-today] attempt load failed', {
          runDate,
          error: attemptError instanceof Error ? attemptError.message : String(attemptError),
        });
      }
    }
    const nextAvailableSlotIndex = attempt
      ? attempt.status === 'completed'
        ? null
        : attempt.currentSlotIndex
      : ready
        ? 1
        : null;
    res.json({
      ok: true,
      runDate,
      setVersion: slots[0]?.setVersion ?? 1,
      slots,
      attemptStatus: attempt?.status ?? 'none',
      attempt,
      nextAvailableSlotIndex,
      leaderboardPreview: leaderboard.slice(0, 10),
      legacySinglePuzzleDay: !ready,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load today’s Daily Puzzle ladder.',
    });
  }
});

app.post('/api/daily-puzzle/start', async (req, res) => {
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDate =
      typeof req.body?.runDate === 'string' && req.body.runDate.trim()
        ? req.body.runDate.trim()
        : getPacificDateKey();
    const slots = await listDailyPuzzleSlotsForDateWithAutoSeed(runDate);
    if (!isDailyPuzzleLadderReady(slots)) {
      res.status(409).json({ error: 'Daily Puzzle ladder is not published for this date yet.', runDate });
      return;
    }
    let attempt = await getDailyPuzzleAttempt(runDate, authenticatedUserId);
    const username = await getUsernameForUserId(authenticatedUserId);
    const replayed = Boolean(attempt);
    if (!attempt) {
      attempt = await createDailyPuzzleAttempt({
        runDate,
        userId: authenticatedUserId,
        username,
        setVersion: slots[0].setVersion,
      });
    }
    const activeSlotIndex = attempt.status === 'completed'
      ? (Math.min(Math.max(attempt.result.slots.length, 1), 3) as DailyPuzzleSlotIndex)
      : attempt.currentSlotIndex;
    const activeSlot = slots.find((slot) => slot.slotIndex === activeSlotIndex) ?? slots[slots.length - 1];
    if (!activeSlot) {
      res.status(409).json({ error: 'Daily Puzzle ladder content is incomplete.', runDate });
      return;
    }
    res.json({
      ok: true,
      runDate,
      attempt,
      activeSlot,
      nextAvailableSlotIndex: attempt.status === 'completed' ? activeSlotIndex : attempt.currentSlotIndex,
      practiceMode: attempt.reviewUnlocked ? 'review' : 'none',
      replayed,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to start Daily Puzzle ladder.',
    });
  }
});

app.post('/api/daily-puzzle/submit-slot', async (req, res) => {
  const attemptId = typeof req.body?.attemptId === 'string' ? req.body.attemptId.trim() : '';
  const puzzleDate = typeof req.body?.puzzleDate === 'string' ? req.body.puzzleDate.trim() : '';
  const puzzleId = typeof req.body?.puzzleId === 'string' ? req.body.puzzleId.trim() : '';
  const slotIndexRaw = Number(req.body?.slotIndex);
  const rawScore = Number(req.body?.rawScore);
  const movesUsed = Number(req.body?.movesUsed);
  const elapsedSeconds = Number(req.body?.elapsedSeconds);
  const submittedLine = Array.isArray(req.body?.submittedLine)
    ? (req.body.submittedLine as Array<Record<string, unknown>>)
    : [];
  const clientResult =
    req.body?.clientResult && typeof req.body.clientResult === 'object'
      ? (req.body.clientResult as Record<string, unknown>)
      : {};

  if (!attemptId || !puzzleDate || !puzzleId || !Number.isInteger(slotIndexRaw)) {
    res.status(400).json({ error: 'attemptId, puzzleDate, puzzleId, and slotIndex are required.' });
    return;
  }
  if (!Number.isFinite(rawScore) || !Number.isFinite(movesUsed) || !Number.isFinite(elapsedSeconds)) {
    res.status(400).json({ error: 'rawScore, movesUsed, and elapsedSeconds are required.' });
    return;
  }

  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyPuzzleAttemptById(attemptId, authenticatedUserId);
    if (!attempt) {
      res.status(404).json({ error: 'Daily Puzzle attempt not found.' });
      return;
    }
    if (attempt.puzzleDate !== puzzleDate) {
      res.status(400).json({ error: 'Daily Puzzle run date does not match this attempt.' });
      return;
    }
    if (attempt.status === 'completed') {
      res.status(409).json({ error: 'Daily Puzzle attempt is already completed.' });
      return;
    }
    const slotIndex = slotIndexRaw === 2 || slotIndexRaw === 3 ? slotIndexRaw : 1;
    const existing = attempt.result.slots.find((slot) => slot.slotIndex === slotIndex);
    if (existing) {
      const slots = await listDailyPuzzleSlotsForDateWithAutoSeed(attempt.puzzleDate);
      const ladderCompleted = attempt.result.slots.length >= 3;
      const nextSlot = slots.find((slot) => slot.slotIndex === attempt.currentSlotIndex) ?? null;
      res.json({
        ok: true,
        runDate: attempt.puzzleDate,
        attempt,
        slotResult: existing,
        nextAvailableSlotIndex: ladderCompleted ? null : (attempt.currentSlotIndex as 2 | 3 | null),
        nextSlot,
        ladderCompleted,
        requiresCompleteCall: ladderCompleted,
        replayed: true,
      });
      return;
    }
    if (slotIndex !== attempt.currentSlotIndex) {
      res.status(409).json({ error: 'Daily Puzzle slot order is invalid.' });
      return;
    }
    const slots = await listDailyPuzzleSlotsForDateWithAutoSeed(attempt.puzzleDate);
    if (!isDailyPuzzleLadderReady(slots)) {
      res.status(409).json({ error: 'Daily Puzzle ladder is not published for this date yet.' });
      return;
    }
    const slot = slots.find((entry) => entry.slotIndex === slotIndex && entry.id === puzzleId);
    if (!slot) {
      res.status(404).json({ error: 'Daily Puzzle slot not found for this date.' });
      return;
    }
    const bestPossibleScore = slot.bestPossibleScore ?? 0;
    const awardedPoints = calculateDailyPuzzleAwardedPoints(rawScore, bestPossibleScore, slot.slotMaxPoints);
    const solved = rawScore > 0;
    const perfect = bestPossibleScore > 0 && rawScore >= bestPossibleScore;
    const slotResult = await createDailyPuzzleSlotResult({
      attempt,
      slot,
      rawScore: Math.max(0, Math.round(rawScore)),
      awardedPoints,
      solved,
      perfect,
      movesUsed: Math.max(0, Math.round(movesUsed)),
      elapsedSeconds: Math.max(0, Math.round(elapsedSeconds)),
      submittedLine,
      result: clientResult,
    });
    const nextCurrentSlotIndex = Math.min(3, slot.slotIndex + 1) as DailyPuzzleSlotIndex;
    const nextAttempt: DailyPuzzleAttempt = {
      ...attempt,
      currentSlotIndex: nextCurrentSlotIndex,
      puzzlesCompleted: Math.min(3, attempt.puzzlesCompleted + 1),
      totalScore: attempt.totalScore + slotResult.awardedPoints,
      masterChainScore:
        slot.slotIndex === 3 ? slotResult.awardedPoints : attempt.masterChainScore,
      updatedAt: new Date().toISOString(),
      result: {
        ...attempt.result,
        slots: [...attempt.result.slots, slotResult].sort((a, b) => a.slotIndex - b.slotIndex),
      },
    };
    const saved = await persistDailyPuzzleAttempt(nextAttempt);
    const ladderCompleted = saved.result.slots.length >= 3;
    const nextSlot = ladderCompleted
      ? null
      : slots.find((entry) => entry.slotIndex === saved.currentSlotIndex) ?? null;
    res.json({
      ok: true,
      runDate: saved.puzzleDate,
      attempt: saved,
      slotResult,
      nextAvailableSlotIndex: ladderCompleted ? null : saved.currentSlotIndex,
      nextSlot,
      ladderCompleted,
      requiresCompleteCall: ladderCompleted,
      replayed: false,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to submit Daily Puzzle slot.',
    });
  }
});

app.post('/api/daily-puzzle/complete', async (req, res) => {
  const attemptId = typeof req.body?.attemptId === 'string' ? req.body.attemptId.trim() : '';
  const puzzleDate = typeof req.body?.puzzleDate === 'string' ? req.body.puzzleDate.trim() : '';
  if (!attemptId || !puzzleDate) {
    res.status(400).json({ error: 'attemptId and puzzleDate are required.' });
    return;
  }
  try {
    const authenticatedUserId = await getAuthenticatedUserId(req);
    if (!authenticatedUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const attempt = await getDailyPuzzleAttemptById(attemptId, authenticatedUserId);
    if (!attempt) {
      res.status(404).json({ error: 'Daily Puzzle attempt not found.' });
      return;
    }
    if (attempt.puzzleDate !== puzzleDate) {
      res.status(400).json({ error: 'Daily Puzzle run date does not match this attempt.' });
      return;
    }
    if (attempt.result.slots.length < 3) {
      res.status(409).json({ error: 'Daily Puzzle ladder is not complete yet.' });
      return;
    }
    let saved = attempt;
    let replayed = false;
    if (attempt.status === 'completed') {
      replayed = true;
    } else {
      saved = await persistDailyPuzzleAttempt({
        ...attempt,
        status: 'completed',
        completedAt: new Date().toISOString(),
        reviewUnlocked: true,
        updatedAt: new Date().toISOString(),
        result: {
          ...attempt.result,
          final: {
            puzzlesCompleted: attempt.puzzlesCompleted,
            totalScore: attempt.totalScore,
            masterChainScore: attempt.masterChainScore,
            completedAt: new Date().toISOString(),
          },
        },
      });
    }
    const leaderboard = await buildDailyPuzzleLeaderboardForDate(saved.puzzleDate);
    const leaderboardRank = leaderboard.find((entry) => entry.userId === authenticatedUserId)?.rank ?? null;
    if (!replayed) {
      void getDailyPuzzleLadderStreak(authenticatedUserId, saved.puzzleDate)
        .then((streak) => writePuzzleActivity({ userId: authenticatedUserId, score: saved.totalScore ?? null, streak }))
        .catch(() => {});
    }
    res.json({
      ok: true,
      runDate: saved.puzzleDate,
      attempt: saved,
      leaderboardRank,
      leaderboardPreview: leaderboard.slice(0, 10),
      replayed,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to complete Daily Puzzle ladder.',
    });
  }
});

app.get('/api/daily-puzzle/leaderboard', async (req, res) => {
  const runDate =
    typeof req.query.date === 'string' && req.query.date.trim()
      ? req.query.date.trim()
      : getPacificDateKey();
  try {
    const rows = await buildDailyPuzzleLeaderboardForDate(runDate);
    res.json({
      ok: true,
      runDate,
      rows,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load Daily Puzzle leaderboard.',
    });
  }
});

/**
 * Optional: schedule a platform cron (Vercel, GitHub Actions, etc.) to hit this route
 * shortly after Pacific midnight so the ladder exists before the first player.
 * Set DAILY_PUZZLE_CRON_SECRET and send it as Authorization: Bearer <secret>
 * or header x-daily-puzzle-cron-secret: <secret>.
 */
const handleDailyPuzzleLadderCronWarm: express.RequestHandler = async (_req, res) => {
  try {
    if (!isAuthorizedDailyPuzzleCronRequest(_req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
    const results: Array<{ runDate: string; outcome: 'skipped' | 'seeded' | 'failed' }> = [];
    for (const runDate of runDates) {
      const outcome = await ensureDailyPuzzleLadderForDate(runDate, { force: false });
      results.push({ runDate, outcome });
    }
    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Daily Puzzle ladder cron warm failed.',
    });
  }
};

app.get('/api/cron/daily-puzzle-ladder-warm', handleDailyPuzzleLadderCronWarm);
app.post('/api/cron/daily-puzzle-ladder-warm', handleDailyPuzzleLadderCronWarm);

app.get('/api/daily-fritz/today', async (req, res) => {
  const requestStartedAt = Date.now();
  const requestId = randomUUID().slice(0, 8);
  const isDevLike = process.env.NODE_ENV !== 'production';
  let initUserId: string | null = null;
  let initRunDate: string | null = null;
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
    initUserId = authenticatedUserId;
    initRunDate = runDate;
    console.log('[daily-fritz:init] request', { userId: authenticatedUserId, date: runDate });
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
      if (generated) {
        console.log('[daily-fritz:init] created-new', { userId: authenticatedUserId, date: runDate });
      }
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
    if (attempt) {
      console.log('[daily-fritz:init] loaded-existing', {
        userId: authenticatedUserId,
        date: runDate,
        phase: attempt.status,
      });
    }
    const attemptSetResult = attempt ? normalizeDailyFritzSetResult(attempt.result) : null;
    const needsCompletion = attempt?.status === 'started' && Boolean(attemptSetResult?.setWinner);
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
      current_game_number:
        attempt?.status === 'started' && !needsCompletion
          ? getCurrentDailyFritzGameNumber(attempt.result)
          : null,
      needs_completion: needsCompletion,
      streak,
      result: attempt?.status === 'completed' ? attempt.result : null,
      set_result: attemptSetResult,
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
    console.error('[daily-fritz:init] error', {
      userId: initUserId,
      date: initRunDate ?? getPacificDateKey(),
      error: error instanceof Error ? error.message : String(error),
    });
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
    console.log('[daily-fritz:init] request', { userId: authenticatedUserId, date: runDate });
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

    const currentSetResult = normalizeDailyFritzSetResult(attempt.result);
    const needsCompletion = Boolean(currentSetResult?.setWinner);
    const currentGameNumber = needsCompletion ? null : getCurrentDailyFritzGameNumber(attempt.result);
    const handDeal = getDailyFritzHandForGame(run, currentGameNumber ?? 1, attempt.currentHandIndex);
    res.json({
      ok: true,
      attempt_id: attempt.id,
      verified_match_id: verifiedMatchId,
      run_date: run.runDate,
      current_hand_index: attempt.currentHandIndex,
      current_game_number: currentGameNumber,
      needs_completion: needsCompletion,
      set_result: currentSetResult,
      fritz_tier: run.fritzTier,
      deal_size: run.dealSize,
      winning_score: run.winningScore,
      first_hand: handDeal,
    });
  } catch (error) {
    console.error('[daily-fritz:init] error', {
      userId: null,
      date: getPacificDateKey(),
      error: error instanceof Error ? error.message : String(error),
    });
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
  const rawGameNumber = req.body?.game_number;
  const requestedGameNumber =
    rawGameNumber == null ? null : normalizeDailyFritzSetGameNumber(Number(rawGameNumber));
  console.log('[daily-fritz-next-hand] request', {
    attemptId,
    runDateFromClient,
    rawGameNumber,
    completedHandIndex,
  });
  if (!attemptId || !verifiedMatchId || (rawGameNumber != null && !requestedGameNumber) || !Number.isInteger(completedHandIndex) || completedHandIndex < 0) {
    res.status(400).json({ error: 'attempt_id, verified_match_id, valid game_number, and completed_hand_index are required.' });
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
    const currentGameNumber = getCurrentDailyFritzGameNumber(attempt.result);
    const gameNumber = requestedGameNumber ?? currentGameNumber;
    console.log('[daily-fritz-next-hand] current game', {
      attemptId,
      requestedGameNumber,
      currentGameNumber,
      resolvedGameNumber: gameNumber,
      currentHandIndex: attempt.currentHandIndex,
    });
    if (gameNumber !== currentGameNumber) {
      res.status(409).json({ error: 'Daily Fritz game is no longer current.' });
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
      const hand = getDailyFritzHandForGame(run, gameNumber, currentHandIndex);
      console.log('[daily-fritz-next-hand] returning hand', {
        attemptId,
        gameNumber,
        currentHandIndex,
        replayed: Boolean(options.replayed),
        ignored: Boolean(options.ignored),
      });
      res.json({
        ok: true,
        run_date: run.runDate,
        game_number: gameNumber,
        current_game_number: gameNumber,
        set_result: attempt.result ?? null,
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
    console.warn('[daily-fritz-next-hand] error', {
      attemptId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to advance Daily Fritz hand.',
    });
  }
});

app.post('/api/daily-fritz/record-game', async (req, res) => {
  const attemptId = typeof req.body?.attempt_id === 'string' ? req.body.attempt_id.trim() : '';
  const verifiedMatchId =
    typeof req.body?.verified_match_id === 'string' ? req.body.verified_match_id.trim() : '';
  const runDateFromClient =
    typeof req.body?.run_date === 'string' ? req.body.run_date.trim() : '';
  const gameNumber = normalizeDailyFritzSetGameNumber(Number(req.body?.game_number));
  const playerScore = Number(req.body?.player_score);
  const fritzScore = Number(req.body?.fritz_score);
  const movesUsed = Number(req.body?.moves_used);
  const handsPlayed = Number(req.body?.hands_played);
  if (!attemptId || !verifiedMatchId || !gameNumber) {
    res.status(400).json({ error: 'attempt_id, verified_match_id, and game_number are required.' });
    return;
  }
  if (
    !Number.isFinite(playerScore) ||
    !Number.isFinite(fritzScore) ||
    !Number.isFinite(movesUsed) ||
    !Number.isFinite(handsPlayed)
  ) {
    res.status(400).json({ error: 'player_score, fritz_score, moves_used, and hands_played are required.' });
    return;
  }
  if (playerScore === fritzScore) {
    res.status(400).json({ error: 'Daily Fritz games cannot be recorded with tied scores.' });
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

    const currentSetResult = normalizeDailyFritzSetResult(attempt.result) ?? {
      version: 2,
      format: 'best_of_3' as const,
      playerGamesWon: 0,
      fritzGamesWon: 0,
      totalPointDiff: 0,
      games: [],
    };
    if (currentSetResult.setWinner) {
      res.status(409).json({ error: 'Daily Fritz set is already decided.' });
      return;
    }
    if (gameNumber !== currentSetResult.games.length + 1) {
      const existing = currentSetResult.games.find((game) => game.gameNumber === gameNumber);
      if (existing) {
        res.json({
          ok: true,
          replayed: true,
          set_result: currentSetResult,
          next_game_number: currentSetResult.setWinner ? null : Math.min(currentSetResult.games.length + 1, 3),
        });
        return;
      }
      res.status(409).json({ error: 'Daily Fritz game order is invalid.' });
      return;
    }

    const playerWon = playerScore > fritzScore;
    const gameResult: DailyFritzSetGameResult = {
      gameNumber,
      seed: getDailyFritzGameSeed(attempt.runDate, gameNumber),
      playerWon,
      playerScore: Math.round(playerScore),
      fritzScore: Math.round(fritzScore),
      pointDiff: Math.round(playerScore - fritzScore),
      movesUsed: Math.round(movesUsed),
      handsPlayed: Math.round(handsPlayed),
      completedAt: new Date().toISOString(),
    };
    const setResult = appendDailyFritzGameToSet(currentSetResult, gameResult);

    attempt.result = setResult as unknown as Record<string, unknown>;
    if (!setResult.setWinner) {
      attempt.currentHandIndex = 0;
    }
    const saved = await upsertDailyFritzAttempt(attempt);
    const savedSetResult = normalizeDailyFritzSetResult(saved.result);
    res.json({
      ok: true,
      set_result: savedSetResult ?? setResult,
      next_game_number: setResult.setWinner ? null : Math.min(setResult.games.length + 1, 3),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to record Daily Fritz game.',
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
  const submittedSetResult = normalizeDailyFritzSetResult(req.body?.set_result);

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

    const setResult = submittedSetResult ?? normalizeDailyFritzSetResult(attempt.result);
    if (setResult && !setResult.setWinner) {
      res.status(400).json({ error: 'Daily Fritz set is not complete.' });
      return;
    }
    const pointDiff = getDailyFritzSetPointDiff(setResult) ?? (finalScore - opponentScore);
    attempt.status = 'completed';
    attempt.completedAt = new Date().toISOString();
    attempt.completionHash = completionHash;
    attempt.finalScore = Math.round(finalScore);
    attempt.opponentScore = Math.round(opponentScore);
    attempt.pointDiff = Math.round(pointDiff);
    attempt.won = won;
    attempt.movesUsed = Math.round(movesUsed);
    attempt.handsPlayed = Math.round(handsPlayed);
    attempt.result = setResult
      ? {
          ...setResult,
          run_date: runDate,
          final_score: attempt.finalScore,
          opponent_score: attempt.opponentScore,
          point_diff: attempt.pointDiff,
          won,
          moves_used: attempt.movesUsed,
          hands_played: attempt.handsPlayed,
        }
      : {
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
    void writeDailyFritzActivity({
      userId: authenticatedUserId,
      finalScore: attempt.finalScore ?? null,
      won: attempt.won,
      games: setResult?.games.map((game) => ({
        gameNumber: game.gameNumber,
        playerWon: game.playerWon,
        playerScore: game.playerScore,
        fritzScore: game.fritzScore,
        ...(game.skunk ? { skunk: true } : {}),
        ...(game.skunkBy ? { skunkBy: game.skunkBy } : {}),
      })),
    }).catch(() => {});
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

function createGameOverPersistScheduler(input: GameOverPersistInput): () => void {
  const { room, cfg, aId, bId, a, b, scoreA, scoreB, winnerSeatId } = input;
  return () => {
    void (async () => {
      try {
        if (room.scheduledTournamentMatchId) {
          const winnerUserId =
            winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
          if (winnerUserId) {
            console.log('[tournament:game-over] detected', {
              roomCode: room.code,
              matchId: room.scheduledTournamentMatchId,
              tournamentId: room.scheduledTournamentId ?? null,
              winnerId: winnerUserId,
              scores: { player1: scoreA, player2: scoreB },
            });
            console.log('[tournament:game-over] applying result', {
              matchId: room.scheduledTournamentMatchId,
              winnerId: winnerUserId,
            });
            await applyTournamentMatchResult(io, {
              matchId: room.scheduledTournamentMatchId,
              winnerId: winnerUserId,
              player1Score: scoreA,
              player2Score: scoreB,
            });
          }
          return;
        }

        if (getPendingFritzMatchContext(room)) {
          await resolvePendingFritzMatch(room.code);
        }

        await appendMatch({
          endedAtMs: Date.now(),
          roomCode: room.code,
          tournamentId: typeof cfg.tournamentId === 'string' ? cfg.tournamentId : undefined,
          tournamentMatchId: typeof cfg.tournamentMatchId === 'string' ? cfg.tournamentMatchId : undefined,
          maxDeficitWinner: (() => {
            const t = room.leadTracker;
            if (!t) return 0;
            if (winnerSeatId === aId) return t.maxLeadB ?? 0;
            if (winnerSeatId === bId) return t.maxLeadA ?? 0;
            return 0;
          })(),
          a: { seatId: a.id, userId: a.userId, username: a.username },
          b: { seatId: b.id, userId: b.userId, username: b.username },
          scoreA,
          scoreB,
          winnerSeatId,
          pointDiff: Math.abs(scoreA - scoreB),
        });

        const fritzActivityCtx = getPendingFritzMatchContext(room);
        const winnerRoster = winnerSeatId === aId ? a : b;
        const loserRoster = winnerSeatId === aId ? b : a;
        const activityDisplayName = (p: typeof a) =>
          fritzActivityCtx && typeof p.id === 'string' && p.id.startsWith('bot:fritz:')
            ? formatFritzActivityOpponentLabel(fritzActivityCtx.fritzTier)
            : p.username;

        void writeMatchActivity({
          winnerUserId: winnerSeatId === aId ? a.userId : b.userId,
          loserUserId: winnerSeatId === aId ? b.userId : a.userId,
          winnerUsername: activityDisplayName(winnerRoster),
          loserUsername: activityDisplayName(loserRoster),
          mode: fritzActivityCtx ? 'bot' : 'online',
          winnerScore: winnerSeatId === aId ? scoreA : scoreB,
          loserScore: winnerSeatId === aId ? scoreB : scoreA,
        }).catch(() => {});

        if (a.userId && b.userId && !fritzActivityCtx) {
          const winnerUserId = winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
          const loserUserId = winnerSeatId === a.id ? b.userId : winnerSeatId === a.id ? a.userId : null;
          if (winnerUserId && loserUserId) {
            void recordPublicOnlineMatch({
              roomCode: room.code,
              roomMatchId: room.matchId,
              winnerUserId,
              loserUserId,
              winnerScore: winnerSeatId === a.id ? scoreA : scoreB,
              loserScore: winnerSeatId === a.id ? scoreB : scoreA,
            });
          }
        }

        const rankingParticipants = [
          { me: a, opp: b, myScore: scoreA, oppScore: scoreB },
          { me: b, opp: a, myScore: scoreB, oppScore: scoreA },
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
                    played_at: new Date().toISOString(),
                  }),
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
                  matchId: room.matchId,
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
              const ratingResult = await processRealtimeMultiplayerGame({
                playerAProfile,
                playerBProfile,
                playerAGame,
                playerBGame,
              });
              console.log('[Ranking] Real-time update complete', {
                playerA: a.userId,
                playerB: b.userId,
              });

              if (room.matchmakingMatchId) {
                const winnerUserId =
                  winnerSeatId === a.id ? a.userId : winnerSeatId === b.id ? b.userId : null;
                void recordMatchEnd({
                  matchId: room.matchmakingMatchId,
                  status: 'completed',
                  winnerId: winnerUserId,
                  playerARatingChange: ratingResult?.playerA?.delta ?? null,
                  playerBRatingChange: ratingResult?.playerB?.delta ?? null,
                  isSim: false,
                });
              }
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
  };
}

function notifyRoomPlayersInGame(roomCode: string): void {
  const room = getRoom(roomCode);
  for (const seatId of room.players) {
    const connectionId = getSocketForSeat(roomCode, seatId);
    if (!connectionId) continue;
    const pSocket = io.sockets.sockets.get(connectionId);
    const playerId = normalizeUserId(pSocket?.data?.userId);
    if (playerId) {
      void upsertPresence(playerId, 'in_game', roomCode).catch(() => {});
      emitPresenceUpdateToFriends(playerId, 'in_game');
    }
  }
}

async function onAfterMatchStarted(room: Room): Promise<void> {
  if (getPendingFritzMatchContext(room)) {
    await insertPendingFritzMatch(room);
  }
}

initRoomSession(io, {
  persistRoomMatchLog,
  onGameOver: createGameOverPersistScheduler,
  finalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
  resolveSocketIdentity,
  normalizeUsername,
  normalizeUserId,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
  onAfterMatchStarted,
  notifyRoomPlayersInGame,
  maybeFinalizeTournamentMatch: (room) => finalizeTournamentMatchHook?.(room),
});

io.on('connection', (socket: Socket) => {
  console.log(`[socket.io] client connected id=${socket.id} transport=${socket.conn.transport.name}`);
  socket.conn.on('upgrade', (transport) => {
    console.log(`[socket.io] transport upgraded id=${socket.id} -> ${transport.name}`);
  });

  /* Matchmaking queue handlers — additive, does not modify private-match flow. */
  registerMatchmakingHandlers(io, socket, (code) => broadcastStateUpdate(code));

  /* Scheduled tournament handlers + scheduler bootstrap (idempotent). */
  initScheduledTournaments(io, app, socket);

  /* ROOM_REACTIONS_CHAT_EMOTE */
  registerRoomSessionHandlers(io, socket);
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
      void upsertPresence(userId, 'online').catch(() => {});
      emitPresenceUpdateToFriends(userId, 'online');
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
    (
      payload: {
        toUserId: string;
        fromUsername: string;
        fromUserId?: string;
        roomCode: string;
        inviteUrl: string;
        inviteId?: string;
        matchSummary?: string;
      },
      cb?: AckFn,
    ) => {
      const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
      try {
        getRoom(roomCode);
      } catch {
        console.log(`[friend:invite] ERROR room_not_found code=${roomCode} from=${socket.id}`);
        socket.emit('friend:invite:error', { ok: false, error: 'room_not_found' });
        cb?.({ ok: false, error: 'room_not_found' });
        return;
      }
      const toUserId = normalizeUserId(payload?.toUserId);
      if (!toUserId) {
        cb?.({ ok: false, error: 'invalid_target' });
        return;
      }
      const targetSockets = socketsByUserId.get(toUserId);
      if (!targetSockets || targetSockets.size === 0) {
        cb?.({ ok: false, error: 'recipient_unreachable' });
        return;
      }
      const fromUserId =
        normalizeUserId(payload?.fromUserId) ??
        normalizeUserId(socket.data?.userId as string | undefined);
      const inviteId = String(payload?.inviteId ?? `${Date.now()}-${roomCode}`).slice(0, 80);
      const matchSummary = String(payload?.matchSummary ?? '7-Tile · First to 60 · Untimed').slice(0, 120);
      for (const socketId of targetSockets) {
        io.to(socketId).emit('friend:invited', {
          inviteId,
          fromUsername: normalizeUsername(payload?.fromUsername),
          fromUserId,
          roomCode,
          inviteUrl: String(payload?.inviteUrl ?? ''),
          matchSummary,
        });
      }
      cb?.({ ok: true, delivered: true, inviteId });
    },
  );

  socket.on(
    'friend:invite:decline',
    (payload: { toUserId?: string; roomCode?: string; inviteId?: string }) => {
      const challengerUserId = normalizeUserId(payload?.toUserId);
      if (!challengerUserId) return;
      const challengerSockets = socketsByUserId.get(challengerUserId);
      if (!challengerSockets) return;
      const fromUsername = normalizeUsername(socket.data?.username as string | undefined);
      const roomCode = String(payload?.roomCode ?? '').trim().toUpperCase();
      const inviteId = String(payload?.inviteId ?? '').slice(0, 80);
      for (const socketId of challengerSockets) {
        io.to(socketId).emit('friend:invite:declined', {
          inviteId: inviteId || undefined,
          fromUsername,
          roomCode: roomCode || undefined,
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
  const ENABLE_LEGACY_TOURNAMENTS = process.env.ENABLE_LEGACY_TOURNAMENTS === '1';
  if (ENABLE_LEGACY_TOURNAMENTS) {
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
    const seatA = allocatePlayerSeatId();
    const seatB = allocatePlayerSeatId();
    const room = createRoom(seatA, {
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
    joinRoom(room.code, seatB);
    joinSocketToRoom(m.a, room.code, ['tourn:']);
    joinSocketToRoom(m.b, room.code, ['tourn:']);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: seatA, socketId: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: seatB, socketId: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    setRoomRoster(room.code, roomPlayers);
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

    // Deal is broadcast after both seated clients emit player:ready (see player:ready handler).
    emitTournament(t);

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
    if (t.activeMatchId && t.activeMatchId !== mid) {
      console.warn('[tournament] ignoring stale gameOver for non-active match', {
        tournamentId: tid,
        activeMatchId: t.activeMatchId,
        reportedMatchId: mid,
      });
      return;
    }

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
  }



  socket.on('disconnect', () => {
    removeSocketPresence();
    const userId = normalizeUserId(socket.data?.userId);
    if (isUuidLike(userId)) {
      void upsertPresence(userId as string, 'offline').catch(() => {});
      emitPresenceUpdateToFriends(userId as string, 'offline');
    }
    const { wasActiveRoomPlayer, roomCode } = handleRoomPlayerDisconnect(io, socket);
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
function notifyClientsOfProcessShutdown(signal: string): void {
  try {
    console.warn(`[server] ${signal} — notifying sockets before exit`);
    io.emit('server:shutdown', { reason: 'server_restart', signal });
  } catch {
    /* ignore */
  }
}
process.once('SIGTERM', () => notifyClientsOfProcessShutdown('SIGTERM'));
process.once('SIGINT', () => notifyClientsOfProcessShutdown('SIGINT'));

const PORT = Number.parseInt(process.env.PORT ?? '3001', 10) || 3001;

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  bootstrapScheduledTournamentInfrastructure(io, app);
  const serverUrl = process.env.SERVER_URL?.trim();
  if (serverUrl) {
    const pingUrl = `${serverUrl.replace(/\/$/, '')}/ping`;
    setInterval(() => {
      void fetch(pingUrl).catch((err) => console.log('Ping failed:', err));
    }, 10 * 60 * 1000);
  }
  startRankingCron();
  scheduleDailyFritzWarmup();
  scheduleDailyPuzzleLadderWarmup();
  // Optional startup warmups (off unless ENABLE_STARTUP_*_WARMUP=true). Puzzle ladder seeding
  // runs heavy Tactical Setup generation on the single Node event loop and can starve HTTP.
  const STARTUP_DAILY_WARMUP_DELAY_MS = 12_000;
  const startupWarmupDates = [getPacificDateKeyDaysFromNow(0), getPacificDateKeyDaysFromNow(1)];
  setTimeout(() => {
    if (isStartupDailyFritzWarmupEnabled()) {
      void warmDailyFritzRuns('startup', startupWarmupDates).catch((err) => {
        console.warn('[daily-fritz-warmup] startup failed', err instanceof Error ? err.message : err);
      });
    } else {
      console.log('[daily-fritz-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_FRITZ_WARMUP=true to enable',
      });
    }
    if (isStartupDailyPuzzleWarmupEnabled()) {
      void warmDailyPuzzleLadders('startup', startupWarmupDates).catch((err) => {
        console.warn(
          '[daily-puzzle-ladder-warmup] startup failed',
          err instanceof Error ? err.message : err,
        );
      });
    } else {
      console.log('[daily-puzzle-ladder-warmup] skipped on startup', {
        hint: 'Set ENABLE_STARTUP_PUZZLE_WARMUP=true to enable',
      });
    }
  }, STARTUP_DAILY_WARMUP_DELAY_MS);
});
