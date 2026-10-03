/**
 * Event-loop watchdog thread. The main thread stores Date.now() into a shared
 * heartbeat every second; if it stops for stallMs this thread reports the
 * stall WHILE it is happening (the main thread cannot: it is blocked). It
 * reports again when the heartbeat resumes, with the stall's duration.
 *
 * Reports go to Sentry (initialised here with the server's DSN, same
 * enablement as the main process), to stderr as one JSON line for the Render
 * log, and to the parent as a message (delivered once it is unblocked).
 */
'use strict';

const { parentPort, workerData } = require('node:worker_threads');

const heartbeat = new BigInt64Array(workerData.heartbeat);
const stallMs = workerData.stallMs;
const checkMs = Math.max(100, Math.min(1_000, Math.floor(stallMs / 4)));

let Sentry = null;
if (workerData.sentry && workerData.sentry.enabled && workerData.sentry.dsn) {
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn: workerData.sentry.dsn,
      environment: workerData.sentry.environment,
      release: workerData.sentry.release,
      tracesSampleRate: 0,
    });
  } catch {
    Sentry = null;
  }
}

function report(event, level, fields) {
  const line = { level, context: 'event-loop-watchdog', event, ...fields, time: Date.now() };
  process.stderr.write(`${JSON.stringify(line)}\n`);
  if (Sentry) {
    try {
      Sentry.captureMessage(`[event-loop] main thread ${event === 'stall' ? 'stalled' : 'recovered'}`, {
        level,
        fingerprint: ['event-loop-watchdog', event],
        tags: { event_loop_alert: event },
        extra: fields,
      });
      void Sentry.flush(2_000);
    } catch {
      // Reporting must never take the watchdog down.
    }
  }
  parentPort.postMessage({ event, ...fields });
}

let stalledSince = null;

setInterval(() => {
  const last = Number(Atomics.load(heartbeat, 0));
  const now = Date.now();
  const silentMs = now - last;
  if (stalledSince === null && silentMs >= stallMs) {
    stalledSince = last;
    report('stall', 'error', { silentMs, stallMs, detectedAt: now });
  } else if (stalledSince !== null && silentMs < stallMs) {
    report('recovered', 'warning', { stallDurationMs: last - stalledSince, detectedAt: now });
    stalledSince = null;
  }
}, checkMs);
