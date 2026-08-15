import * as Sentry from '@sentry/node';
import { childLogger } from '../../logger';
import type express from 'express';
import type { Server } from 'socket.io';

const log = childLogger('health');
import { isGracefulShutdownInProgress } from '../gracefulShutdown';
import { supabaseFetch } from '../../supabaseUtils';
import {
  assessDailyPuzzleLadderReadiness,
  isPastLadderReadinessGracePt,
} from '../../dailyPuzzleLadderReadiness';
import { DAILY_PUZZLE_SLOT_INDICES, type DailyPuzzleSlot } from '../../dailyPuzzle';

const READY_REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'] as const;
const READY_RECOMMENDED_ENV_VARS = [
  'ADMIN_SECRET',
  'CLIENT_URL',
  'CORS_ALLOWED_ORIGINS',
  'DAILY_PUZZLE_CRON_SECRET',
  'SERVER_URL',
] as const;

function getReleaseVersion(): string {
  return (
    process.env.RELEASE_VERSION?.trim() ||
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.npm_package_version?.trim() ||
    'dev'
  );
}

function getEnvPresence(names: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(names.map((name) => [name, Boolean(process.env[name]?.trim())]));
}

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

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

async function getSupabaseReadiness(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  try {
    await supabaseFetch('/rest/v1/profiles?select=id&limit=1', {
      method: 'GET',
      timeoutMs: 3_000,
      headers: { Prefer: 'return=minimal' },
    });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    log.error(getProcessErrorLogPayload(error), 'supabase readiness check failed');
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: getSafeErrorMessage(error),
    };
  }
}

export type HealthRouteDeps = {
  app: express.Application;
  io: Server;
  getRoomRuntimeStats: () => { roomCount: number; gamesInProgress: number };
  getPacificDateKey: (date?: Date) => string;
  listDailyPuzzleSlotsForDate: (runDate: string) => Promise<DailyPuzzleSlot[]>;
  getRoomMatchLogsPersistenceAvailability: () => boolean | null;
  probeRoomMatchLogsTable: () => Promise<boolean>;
  isRoomMatchLogsPersistenceAvailable: () => boolean;
  getDailyFritzEventsPersistenceAvailability: () => boolean | null;
  probeDailyFritzEventsPersistence: () => Promise<boolean>;
  isDailyFritzTransactionalAuthorityEnabled: () => boolean;
  getDailyFritzAuthoritySchemaAvailability: () => boolean | null;
  probeDailyFritzAuthoritySchema: () => Promise<boolean>;
};

export function registerHealthRoutes(deps: HealthRouteDeps): void {
  const {
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
  } = deps;

  const getRuntimeStatusPayload = () => {
    const { roomCount, gamesInProgress } = getRoomRuntimeStats();
    return {
      ok: true,
      release: getReleaseVersion(),
      nodeEnv: process.env.NODE_ENV ?? 'development',
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      connectedSockets: io.sockets.sockets.size,
      roomCount,
      gamesInProgress,
    };
  };

  app.get('/health', (_, res) => {
    res.json({
      ok: true,
      release: getReleaseVersion(),
      nodeEnv: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/ping', (_, res) => {
    res.json({ status: 'ok', release: getReleaseVersion() });
  });

  app.get('/healthz', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const db = await getSupabaseReadiness();
    if (!db.ok) {
      Sentry.captureException(new Error(`/healthz DB probe failed: ${db.error ?? 'unknown'}`));
      res.status(503).json({ status: 'degraded', db: 'error', error: db.error ?? 'db probe failed' });
      return;
    }
    res.status(200).json({
      status: 'ok',
      db: 'ok',
      release: getReleaseVersion(),
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get('/ready', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    const requiredEnv = getEnvPresence(READY_REQUIRED_ENV_VARS);
    const recommendedEnv = getEnvPresence(READY_RECOMMENDED_ENV_VARS);
    const requiredEnvOk = Object.values(requiredEnv).every(Boolean);
    const supabase = requiredEnvOk
      ? await getSupabaseReadiness()
      : { ok: false, latencyMs: 0, error: 'missing_required_env' };
    const roomMatchLogs =
      requiredEnvOk && supabase.ok
        ? await (async () => {
            if (getRoomMatchLogsPersistenceAvailability() !== true) {
              await probeRoomMatchLogsTable();
            }
            const available = isRoomMatchLogsPersistenceAvailable();
            return { ok: available, available };
          })()
        : { ok: false, available: false };
    const dailyFritzEvents =
      requiredEnvOk && supabase.ok
        ? await (async () => {
            if (getDailyFritzEventsPersistenceAvailability() !== true) {
              await probeDailyFritzEventsPersistence();
            }
            const available = getDailyFritzEventsPersistenceAvailability() === true;
            return { ok: available, available };
          })()
        : { ok: false, available: false };
    const dailyFritzAuthority =
      requiredEnvOk && supabase.ok
        ? await (async () => {
            const enabled = isDailyFritzTransactionalAuthorityEnabled();
            if (enabled && getDailyFritzAuthoritySchemaAvailability() !== true) {
              await probeDailyFritzAuthoritySchema();
            }
            const available = !enabled || getDailyFritzAuthoritySchemaAvailability() === true;
            return { ok: available, available, enabled };
          })()
        : { ok: false, available: false, enabled: isDailyFritzTransactionalAuthorityEnabled() };

    const todayPt = getPacificDateKey();
    let dailyPuzzleLadder: ReturnType<typeof assessDailyPuzzleLadderReadiness> & { ok: boolean };
    try {
      const slots = requiredEnvOk ? await listDailyPuzzleSlotsForDate(todayPt) : [];
      const readiness = assessDailyPuzzleLadderReadiness(todayPt, slots);
      dailyPuzzleLadder = {
        ...readiness,
        ok: readiness.ready || !readiness.shouldAlert,
      };
      if (readiness.shouldAlert) {
        log.error({
          runDate: todayPt,
          publishedSlotCount: readiness.publishedSlotCount,
          missingSlotIndexes: readiness.missingSlotIndexes,
          alertReason: readiness.alertReason,
        }, 'daily-puzzle-ladder readiness alert');
      }
    } catch (error) {
      dailyPuzzleLadder = {
        runDate: todayPt,
        ready: false,
        publishedSlotCount: 0,
        missingSlotIndexes: [...DAILY_PUZZLE_SLOT_INDICES],
        legacySinglePuzzleDay: true,
        shouldAlert: isPastLadderReadinessGracePt(todayPt),
        alertReason: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }

    const shuttingDown = isGracefulShutdownInProgress();
    const ok = !shuttingDown && requiredEnvOk && supabase.ok && dailyPuzzleLadder.ok
      && dailyFritzEvents.ok && dailyFritzAuthority.ok;

    res.status(ok ? 200 : 503).json({
      ...getRuntimeStatusPayload(),
      ok,
      shuttingDown,
      checks: {
        requiredEnv,
        recommendedEnv,
        supabase,
        roomMatchLogs,
        dailyFritzEvents,
        dailyFritzAuthority,
        dailyPuzzleLadder,
      },
    });
  });
}
