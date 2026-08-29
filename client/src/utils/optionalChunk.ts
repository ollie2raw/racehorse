import * as Sentry from '@sentry/react';

/**
 * Reports a failed *optional* chunk fetch.
 *
 * Some dynamic imports carry things the app can do without — telemetry,
 * confetti, a display-name helper, a debug module. When one of those fails to
 * load (a stale hash after a deploy, a dropped mobile connection, a
 * backgrounded tab) the right response is to note it and carry on.
 *
 * A breadcrumb rather than `captureException`, deliberately: these fail for
 * environmental reasons on flaky networks, and capturing each one turns a bad
 * signal into an alert storm. They stay visible as context on whatever real
 * error follows.
 *
 * Only ever called from a catch handler, so it must not throw — doing so would
 * recreate the unhandled rejection it exists to prevent.
 */
export function reportOptionalChunkFailure(chunk: string, error: unknown): void {
  try {
    Sentry.addBreadcrumb({
      category: 'chunk',
      message: 'optional chunk failed to load',
      level: 'warning',
      data: { chunk, reason: error instanceof Error ? error.message : String(error) },
    });
  } catch {
    // Reporting is best-effort by construction.
  }
}
