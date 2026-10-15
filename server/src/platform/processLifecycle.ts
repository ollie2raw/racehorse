import { childLogger } from '../logger';
import type { RequestHandler } from 'express';
import type { Socket } from 'socket.io';

// One process owns admission. Closing is synchronous: a callback is either
// admitted and counted before it runs, or cannot begin after this transition.
const log = childLogger('platform:lifecycle');
let closing = false;
const work = new Map<symbol, string>();
const stoppers = new Set<() => unknown>();
const timerStops = new Map<ReturnType<typeof setTimeout>, () => void>();
const waiters = new Set<() => void>();
export const isProcessClosing = (): boolean => closing;
export const activeProcessWork = (): string[] => [...work.values()];

export function beginProcessWork(name: string): () => void {
  const id = Symbol(name);
  work.set(id, name);
  return () => {
    work.delete(id);
    for (const notify of waiters) notify();
  };
}

/** Track continuations of already admitted work, including detached tails. */
export async function trackProcessWork<T>(name: string, task: () => T | Promise<T>): Promise<T> {
  const end = beginProcessWork(name);
  try { return await task(); } finally { end(); }
}

export function onProcessStop(stop: () => unknown): void {
  if (closing) { void stop(); return; }
  stoppers.add(stop);
}

export function closeProcessAdmission(): void {
  if (closing) return;
  closing = true;
  for (const stop of stoppers) {
    try {
      const result = stop();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void trackProcessWork('resource-stop', () => result).catch((err) => log.warn({ err }, 'resource stop failed'));
      }
    } catch (err) { log.warn({ err }, 'resource stop failed'); }
  }
  stoppers.clear();
}

/** No new maintenance/room timer starts while closing. In-flight work finishes. */
export function processTimeout(name: string, task: () => unknown, ms: number): ReturnType<typeof setTimeout> {
  const stop = () => { clearTimeout(timer); timerStops.delete(timer); stoppers.delete(stop); };
  const timer = setTimeout(() => {
    stoppers.delete(stop);
    timerStops.delete(timer);
    if (!closing) void trackProcessWork(name, task).catch((err) => log.error({ err, name }, 'scheduled work failed'));
  }, ms);
  timerStops.set(timer, stop);
  onProcessStop(stop);
  return timer;
}

export function cancelProcessTimeout(timer: ReturnType<typeof setTimeout>): void {
  const stop = timerStops.get(timer);
  if (stop) stop(); else clearTimeout(timer);
}

export const cancelProcessInterval = cancelProcessTimeout;

export function processInterval(name: string, task: () => unknown, ms: number): ReturnType<typeof setInterval> {
  const stop = () => { clearInterval(timer); timerStops.delete(timer); stoppers.delete(stop); };
  const timer = setInterval(() => {
    if (!closing) void trackProcessWork(name, task).catch((err) => log.error({ err, name }, 'scheduled work failed'));
  }, ms);
  timerStops.set(timer, stop);
  onProcessStop(stop);
  return timer;
}

export async function drainProcessWork(): Promise<void> {
  while (work.size) await new Promise<void>((resolve) => {
    const notify = () => { waiters.delete(notify); resolve(); };
    waiters.add(notify);
  });
}

export const processAdmissionMiddleware: RequestHandler = (_req, res, next) => {
  if (closing) { res.setHeader('Connection', 'close'); res.status(503).json({ error: 'server_shutting_down' }); return; }
  const end = beginProcessWork('http');
  res.once('finish', end);
  res.once('close', end);
  next();
};

/** Called after the synchronous registrar pass, before any packet can arrive. */
export function trackSocketHandlers(socket: Socket): void {
  for (const event of socket.eventNames()) {
    if (typeof event !== 'string') continue;
    for (const listener of socket.rawListeners(event)) {
      socket.removeListener(event, listener as (...args: unknown[]) => void);
      socket.addListener(event, (...args: unknown[]) => {
        // Server replacement must not manufacture disconnect forfeits or cleanup.
        if (closing) return;
        const end = beginProcessWork(`socket:${String(event)}`);
        try {
          const result: unknown = (listener as (...input: unknown[]) => unknown).apply(socket, args);
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            void Promise.resolve(result).finally(end).catch((err) => log.error({ err, event }, 'socket handler failed'));
          } else end();
        } catch (error) { end(); throw error; }
      });
    }
  }
}

export function resetProcessLifecycleForTests(): void {
  closeProcessAdmission();
  closing = false;
  work.clear();
  waiters.clear();
}
