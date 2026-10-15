import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { activeProcessWork, beginProcessWork, closeProcessAdmission, drainProcessWork, isProcessClosing, onProcessStop, processAdmissionMiddleware, processInterval, processTimeout, resetProcessLifecycleForTests, trackProcessWork, trackSocketHandlers } from './processLifecycle';
import { resetGracefulShutdownStateForTests, runGracefulShutdown } from './gracefulShutdown';
const barrier = () => { let release!: () => void; const promise = new Promise<void>((r) => { release = r; }); return { promise, release }; };
const flush = () => Promise.resolve({ flushedRoomCodes: [], awaitedInFlightRoomCodes: [], timedOut: false });
function deps() {
  return { server: { close: (cb: () => void) => cb(), closeAllConnections: vi.fn() } as any,
    io: { emit: vi.fn(), close: (cb: () => void) => cb() } as any, flushLiveSessions: vi.fn(flush), exitProcess: vi.fn(), shutdownFlushTimeoutMs: 1000 };
}
beforeEach(() => { resetGracefulShutdownStateForTests(); vi.useFakeTimers(); });
afterEach(() => { resetProcessLifecycleForTests(); vi.useRealTimers(); });

describe('process lifecycle barriers', () => {
  it('zero-work SIGTERM closes admission and exits once', async () => {
    const d = deps(); await runGracefulShutdown('SIGTERM', d);
    expect(isProcessClosing()).toBe(true); expect(d.exitProcess).toHaveBeenCalledExactlyOnceWith(0);
  });
  it('repeated SIGTERM/SIGINT share the drain', async () => {
    const b = barrier(); const d = deps(); const end = beginProcessWork('mutation');
    const first = runGracefulShutdown('SIGTERM', d); const second = runGracefulShutdown('SIGINT', d);
    expect(first).toBe(second); expect(d.exitProcess).not.toHaveBeenCalled(); b.release(); end(); await first;
    expect(d.exitProcess).toHaveBeenCalledTimes(1);
  });
  it.each(['ranking-catchup', 'daily-fritz-recovery', 'reservation-retry', 'room-cleanup', 'committed-response'])('drains active %s before final snapshot', async (name) => {
    const b = barrier(); const d = deps(); const task = trackProcessWork(name, () => b.promise);
    const done = runGracefulShutdown('SIGTERM', d);
    await Promise.resolve(); expect(d.flushLiveSessions).not.toHaveBeenCalled();
    b.release(); await task; await done;
    expect(d.flushLiveSessions).toHaveBeenCalledTimes(1); expect(d.exitProcess).toHaveBeenCalledWith(0);
  });
  it('counts an async continuation between database calls', async () => {
    const b = barrier(); let committed = false;
    const task = trackProcessWork('completion', async () => { await b.promise; await Promise.resolve(); committed = true; });
    closeProcessAdmission(); let drained = false; const drain = drainProcessWork().then(() => { drained = true; });
    expect(drained).toBe(false); b.release(); await task; await drain; expect(committed).toBe(true);
  });
  it('does not run queued or recurring maintenance after admission closes', async () => {
    const run = vi.fn(); processTimeout('boot', run, 20); processInterval('periodic', run, 10);
    closeProcessAdmission(); await vi.advanceTimersByTimeAsync(100); expect(run).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('prevents a recursively rescheduled warmup after closure', async () => {
    const b = barrier(); const again = vi.fn();
    processTimeout('warmup', async () => { await b.promise; processTimeout('next', again, 10); }, 1);
    await vi.advanceTimersByTimeAsync(1); closeProcessAdmission(); b.release(); await drainProcessWork();
    await vi.advanceTimersByTimeAsync(30); expect(again).not.toHaveBeenCalled();
  });
  it('bounds a hung work drain and socket close under one total deadline', async () => {
    const d = deps(); const end = beginProcessWork('hung-db'); d.io.close = vi.fn();
    const done = runGracefulShutdown('SIGTERM', d); await vi.advanceTimersByTimeAsync(1000); await done;
    expect(d.exitProcess).toHaveBeenCalledExactlyOnceWith(1); end();
  });
  it('bounds a hung orchestration drain', async () => {
    const d = { ...deps(), drainOrchestration: () => new Promise(() => {}) };
    const done = runGracefulShutdown('SIGTERM', d); await vi.advanceTimersByTimeAsync(1000); await done; expect(d.exitProcess).toHaveBeenCalledWith(1);
  });
  it('does not report successful shutdown for failed final snapshot', async () => {
    const d = deps(); d.flushLiveSessions = vi.fn(async () => ({ ...await flush(), failedRoomCodes: ['DIRTY'] }));
    await runGracefulShutdown('SIGTERM', d); expect(d.exitProcess).toHaveBeenCalledWith(1);
  });
  it('rejects requests on existing keepalive connections after closure', () => {
    closeProcessAdmission(); const res: any = { setHeader: vi.fn(), status: vi.fn(() => res), json: vi.fn() }; const next = vi.fn();
    processAdmissionMiddleware({} as any, res, next); expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
  });
  it('tracks async socket handlers and suppresses shutdown-generated disconnect forfeits', async () => {
    const socket = new EventEmitter(); const b = barrier(); const mutate = vi.fn(async () => b.promise); const forfeit = vi.fn();
    socket.on('move', mutate); socket.on('disconnect', forfeit); trackSocketHandlers(socket as unknown as Socket);
    socket.emit('move'); expect(activeProcessWork()).toEqual(['socket:move']);
    closeProcessAdmission(); socket.emit('disconnect'); socket.emit('move'); expect(forfeit).not.toHaveBeenCalled(); expect(mutate).toHaveBeenCalledTimes(1);
    b.release(); await drainProcessWork(); expect(activeProcessWork()).toEqual([]);
  });
  it('stops all registered resources even when one stop fails', () => {
    const stop = vi.fn(); onProcessStop(() => { throw new Error('stop'); }); onProcessStop(stop); closeProcessAdmission(); expect(stop).toHaveBeenCalledTimes(1);
  });
});
