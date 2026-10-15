import { listRoomCodes } from '../rooms';
import type { Server as HttpServer } from 'node:http';
import type { Server as SocketServer } from 'socket.io';
import { childLogger } from '../logger';
import {
  flushAllPendingLiveSessions, setLiveRoomPersistenceShuttingDown,
  getPendingLiveRoomPersistenceRoomCodes,
  type FlushAllPendingLiveSessionsResult,
} from '../multiplayer/roomLivePersistence';
import { activeProcessWork, closeProcessAdmission, drainProcessWork, isProcessClosing, resetProcessLifecycleForTests } from './processLifecycle';

// Leave headroom inside the platform's termination grace. One total budget,
// including hung socket close and custom drains, rather than one per phase.
export const DEFAULT_SHUTDOWN_SIGNAL_FLUSH_TIMEOUT_MS = 25_000;
const log = childLogger('platform:shutdown');
let gracefulShutdownPromise: Promise<void> | null = null;
export type GracefulShutdownDeps = {
  server: HttpServer;
  io: SocketServer;
  flushLiveSessions?: (options: { timeoutMs: number }) => Promise<FlushAllPendingLiveSessionsResult>;
  exitProcess?: (code: number) => void;
  shutdownFlushTimeoutMs?: number;
  drainOrchestration?: (options: { timeoutMs: number }) => Promise<unknown>;
};
export const isGracefulShutdownInProgress = isProcessClosing;
export function resetGracefulShutdownStateForTests(): void {
  gracefulShutdownPromise = null;
  resetProcessLifecycleForTests();
}

export function runGracefulShutdown(signal: string, deps: GracefulShutdownDeps): Promise<void> {
  if (gracefulShutdownPromise) return gracefulShutdownPromise;
  // Synchronous admission closure precedes the first await and notification.
  closeProcessAdmission();
  setLiveRoomPersistenceShuttingDown(true);
  gracefulShutdownPromise = (async () => {
    const started = Date.now();
    const budget = deps.shutdownFlushTimeoutMs ?? DEFAULT_SHUTDOWN_SIGNAL_FLUSH_TIMEOUT_MS;
    const remaining = () => Math.max(0, budget - (Date.now() - started));
    const timedOut: string[] = [];
    const completed: string[] = [];
    const activeAtStart = activeProcessWork();
    const dirtyAtStart = getPendingLiveRoomPersistenceRoomCodes().length;
    let failed = false;
    const bounded = async (name: string, task: () => Promise<unknown>, ms = remaining()) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const ok = await Promise.race([
          Promise.resolve().then(task).then(() => true),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
        ]);
        (ok ? completed : timedOut).push(name);
      } catch (err) { failed = true; log.error({ err, phase: name }, 'shutdown drain failed'); }
      finally { if (timer) clearTimeout(timer); }
    };
    try {
      deps.io.emit('server:shutdown', { reason: 'server_restart', signal });
      // Do not await connections here: websockets close only after the flush.
      const httpClosed = new Promise<void>((resolve) => deps.server.close(() => resolve()));
      await bounded('work', async () => {
        if (deps.drainOrchestration) await deps.drainOrchestration({ timeoutMs: remaining() });
        await drainProcessWork();
      }, Math.max(0, remaining() - Math.min(5_000, budget / 3)));
      // All admitted room mutations must finish BEFORE taking this final snapshot.
      await bounded('rooms', async () => {
        const result = await (deps.flushLiveSessions ?? flushAllPendingLiveSessions)({ timeoutMs: remaining() });
        if (result.timedOut) timedOut.push('room-persistence');
        if (result.failedRoomCodes?.length) { failed = true; log.error({ count: result.failedRoomCodes.length }, 'shutdown room persistence failed'); }
      });
      await bounded('sockets', () => new Promise<void>((resolve) => deps.io.close(() => resolve())));
      deps.server.closeAllConnections?.();
      await bounded('http', () => httpClosed);
    } catch (err) { failed = true; log.error({ err }, 'shutdown failed'); }
    const code = failed || timedOut.length ? 1 : 0;
    log.warn({ signal, admissionClosed: true, socketsActive: deps.io.engine?.clientsCount ?? 0,
      roomsActive: listRoomCodes().length, dirtyAtStart, activeAtStart, activeAtExit: activeProcessWork(), completed, timedOut,
      durationMs: Date.now() - started, outcome: code ? 'incomplete' : 'drained' }, 'process shutdown summary');
    (deps.exitProcess ?? ((exitCode) => process.exit(exitCode)))(code);
  })();
  return gracefulShutdownPromise;
}

export function registerGracefulShutdownHandlers(deps: GracefulShutdownDeps): void {
  // Keep handlers installed: a second SIGTERM must not invoke Node's default
  // immediate exit in the middle of the first signal's persistence drain.
  const onSignal = (signal: NodeJS.Signals) => { void runGracefulShutdown(signal, deps); };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}
