import * as Sentry from '@sentry/node';
import { config } from './config';

Sentry.init({
  dsn: config.sentryDsn || undefined,
  enabled: config.isProd && Boolean(config.sentryDsn),
  environment: config.nodeEnv,
  release: config.renderGitCommit ?? config.packageVersion,
  tracesSampleRate: 0.2,
});
import fs from 'node:fs';
import express from 'express';
import cors, { type CorsOptions } from 'cors';
import http from 'http';
import { createHash, randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import {
  getGhostProfileSummary,
  getGhostProfileSummaryByUsername,
} from './ghost/service';
import { assignPlayerToLeague } from './league/service';
import { generateLeagueFixtures } from './league/schedule';
import {
  recordLeagueAsyncResult,
  recordLeagueFixtureResult,
  openLeagueFixtureLiveRoom,
} from './league/results';
import { runLeagueForfeitJob } from './league/forfeit';
import { runLeagueSundayRollover } from './league/rollover';
import { getLeagueStateForPlayer } from './league/state';
import { getLeagueHistoryForPlayer } from './league/history';

import { computeWeeklyAwards } from "./stats/matchLog";
import { computeOnlineCurrentWinStreak } from './stats/onlineWinStreak';
import { recordUserMatch } from './stats/recordUserMatch';
import { socialRouter } from './social/routes';
import { registerFriendInviteHandlers } from './social/registerFriendInviteHandlers';
import {
  emitPresenceUpdateToFriends,
  registerPresenceHandlers,
} from './social/registerPresenceHandlers';
import { upsertPresence } from './social/presence';
import {
  writeMatchActivity,
  writePuzzleActivity,
  writeDailyFritzActivity,
  writeDailyFritzGameActivity,
  writeForfeitActivity,
} from './social/activityWriter';
import { supabaseFetch } from './supabaseUtils';
import {
  buildDailyFritzCompletionHash,
  generateDailyFritzRun,
  generateSingleDailyFritzGameHand,
  getDailyFritzDrawTiles,
  getDailyFritzDrawWinner,
  getDailyFritzGameSeed,
  getDailyFritzSeed,
  resolveDailyFritzDrawTiles,
  resolveDailyFritzDrawWinner,
  sortDailyFritzLeaderboard,
  type DailyFritzAttemptStatus,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
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
  findLadderSlotsForAttemptSet,
  findReadyDailyPuzzleLadderSlots,
  isDailyPuzzleAttemptFinalizeReady,
  isDailyPuzzleLadderReady,
  resolveActiveSlotForAttempt,
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
import { validateDailyPuzzleSubmission } from './dailyPuzzleSubmissionValidation';

import { scrubPartialPublishedLadderForDate } from './dailyPuzzleLadderPublish';
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
  isFritzId,
} from './ranking/glicko2';
import { startRankingCron } from './ranking/cron';
import {
  scheduleDailyFritzWarmup,
  scheduleDailyPuzzleLadderWarmup,
  scheduleStartupDailyWarmups,
} from './scheduled/dailyWarmup';
import { getLeaderboard, processRatingPeriod } from './ranking/periodService';

import {
  startGame,
  act,
  nextHand,
  readyForNextHand,
  getRoom,
  deleteRoom,
  getRoomLegalMoves,
  getRoomCanDraw,
  getRoomMatchEventMeta,
  getRoomRuntimeStats,
  type DrawAnimationStep,
  type Room,
} from './rooms';
import { appendRoomEvent, resetRoomEventLog } from './roomEvents';
import { registerMatchmakingHandlers } from './matchmaking';
import {
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
} from './matchmaking/roomShellHydration';
import {
  bootstrapScheduledTournamentInfrastructure,
  initScheduledTournaments,
} from './scheduledTournament';
import { createGameOverPersistScheduler } from './realtime/gameOverPersistence';
import {
  clearDisconnectGrace,
  onActivePlayerSocketDisconnect,
  onPlayerSocketRejoined,
} from './multiplayer/disconnectGrace';
import { registerLegacyTournamentHandlers } from './legacyTournament/registerLegacyTournamentHandlers';
import {
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
  type AckFn,
  type RoomJoinConfig,
  type RoomPlayer,
} from './multiplayer/roomSession';
import {
  getRoomMatchLogsPersistenceAvailability,
  isRoomMatchLogsPersistenceAvailable,
  persistRoomMatchLog,
  probeRoomMatchLogsTable,
  queryLatestPersistedRoomMatchLogByRoomCode,
  queryPersistedRoomMatchLog,
} from './multiplayer/roomMatchLogPersistence';
import {
  handleRoomPlayerDisconnect,
  registerRoomSessionHandlers,
} from './multiplayer/registerRoomSessionHandlers';
import { registerRoomChatEmoteHandlers } from './multiplayer/registerRoomChatEmoteHandlers';
import { markMatchStartReady, tryStartMatchIfReady } from './multiplayer/matchStartReady';
import type { BranchArm, GameState } from './game/types';
import { assertValidGameState } from './game/invariants';
import {
  InMemoryRateLimiter,
  createRateLimitMiddleware,
  socketRateLimitKey,
  failedRoomLookupLimiter,
  type RateLimitRule,
} from './rateLimit';
import { registerHealthRoutes } from './platform/health/registerHealthRoutes';
import {
  isGracefulShutdownInProgress,
  registerGracefulShutdownHandlers,
} from './platform/gracefulShutdown';
import { constantTimeEqualSecret, isAdminSecret } from './platform/auth/adminSecret';
import {
  getAuthenticatedUserId,
  getAuthenticatedUserIdFromToken,
  getUserIdFromAuthHeaderSync,
} from './platform/auth/supabaseAuth';
import { getPacificDateKey } from './shared/pacificDate';
import {
  abandonVerifiedSinglePlayerMatch,
  buildGhostCompletionHash,
  getVerifiedSinglePlayerMatch,
  isSafeGhostMoveLog,
  persistVerifiedSinglePlayerMatch,
  startVerifiedSinglePlayerMatch,
} from './shared/verifiedSinglePlayerMatch';
import {
  finalizeFritzForfeit,
  formatFritzActivityOpponentLabel,
  getFritzIdentityForTier,
  getPendingFritzMatchContext,
  insertPendingFritzMatch,
  parseOptionalActivityScore,
  readFritzForfeitScoresFromRoom,
} from './shared/fritzMatchLifecycle';
import {
  buildDailyFritzLeaderboard,
  createDailyFritzAttempt,
  getCurrentDailyFritzGameNumber,
  getDailyFritzAttempt,
  getDailyFritzAttemptById,
  getDailyFritzHandForGame,
  getDailyFritzRun,
  getDailyFritzRunSummary,
  getDailyFritzSetPointDiff,
  getDailyFritzStreak,
  normalizeDailyFritzSetGameNumber,
  normalizeDailyFritzSetResult,
  normalizeDailyFritzTier,
  upsertDailyFritzAttempt,
  upsertDailyFritzRun,
} from './http/stores/dailyFritzStore';
import {
  buildDailyPuzzleLeaderboardForDate,
  createDailyPuzzleAttempt,
  createDailyPuzzleSlotResult,
  getDailyPuzzleAttempt,
  getDailyPuzzleAttemptById,
  getDailyPuzzleLadderStreak,
  getUsernameForUserId,
  handleDailyPuzzleLadderCronWarm,
  listDailyPuzzleSlotsForAttempt,
  listDailyPuzzleSlotsForDate,
  listDailyPuzzleSlotsForDateWithAutoSeed,
  persistDailyPuzzleAttempt,
} from './http/stores/dailyPuzzleStore';
import { registerStatsRoutes } from './http/routes/stats';
import { registerRankingRoutes } from './http/routes/ranking';
import { registerGhostRoutes } from './http/routes/ghost';
import { registerLeagueRoutes } from './http/routes/league';
import { registerBotMatchesRoutes } from './http/routes/botMatches';
import { registerDailyPuzzleRoutes } from './http/routes/dailyPuzzle';
import { registerDailyFritzRoutes } from './http/routes/dailyFritz';
import { registerRoomEventsRoutes } from './http/routes/roomEvents';
import {
  listCompletedDailyFritzDatesForUser,
  listCompletedDailyPuzzleLadderDatesForUser,
  listCompletedLegacyDailyPuzzleDatesForUser,
} from './http/stores/homeCompletionDates';

/** Production custom domain — always allowed even when CLIENT_URL still points at Vercel. */
const canonicalProductionClientOrigins = [
  'https://playracehorse.com',
  'https://www.playracehorse.com',
];

const allowedOriginPatterns = [
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https:\/\/racehorsedoms\.vercel\.app$/i,
  /^https:\/\/playracehorse\.com$/i,
  /^https:\/\/www\.playracehorse\.com$/i,
  /^https:\/\/.*\.vercel\.app$/i,
];

const configuredCorsOrigins = config.corsAllowedOrigins
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Public web app URL (e.g. Vercel). Set on Render so CORS matches your deployed client. */
const CLIENT_DEPLOY_URL = config.clientUrl || undefined;

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (canonicalProductionClientOrigins.includes(origin)) return true;
  if (CLIENT_DEPLOY_URL && origin === CLIENT_DEPLOY_URL) return true;
  if (configuredCorsOrigins.includes(origin)) return true;
  return allowedOriginPatterns.some((pattern) => pattern.test(origin));
};

/** Exact origins always tried before pattern-based `isAllowedOrigin` (Socket.IO + docs clarity). */
const socketIoExplicitOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...canonicalProductionClientOrigins,
  ...(CLIENT_DEPLOY_URL ? [CLIENT_DEPLOY_URL] : []),
  ...configuredCorsOrigins,
];
const uniqueSocketIoExplicitOrigins = [...new Set(socketIoExplicitOrigins)];

const reflectCorsOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean | string) => void,
): void => {
  if (isAllowedOrigin(origin)) {
    callback(null, origin ?? true);
    return;
  }
  callback(null, false);
};

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    reflectCorsOrigin(origin, callback);
  },
  credentials: true,
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

const restRateLimiter = new InMemoryRateLimiter({ windowMs: 5 * 60_000, max: 600 });
const socketRateLimiter = new InMemoryRateLimiter({ windowMs: 60_000, max: 600 });
const restApiLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 5 * 60_000, max: 600 }, 'rest:api');
const dailySubmitLimit = createRateLimitMiddleware(
  restRateLimiter,
  { windowMs: 5 * 60_000, max: 90 },
  'rest:daily',
  getUserIdFromAuthHeaderSync,
);
const adminLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 10 * 60_000, max: 20 }, 'rest:admin');
const cronLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 10 * 60_000, max: 20 }, 'rest:cron');

app.use('/api/cron', cronLimit);
app.use('/api/daily-puzzle/submit-slot', dailySubmitLimit);
app.use('/api/daily-puzzle/complete', dailySubmitLimit);
app.use('/api/daily-fritz/next-hand', dailySubmitLimit);
app.use('/api/daily-fritz/record-game', dailySubmitLimit);
app.use('/api/daily-fritz/complete', dailySubmitLimit);
app.use('/api/daily-fritz/generate', adminLimit);
app.use('/api/daily-fritz/invalidate', adminLimit);
app.use('/api/daily-fritz/reset-attempt', adminLimit);
app.use('/api/ranking/process', adminLimit);
app.use('/league/run-forfeits', adminLimit);
app.use('/league/run-rollover', adminLimit);
app.use('/bot-matches/cleanup-stale', adminLimit);
app.use('/api', restApiLimit);
app.use('/league', restApiLimit);
app.use('/bot-matches', restApiLimit);
app.use('/api/social', socialRouter);
app.use('/api/profile', socialRouter);

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

function getProcessErrorLogPayload(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: typeof error === 'string' ? error : JSON.stringify(error) };
}

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
        callback(null, origin);
        return;
      }
      reflectCorsOrigin(origin, callback);
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

io.use((socket, next) => {
  if (isGracefulShutdownInProgress()) {
    next(new Error('server_shutting_down'));
    return;
  }
  next();
});

const socketsByUserId = new Map<string, Set<string>>();
registerStatsRoutes(app, {
  io,
  getRoomRuntimeStats,
  ROOM_CLEANUP_GRACE_MS,
  getPacificDateKey,
  getAuthenticatedUserId,
  buildHomeDailySummary,
  createHomeDailyCompletionMap,
  listCompletedDailyFritzDatesForUser,
  listCompletedDailyPuzzleLadderDatesForUser,
  listCompletedLegacyDailyPuzzleDatesForUser,
  recordUserMatch,
});

registerRankingRoutes(app, {
  supabaseFetch,
  getAuthenticatedUserId,
  isAdminSecret,
  getLeaderboard,
  processRatingPeriod,
  computeOnlineCurrentWinStreak,
  isFritzId,
  DEFAULT_RATING,
  DEFAULT_RD,
});

registerGhostRoutes(app, {
  getAuthenticatedUserId,
  isFritzId,
  getVerifiedSinglePlayerMatch,
  persistVerifiedSinglePlayerMatch,
  startVerifiedSinglePlayerMatch,
  isSafeGhostMoveLog,
  buildGhostCompletionHash,
  writeMatchActivity,
  formatFritzActivityOpponentLabel,
  supabaseFetch,
});

registerLeagueRoutes(app, {
  getAuthenticatedUserId,
  supabaseFetch,
  isAdminSecret,
  socketsByUserId,
});

registerBotMatchesRoutes(app, {
  getAuthenticatedUserId,
  getAuthenticatedUserIdFromToken,
  supabaseFetch,
  isAdminSecret,
  startVerifiedSinglePlayerMatch,
  abandonVerifiedSinglePlayerMatch,
  getFritzIdentityForTier,
  finalizeFritzForfeit,
  parseOptionalActivityScore,
});

registerDailyPuzzleRoutes(app);
registerDailyFritzRoutes(app);

registerRoomEventsRoutes(app, {
  getAuthenticatedUserId,
  queryPersistedRoomMatchLog,
  queryLatestPersistedRoomMatchLogByRoomCode,
  isRoomMatchLogsPersistenceAvailable,
});


const SOCKET_EVENT_LIMITS: Record<string, RateLimitRule> = {
  'room:create': { windowMs: 60_000, max: config.limitRoomCreateMax },
  'room:join': { windowMs: 60_000, max: config.limitRoomJoinMax },
  'room:spectate': { windowMs: 60_000, max: config.limitRoomSpectateMax },
  'queue:join': { windowMs: 60_000, max: config.limitQueueJoinMax },
  'friend:invite': { windowMs: 60_000, max: config.limitFriendInviteMax },
  'friend:invite:decline': { windowMs: 60_000, max: config.limitFriendDeclineMax },
  'room:chat:send': { windowMs: 60_000, max: config.limitRoomChatMax },
  'room:emote:send': { windowMs: 60_000, max: config.limitRoomEmoteMax },
  'game:action': { windowMs: 60_000, max: config.limitGameActionMax },
  'hand:ready': { windowMs: 60_000, max: config.limitHandReadyMax },
  'player:ready': { windowMs: 60_000, max: config.limitPlayerReadyMax },
};
const DEFAULT_SOCKET_EVENT_LIMIT: RateLimitRule = { windowMs: 60_000, max: config.limitDefaultMax };

function installSocketRateLimit(socket: Socket): void {
  socket.use((packet, next) => {
    const eventName = typeof packet[0] === 'string' ? packet[0] : 'unknown';

    // Protect room:join and room:spectate from brute-force scans
    if (eventName === 'room:join' || eventName === 'room:spectate') {
      const rateLimitKey = socketRateLimitKey(socket);
      const failedLookupsKey = `failed_lookups:${rateLimitKey}`;
      const checkResult = failedRoomLookupLimiter.check(failedLookupsKey);
      if (!checkResult.allowed) {
        const ack = packet.find((arg): arg is AckFn => typeof arg === 'function');
        ack?.({ ok: false, error: 'rate_limited', retryAfterMs: checkResult.retryAfterMs });
        socket.emit('rate_limited', { event: eventName, retryAfterMs: checkResult.retryAfterMs });
        next(new Error('rate_limited'));
        return;
      }
    }

    const rule = SOCKET_EVENT_LIMITS[eventName] ?? DEFAULT_SOCKET_EVENT_LIMIT;
    const result = socketRateLimiter.take(`socket:${eventName}:${socketRateLimitKey(socket)}`, rule);
    if (result.allowed) {
      next();
      return;
    }
    const ack = packet.find((arg): arg is AckFn => typeof arg === 'function');
    ack?.({ ok: false, error: 'rate_limited', retryAfterMs: result.retryAfterMs });
    socket.emit('rate_limited', { event: eventName, retryAfterMs: result.retryAfterMs });
    next(new Error('rate_limited'));
  });
}

let finalizeTournamentMatchHook: ((room: any) => void) | null = null;


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

function notifyRoomPlayersInGame(roomCode: string): void {
  const room = getRoom(roomCode);
  for (const seatId of room.players) {
    const connectionId = getSocketForSeat(roomCode, seatId);
    if (!connectionId) continue;
    const pSocket = io.sockets.sockets.get(connectionId);
    const playerId = normalizeUserId(pSocket?.data?.userId);
    if (playerId) {
      void upsertPresence(playerId, 'in_game', roomCode).catch(() => {});
      emitPresenceUpdateToFriends({ io, socketsByUserId }, playerId, 'in_game');
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
  onGameOver: createGameOverPersistScheduler(io),
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
  installSocketRateLimit(socket);

  /* Matchmaking queue handlers — additive, does not modify private-match flow. */
  registerMatchmakingHandlers(io, socket, (code) => broadcastStateUpdate(code));

  /* Scheduled tournament handlers + scheduler bootstrap (idempotent). */
  initScheduledTournaments(io, app, socket);

  /* ROOM_REACTIONS_CHAT_EMOTE */
  registerRoomSessionHandlers(io, socket);
  const { handlePresenceDisconnect } = registerPresenceHandlers(socket, {
    io,
    socketsByUserId,
    resolveSocketIdentity,
    normalizeUserId,
    isUuidLike,
  });

  registerFriendInviteHandlers(io, socket, socketsByUserId, {
    normalizeUserId,
    normalizeUsername,
    isAuthenticatedUserId: isUuidLike,
  });

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

  registerRoomChatEmoteHandlers(socket);

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
  const ENABLE_LEGACY_TOURNAMENTS = config.enableLegacyTournaments;
  if (ENABLE_LEGACY_TOURNAMENTS) {
    finalizeTournamentMatchHook = registerLegacyTournamentHandlers(socket, {
      io,
      normalizeUsername,
      normalizeUserId,
    });
  }



  socket.on('disconnect', () => {
    handlePresenceDisconnect();
    const userId = normalizeUserId(socket.data?.userId);
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
          const scores = roomCode ? readFritzForfeitScoresFromRoom(roomCode, verifiedUserId) : null;
          await finalizeFritzForfeit({
            userId: verifiedUserId,
            fritzTier: pending.fritz_tier,
            source: { roomCode },
            youScore: scores?.youScore ?? null,
            botScore: scores?.botScore ?? null,
          });
        } catch (error) {
          console.error('[Fritz] disconnect loss handling failed:', error);
        }
      })();
    }
    console.log('Client disconnected:', socket.id);
  });
});
registerGracefulShutdownHandlers({ server, io });
process.on('unhandledRejection', (reason) => {
  Sentry.captureException(reason);
  console.error('[process] unhandledRejection', getProcessErrorLogPayload(reason));
});
process.on('uncaughtException', (error) => {
  Sentry.captureException(error);
  console.error('[process] uncaughtException', getProcessErrorLogPayload(error));
});

const PORT = config.port;

Sentry.setupExpressErrorHandler(app);

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[server] Port ${PORT} is already in use. Another process is already listening there, likely an existing Racehorse server instance.`,
    );
    console.error(
      `[server] Stop the existing process with "lsof -nP -iTCP:${PORT} -sTCP:LISTEN" and "kill <PID>", or run this server on another port with "PORT=${PORT + 1} npm run dev".`,
    );
    process.exit(1);
  }

  console.error('[server] Failed to start server:', error);
  process.exit(1);
});

registerHealthRoutes({
  app,
  io,
  getRoomRuntimeStats,
  getPacificDateKey,
  listDailyPuzzleSlotsForDate,
  getRoomMatchLogsPersistenceAvailability,
  probeRoomMatchLogsTable,
  isRoomMatchLogsPersistenceAvailable,
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  bootstrapScheduledTournamentInfrastructure(io, app);
  void probeRoomMatchLogsTable()
    .then((ok) => {
      console.log('[room-match-logs] startup probe', {
        tableAvailable: ok,
        persistenceEnabled: isRoomMatchLogsPersistenceAvailable(),
      });
    })
    .catch((err) => {
      console.warn('[room-match-logs] startup probe error', err instanceof Error ? err.message : err);
    });
  const serverUrl = config.serverUrl;
  if (serverUrl) {
    const pingUrl = `${serverUrl.replace(/\/$/, '')}/ping`;
    setInterval(() => {
      void fetch(pingUrl).catch((err) => console.log('Ping failed:', err));
    }, 10 * 60 * 1000);
  }
  startRankingCron();
  scheduleDailyFritzWarmup();
  scheduleDailyPuzzleLadderWarmup();
  scheduleStartupDailyWarmups();
});
