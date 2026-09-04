import * as Sentry from '@sentry/node';
import { config } from './config';
import { sentryBeforeSend } from './sentryScrubbers';

Sentry.init({
  dsn: config.sentryDsn || undefined,
  enabled: config.isProd && Boolean(config.sentryDsn),
  environment: config.nodeEnv,
  release: config.renderGitCommit ?? config.packageVersion,
  tracesSampleRate: 0.2,
  beforeSend: sentryBeforeSend,
});
import fs from 'node:fs';
import express from 'express';
import compression from 'compression';
import cors, { type CorsOptions } from 'cors';
import http from 'http';
import { createHash, randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { registerSpectatorHandlersIfEnabled } from './spectator/spectatorIntegration';
import {
  getGhostProfileSummary,
  getGhostProfileSummaryByUsername,
} from './ghost/service';

import { computeWeeklyAwards } from "./stats/matchLog";
import { computeOnlineCurrentWinStreak } from './stats/onlineWinStreak';
import { recordUserMatch } from './stats/recordUserMatch';
import { socialRouter } from './social/routes';
import { accountRouter } from './account/routes';
import { socketsByUserId as presenceSocketsByUserId, setActivity } from './social/presenceRegistry';
import { registerFriendInviteHandlers } from './social/registerFriendInviteHandlers';
import {
  emitPresenceUpdateToFriends,
  registerPresenceHandlers,
} from './social/registerPresenceHandlers';
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
import { buildApiHealthPayload } from './platform/health/apiHealthPayload';
import {
  scheduleDailyFritzWarmup,
  scheduleStartupDailyWarmups,
} from './scheduled/dailyWarmup';
import { scheduleStrandedDailyFritzRecovery } from './dailyFritzStrandedRecovery';
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
import { abortMatchmakingMatchAndRequeue, registerMatchmakingHandlers } from './matchmaking';
import {
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
} from './matchmaking/roomShellHydration';
import { startMatchmakingReservationSweeper } from './matchmaking/reservedRoomCleanup';
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
  isRoomCommandReceiptsPersistenceAvailable,
  probeRoomCommandReceiptsTable,
} from './multiplayer/roomCommandReceiptStore';
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
import { TRUSTED_PROXY } from './trustedProxy';
import { registerHealthRoutes } from './platform/health/registerHealthRoutes';
import { registerE2eInspectRoutes } from './http/routes/e2eInspectRoute';
import {
  isGracefulShutdownInProgress,
  registerGracefulShutdownHandlers,
} from './platform/gracefulShutdown';
import { constantTimeEqualSecret, isAdminSecret } from './platform/auth/adminSecret';
import {
  getAuthenticatedUserId,
  getAuthenticatedUserIdFromToken,
} from './platform/auth/supabaseAuth';
import { getPacificDateKey } from './shared/pacificDate';
import { childLogger } from './logger';
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
  listDailyPuzzleSlotsForAttempt,
  listDailyPuzzleSlotsForDate,
  listDailyPuzzleSlotsForDateWithAutoSeed,
  persistDailyPuzzleAttempt,
} from './http/stores/dailyPuzzleStore';
import { registerStatsRoutes } from './http/routes/stats';
import { registerRankingRoutes } from './http/routes/ranking';
import { registerGhostRoutes } from './http/routes/ghost';
import { registerBotMatchesRoutes } from './http/routes/botMatches';
import { registerPuzzleRushRoutes } from './http/routes/puzzleRush';
import { registerDailyFritzRoutes } from './http/routes/dailyFritz';
import {
  getDailyFritzEventsPersistenceAvailability,
  probeDailyFritzEventsPersistence,
} from './http/stores/dailyFritzEventStore';
import {
  getDailyFritzAuthoritySchemaAvailability,
  probeDailyFritzAuthoritySchema,
} from './http/stores/dailyFritzAuthorityReadiness';
import { isDailyFritzTransactionalAuthorityEnabled } from './dailyFritzAuthorityFeature';
import { registerRoomEventsRoutes } from './http/routes/roomEvents';
import {
  queryRankedGameForMatch,
  registerPrivateMatchResultRoutes,
} from './http/routes/privateMatchResult';
import type { BotMatchPendingRow } from './supabaseTypes';
import {
  listCompletedDailyFritzDatesForUser,
  listCompletedDailyPuzzleLadderDatesForUser,
  listCompletedLegacyDailyPuzzleDatesForUser,
  listCompletedPuzzleRushDatesForUser,
} from './http/stores/homeCompletionDates';

/** Production custom domain — always allowed even when CLIENT_URL still points at Vercel. */
const log = childLogger('server');

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
// AU-3 (HARDENING_PLAN §6.3), corrected 2026-09-04. Render fronts this app with
// its platform Cloudflare AND an internal load balancer — the real chain is two
// hops (`X-Forwarded-For` = `<client>, <cloudflare>, <render-internal>`), not
// one. `trust proxy: 1` was one hop short: `req.ip` resolved to a shared
// Render-internal `10.x` address and distinct clients collided onto ~2
// rate-limit keys (cross-user false 429s, confirmed in prod logs). `TRUSTED_PROXY`
// is range-based (Cloudflare + private ranges), so `req.ip` resolves to the
// real client regardless of the exact hop count; `requestIp()` additionally
// prefers the Cloudflare-verified `CF-Connecting-IP`.
app.set('trust proxy', TRUSTED_PROXY);
app.use(cors(corsOptions));
/**
 * gzip every JSON response above the default 1 KB threshold.
 *
 * The API had no compression at all, and it serves some very repetitive JSON —
 * the ghost composite log compresses by roughly 20x. Socket.IO is attached to
 * the raw HTTP server below and intercepts /socket.io/ before Express sees it,
 * so this never touches the realtime transport; the server has no SSE or
 * streaming routes for it to interfere with either.
 */
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// Security headers — applied to every response from this API server.
// This server only serves JSON — so CSP locks down everything except connect-src
// for Supabase and Sentry. The client HTML CSP lives in client/public/_headers.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      `connect-src 'self' ${config.supabaseUrl ?? ''} https://*.sentry.io https://*.ingest.sentry.io`,
    ].join('; '),
  );
  // Only set HSTS in production to avoid breaking local dev with HTTPS redirects.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const restRateLimiter = new InMemoryRateLimiter({ windowMs: 5 * 60_000, max: 600 });
const socketRateLimiter = new InMemoryRateLimiter({ windowMs: 60_000, max: 600 });
const restApiLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 5 * 60_000, max: 600 }, 'rest:api');
// AU-4 (HARDENING_PLAN §6.3): these limits were keyed on `getUserIdFromAuthHeaderSync`,
// which decoded the JWT `sub` WITHOUT verifying the signature — so a forged
// `{"sub":"<random>"}` gave an unlimited supply of fresh per-user buckets.
// Now keyed on `req.ip` (trustworthy since AU-3's `trust proxy`). The budgets
// are generous enough that users sharing one NAT/egress IP are unaffected.
const dailySubmitLimit = createRateLimitMiddleware(
  restRateLimiter,
  { windowMs: 5 * 60_000, max: 90 },
  'rest:daily',
);
const adminLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 10 * 60_000, max: 20 }, 'rest:admin');
// Account deletion is irreversible. A handful of attempts is a user correcting a
// typed confirmation; more than that is not a person. (Keyed on `req.ip` — AU-4.)
const accountDeleteLimit = createRateLimitMiddleware(
  restRateLimiter,
  { windowMs: 10 * 60_000, max: 10 },
  'rest:account-delete',
);
const cronLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 10 * 60_000, max: 20 }, 'rest:cron');
// Leaderboard queries are read-heavy and trigger unbounded DB scans — give them their own budget
// so a single poller can't exhaust the global restApiLimit for all other /api/* callers.
const leaderboardLimit = createRateLimitMiddleware(restRateLimiter, { windowMs: 60_000, max: 30 }, 'rest:leaderboard');

app.use('/api/cron', cronLimit);
app.use('/api/daily-fritz/leaderboard', leaderboardLimit);
app.use('/api/ranking/leaderboard', leaderboardLimit);
// record-match triggers rating computation — tighter budget than the generic REST limit
const recordMatchLimit = createRateLimitMiddleware(
  restRateLimiter,
  { windowMs: 5 * 60_000, max: 20 },
  'rest:record-match',
);
app.use('/api/stats/record-match', recordMatchLimit);
// Tighter budget on Daily Fritz init paths — 20 req/60s prevents polling abuse. (Keyed on `req.ip` — AU-4.)
const dailyFritzInitLimit = createRateLimitMiddleware(
  restRateLimiter,
  { windowMs: 60_000, max: 20 },
  'rest:daily-fritz-init',
);
app.use('/api/daily-fritz/today', dailyFritzInitLimit);
app.use('/api/daily-fritz/start', dailyFritzInitLimit);
app.use('/api/daily-fritz/next-hand', dailySubmitLimit);
app.use('/api/daily-fritz/record-game', dailySubmitLimit);
app.use('/api/daily-fritz/complete', dailySubmitLimit);
app.use('/api/daily-fritz/generate', adminLimit);
app.use('/api/daily-fritz/invalidate', adminLimit);
app.use('/api/daily-fritz/reset-attempt', adminLimit);
app.use('/api/daily-fritz/metrics', adminLimit);
app.use('/api/daily-fritz/health', adminLimit);
app.use('/api/daily-fritz/events', adminLimit);
app.use('/api/ranking/process', adminLimit);
app.use('/bot-matches/cleanup-stale', adminLimit);
app.use('/api', restApiLimit);
app.use('/bot-matches', restApiLimit);
app.use('/api/account', accountDeleteLimit);
app.use('/api/account', accountRouter);
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

// Presence lives in social/presenceRegistry so the HTTP routes and the socket
// handlers answer from one structure instead of two that can disagree.
const socketsByUserId = presenceSocketsByUserId;

app.get('/api/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(buildApiHealthPayload());
});

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
  listCompletedPuzzleRushDatesForUser,
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

registerPuzzleRushRoutes(app);
registerDailyFritzRoutes(app);

registerRoomEventsRoutes(app, {
  getAuthenticatedUserId,
  queryPersistedRoomMatchLog,
  queryLatestPersistedRoomMatchLogByRoomCode,
  isRoomMatchLogsPersistenceAvailable,
});

registerPrivateMatchResultRoutes(app, {
  getAuthenticatedUserId,
  queryPersistedRoomMatchLog,
  queryLatestPersistedRoomMatchLogByRoomCode,
  isRoomMatchLogsPersistenceAvailable,
  queryRankedGameForMatch,
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
      setActivity(playerId, 'in_game', roomCode);
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
  resolveSocketIdentity,
  normalizeUsername,
  normalizeUserId,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
  abortMatchmakingMatchOnStartFailure: (roomCode, reason) => {
    abortMatchmakingMatchAndRequeue(roomCode, reason);
  },
  onAfterMatchStarted,
  notifyRoomPlayersInGame,
});

io.on('connection', (socket: Socket) => {
  log.info({ socketId: socket.id, transport: socket.conn.transport.name }, 'client connected');
  socket.conn.on('upgrade', (transport) => {
    log.debug({ socketId: socket.id, transport: transport.name }, 'transport upgraded');
  });
  installSocketRateLimit(socket);
  registerSpectatorHandlersIfEnabled(io, socket);

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
  socket.on("stats:weekly", async (cb?: AckFn) => {
    try {
      const awards = await computeWeeklyAwards(Date.now());
      cb?.({ ok: true, awards });
    } catch {
      cb?.({ ok: false, error: "stats_failed" });
    }
  });


  log.debug({ socketId: socket.id }, 'socket handlers registered');



  socket.on('disconnect', () => {
    handlePresenceDisconnect();
    const userId = normalizeUserId(socket.data?.userId);
    const { wasActiveRoomPlayer, roomCode } = handleRoomPlayerDisconnect(io, socket);
    if (isUuidLike(userId) && roomCode && wasActiveRoomPlayer) {
      const verifiedUserId = userId as string;
      void (async () => {
        let fritzTier: string | null = null;
        try {
          const pendingRows = await supabaseFetch<BotMatchPendingRow[]>(
            `/rest/v1/bot_match_pending?select=id,fritz_tier&room_code=eq.${roomCode}&user_id=eq.${verifiedUserId}&resolved=eq.false&order=started_at.asc,id.asc&limit=1`,
          );
          const pending = pendingRows?.[0];
          if (!pending?.id) return;

          fritzTier = pending.fritz_tier ?? null;
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
            verifiedScores: scores,
          });
        } catch (error) {
          console.error('[Fritz] disconnect loss handling failed:', error);
          Sentry.withScope((scope) => {
            scope.setTag('subsystem', 'fritz_disconnect');
            scope.setContext('fritz_disconnect', { userId: verifiedUserId, roomCode, fritzTier });
            Sentry.captureException(error);
          });
        }
      })();
    }
    log.info({ socketId: socket.id }, 'client disconnected');
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

registerE2eInspectRoutes(app);

registerHealthRoutes({
  app,
  io,
  getRoomRuntimeStats,
  getPacificDateKey,
  listDailyPuzzleSlotsForDate,
  getRoomMatchLogsPersistenceAvailability,
  probeRoomMatchLogsTable,
  isRoomMatchLogsPersistenceAvailable,
  getDailyFritzEventsPersistenceAvailability,
  probeDailyFritzEventsPersistence,
  isDailyFritzTransactionalAuthorityEnabled,
  getDailyFritzAuthoritySchemaAvailability,
  probeDailyFritzAuthoritySchema,
});

server.listen(PORT, () => {
  log.info({ port: PORT }, 'server listening');
  bootstrapScheduledTournamentInfrastructure(io, app);
  void probeRoomMatchLogsTable()
    .then((ok) => {
      log.info({ tableAvailable: ok, persistenceEnabled: isRoomMatchLogsPersistenceAvailable() }, 'room-match-logs startup probe');
    })
    .catch((err) => {
      log.warn({ err }, 'room-match-logs startup probe error');
    });
  void probeRoomCommandReceiptsTable()
    .then((ok) => {
      log.info({ tableAvailable: ok, persistenceEnabled: isRoomCommandReceiptsPersistenceAvailable() }, 'room-command-receipts startup probe');
    })
    .catch((err) => {
      log.warn({ err }, 'room-command-receipts startup probe error');
    });
  void probeDailyFritzEventsPersistence()
    .then((ok) => {
      log.info({ tableAvailable: ok }, 'daily-fritz-events startup probe');
    })
    .catch((err) => {
      log.warn({ err }, 'daily-fritz-events startup probe error');
    });
  void probeDailyFritzAuthoritySchema()
    .then((ok) => {
      log.info({ enabled: isDailyFritzTransactionalAuthorityEnabled(), schemaAvailable: ok }, 'daily-fritz-authority startup probe');
    })
    .catch((err) => {
      log.warn({ err }, 'daily-fritz-authority startup probe error');
    });
  const serverUrl = config.serverUrl;
  if (serverUrl) {
    const pingUrl = `${serverUrl.replace(/\/$/, '')}/ping`;
    setInterval(() => {
      void fetch(pingUrl).catch((err) => log.warn({ err }, 'ping failed'));
    }, 10 * 60 * 1000);
  }
  startMatchmakingReservationSweeper();
  startRankingCron();
  scheduleDailyFritzWarmup();
  scheduleStartupDailyWarmups();
  scheduleStrandedDailyFritzRecovery();
});
