import * as Sentry from '@sentry/node';
import { childLogger } from '../../logger';
import type express from 'express';
import type { Server } from 'socket.io';

const log = childLogger('health');
import { isGracefulShutdownInProgress } from '../gracefulShutdown';
import { supabaseFetch } from '../../supabaseUtils';
import { resolveReleaseVersion } from './releaseVersion';
import {
  assessDailyPuzzleGenerationHealth,
  type DailyPuzzleGenerationHealthSnapshot,
} from './dailyPuzzleGenerationHealth';
import { gameCoreReadyReport } from '../gameCoreConsistency';

const READY_REQUIRED_ENV_VARS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'] as const;
const READY_RECOMMENDED_ENV_VARS = [
  'ADMIN_SECRET',
  'CLIENT_URL',
  'CORS_ALLOWED_ORIGINS',
  'DAILY_PUZZLE_CRON_SECRET',
  'SERVER_URL',
] as const;

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
  getFurthestPublishedDailyPuzzleDate: () => Promise<string | null>;
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
    getFurthestPublishedDailyPuzzleDate,
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
      release: resolveReleaseVersion(),
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
      release: resolveReleaseVersion(),
      nodeEnv: process.env.NODE_ENV ?? 'development',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.get('/ping', (_, res) => {
    res.json({ status: 'ok', release: resolveReleaseVersion() });
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
      release: resolveReleaseVersion(),
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
    let dailyPuzzleGeneration: DailyPuzzleGenerationHealthSnapshot;
    try {
      const furthestPublishedDate = requiredEnvOk ? await getFurthestPublishedDailyPuzzleDate() : null;
      dailyPuzzleGeneration = assessDailyPuzzleGenerationHealth(todayPt, furthestPublishedDate);
      if (dailyPuzzleGeneration.shouldAlert && requiredEnvOk) {
        log.error({
          todayPt,
          furthestPublishedDate: dailyPuzzleGeneration.furthestPublishedDate,
          requiredThroughDate: dailyPuzzleGeneration.requiredThroughDate,
          lookaheadDays: dailyPuzzleGeneration.lookaheadDays,
        }, 'daily-puzzle generation pipeline is behind');
        // The trace (§CQ9.1.6.4) found the old log.error-only alert was effectively
        // unwatched — nothing scrapes /ready logs. Surface it where it will be seen.
        Sentry.captureException(
          new Error(dailyPuzzleGeneration.alertReason ?? 'daily-puzzle generation pipeline is behind'),
        );
      }
    } catch (error) {
      dailyPuzzleGeneration = {
        ok: false,
        furthestPublishedDate: null,
        requiredThroughDate: '',
        lookaheadDays: null,
        shouldAlert: true,
        alertReason: error instanceof Error ? error.message : String(error),
      };
      log.error(getProcessErrorLogPayload(error), 'daily-puzzle generation health probe failed');
    }

    const shuttingDown = isGracefulShutdownInProgress();
    // `dailyPuzzleGeneration` is intentionally NOT in this gate (§CQ9.1.6.4): it
    // tracks a background content pipeline for a mode that reads a separate table
    // (`puzzle_pool`), not this server's ability to serve traffic. A stalled cron
    // must not 503 /ready. It stays in `checks` below for visibility + alerting.
    const ok = !shuttingDown && requiredEnvOk && supabase.ok
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
        dailyPuzzleGeneration,
      },
      gameCore: gameCoreReadyReport(),
    });
  });
}
