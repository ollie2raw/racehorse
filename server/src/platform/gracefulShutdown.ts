import type { Server as HttpServer } from 'node:http';
import type { Server as SocketServer } from 'socket.io';
import {
  flushAllPendingLiveSessions,
  setLiveRoomPersistenceShuttingDown,
  type FlushAllPendingLiveSessionsResult,
} from '../multiplayer/roomLivePersistence';

export const DEFAULT_SHUTDOWN_SIGNAL_FLUSH_TIMEOUT_MS = 10_000;

let gracefulShutdownInProgress = false;
let gracefulShutdownPromise: Promise<void> | null = null;

export type GracefulShutdownDeps = {
  server: HttpServer;
  io: SocketServer;
  flushLiveSessions?: (options: { timeoutMs: number }) => Promise<FlushAllPendingLiveSessionsResult>;
  exitProcess?: (code: number) => void;
  shutdownFlushTimeoutMs?: number;
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

      await new Promise<void>((resolve, reject) => {
        deps.server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
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