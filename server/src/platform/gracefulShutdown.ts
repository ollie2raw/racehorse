import type { Server as HttpServer } from 'node:http';
import type { Server as SocketServer } from 'socket.io';
import { childLogger } from '../logger';
import {
  flushAllPendingLiveSessions,
  setLiveRoomPersistenceShuttingDown,
  type FlushAllPendingLiveSessionsResult,
} from '../multiplayer/roomLivePersistence';

export const DEFAULT_SHUTDOWN_SIGNAL_FLUSH_TIMEOUT_MS = 10_000;

const log = childLogger('platform:shutdown');

let gracefulShutdownInProgress = false;
let gracefulShutdownPromise: Promise<void> | null = null;

export type GracefulShutdownDeps = {
  server: HttpServer;
  io: SocketServer;
  flushLiveSessions?: (options: { timeoutMs: number }) => Promise<FlushAllPendingLiveSessionsResult>;
  exitProcess?: (code: number) => void;
  shutdownFlushTimeoutMs?: number;
  /**
   * Stop new background orchestration and let the operation in flight finish
   * (the tournament orchestrator: drain, then release its lease only if it
   * finished in time). Runs first, alongside nothing else.
   */
  drainOrchestration?: (options: { timeoutMs: number }) => Promise<unknown>;
};

export function isGracefulShutdownInProgress(): boolean {
  return gracefulShutdownInProgress;
}

export function resetGracefulShutdownStateForTests(): void {
  gracefulShutdownInProgress = false;
  gracefulShutdownPromise = null;
}

/**
 * SIGTERM/SIGINT lifecycle:
 * notify clients → stop accepting new HTTP work → flush live sessions → close sockets → exit.
 */
export async function runGracefulShutdown(
  signal: string,
  deps: GracefulShutdownDeps,
): Promise<void> {
  if (gracefulShutdownPromise) return gracefulShutdownPromise;

  gracefulShutdownPromise = (async () => {
    if (gracefulShutdownInProgress) return;
    gracefulShutdownInProgress = true;
    setLiveRoomPersistenceShuttingDown(true);

    const timeoutMs = deps.shutdownFlushTimeoutMs ?? DEFAULT_SHUTDOWN_SIGNAL_FLUSH_TIMEOUT_MS;
    const flushLiveSessions =
      deps.flushLiveSessions ??
      ((options) => flushAllPendingLiveSessions({ timeoutMs: options.timeoutMs }));
    const exitProcess = deps.exitProcess ?? ((code) => process.exit(code));

    try {
      console.warn(`[server] ${signal} — beginning graceful shutdown`);
      try {
        deps.io.emit('server:shutdown', { reason: 'server_restart', signal });
      } catch {
        /* ignore */
      }

      if (deps.drainOrchestration) {
        try {
          const drained = await deps.drainOrchestration({ timeoutMs });
          log.warn({ drained }, 'orchestration drained');
        } catch (err) {
          log.error({ err }, 'orchestration drain failed');
        }
      }

      // Stop accepting connections now, but don't wait for close()'s callback
      // here: it fires only once every connection has ended, and socket.io's
      // websockets stay open until io.close() below. Waiting first hung the
      // shutdown with clients still attached (Phase 4A dev finding: the old
      // process kept serving tournament rooms, turn clocks included, after it
      // had released the orchestrator lease to the new one).
      const httpClosed = new Promise<void>((resolve) => {
        deps.server.close(() => resolve());
      });
      console.warn('[server] HTTP listener closed — no longer accepting new connections');

      const flushResult = await flushLiveSessions({ timeoutMs });
      console.warn('[server] live session flush complete', {
        flushedRoomCount: flushResult.flushedRoomCodes.length,
        timedOut: flushResult.timedOut,
      });

      await new Promise<void>((resolve) => {
        deps.io.close(() => resolve());
      });
      console.warn('[server] socket server closed');

      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        httpClosed,
        new Promise<void>((resolve) => { closeTimer = setTimeout(resolve, timeoutMs); }),
      ]);
      if (closeTimer) clearTimeout(closeTimer);

      exitProcess(0);
    } catch (error) {
      console.error('[server] graceful shutdown failed', error);
      exitProcess(1);
    }
  })();

  return gracefulShutdownPromise;
}

export function registerGracefulShutdownHandlers(deps: GracefulShutdownDeps): void {
  const onSignal = (signal: NodeJS.Signals) => {
    void runGracefulShutdown(signal, deps);
  };

  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
}