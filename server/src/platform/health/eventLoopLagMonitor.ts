/**
 * Event-loop lag monitoring (2026-09-30 / 10-01 outages: review search
 * blocked the event loop and /ping timed out with nothing in Sentry).
 *
 * Two layers:
 * - perf_hooks monitorEventLoopDelay, sampled every windowMs: warn log when
 *   the worst delay in the window reaches warnMs, Sentry alert (rate limited,
 *   fingerprinted) at alertMs. This can only report once the loop runs again.
 * - A watchdog thread (workers/eventLoopWatchdog.cjs) fed a shared heartbeat
 *   every second; it reports a stall of stallMs while the main thread is
 *   still blocked, then the recovery.
 */
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import * as Sentry from '@sentry/node';
import { childLogger } from '../../logger';

const log = childLogger('event-loop');

export const EVENT_LOOP_WATCHDOG_PATH = path.resolve(__dirname, '../../../workers/eventLoopWatchdog.cjs');

export type EventLoopLagWindow = {
  readonly maxMs: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly windowMs: number;
};

export type EventLoopLagMonitorOptions = {
  readonly windowMs?: number;
  readonly warnMs?: number;
  readonly alertMs?: number;
  readonly alertCooldownMs?: number;
  readonly stallMs?: number;
  /** Sentry settings for the watchdog thread; omit to disable its Sentry. */
  readonly sentry?: { dsn?: string; enabled: boolean; environment?: string; release?: string };
  readonly report?: (window: EventLoopLagWindow) => void;
  readonly onWatchdogEvent?: (event: { event: string } & Record<string, unknown>) => void;
  readonly watchdogPath?: string;
};

function envMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function reportEventLoopLag(window: EventLoopLagWindow): void {
  Sentry.captureMessage(`[event-loop] main thread blocked for ${Math.round(window.maxMs)}ms`, {
    level: 'error',
    fingerprint: ['event-loop-lag'],
    tags: { event_loop_alert: 'lag' },
    extra: { ...window },
  });
}

export function startEventLoopLagMonitor(options: EventLoopLagMonitorOptions = {}): { stop: () => Promise<void> } {
  const windowMs = options.windowMs ?? 10_000;
  const warnMs = options.warnMs ?? envMs('EVENT_LOOP_LAG_WARN_MS', 500);
  const alertMs = options.alertMs ?? envMs('EVENT_LOOP_LAG_ALERT_MS', 2_000);
  const alertCooldownMs = options.alertCooldownMs ?? 5 * 60_000;
  const stallMs = options.stallMs ?? envMs('EVENT_LOOP_STALL_MS', 5_000);
  const report = options.report ?? reportEventLoopLag;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let lastAlertAt = -Infinity;

  const sampler = setInterval(() => {
    const window: EventLoopLagWindow = {
      maxMs: histogram.max / 1e6,
      p99Ms: histogram.percentile(99) / 1e6,
      meanMs: histogram.mean / 1e6,
      windowMs,
    };
    histogram.reset();
    if (window.maxMs < warnMs) return;
    log.warn(window, 'event loop lag');
    const now = Date.now();
    if (window.maxMs >= alertMs && now - lastAlertAt >= alertCooldownMs) {
      lastAlertAt = now;
      report(window);
    }
  }, windowMs);
  sampler.unref();

  const shared = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  const heartbeat = new BigInt64Array(shared);
  Atomics.store(heartbeat, 0, BigInt(Date.now()));
  const beat = setInterval(() => Atomics.store(heartbeat, 0, BigInt(Date.now())), 1_000);
  beat.unref();

  let watchdog: Worker | null = null;
  try {
    watchdog = new Worker(options.watchdogPath ?? EVENT_LOOP_WATCHDOG_PATH, {
      workerData: { heartbeat: shared, stallMs, sentry: options.sentry ?? null },
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    watchdog.unref();
    watchdog.on('message', (message: { event: string } & Record<string, unknown>) => {
      if (message.event === 'stall') log.error(message, 'event loop stalled (reported by watchdog)');
      else log.warn(message, 'event loop recovered (reported by watchdog)');
      options.onWatchdogEvent?.(message);
    });
    watchdog.on('error', (error: Error) => log.warn({ err: error }, 'event loop watchdog failed'));
  } catch (error) {
    log.warn({ err: error }, 'event loop watchdog not started');
  }

  log.info({ warnMs, alertMs, stallMs }, 'event loop lag monitor started');
  return {
    stop: async () => {
      clearInterval(sampler);
      clearInterval(beat);
      histogram.disable();
      if (watchdog) await watchdog.terminate();
    },
  };
}
