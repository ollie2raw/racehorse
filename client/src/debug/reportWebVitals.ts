import * as Sentry from '@sentry/react';
import { reportOptionalChunkFailure } from '../utils/optionalChunk';

type Metric = { name: string; value: number; id: string };
type Subscribe = (report: (metric: Metric) => void) => void;

type WebVitals = {
  onCLS: Subscribe;
  onINP: Subscribe;
  onLCP: Subscribe;
  onFCP: Subscribe;
  onTTFB: Subscribe;
};

export type ReportWebVitalsOptions = {
  /** Injected so the failure path can be tested without a broken network. */
  load?: () => Promise<WebVitals>;
  enabled?: boolean;
};

/**
 * Web Vitals → Sentry measurements.
 *
 * Lives in its own module so the chunk fetch can be tested. It used to sit in
 * main.tsx behind a bare `void reportWebVitals()` with no catch, and its
 * `await import('web-vitals')` was unguarded — so on every load of `/`, a
 * failed fetch of a telemetry chunk became an unhandled rejection. That is the
 * shape of the production "Importing a module script failed" report, and the
 * global recovery handler responded by reloading a working app.
 *
 * Nothing here is worth a single frame of user-visible disruption, so a
 * failure is recorded as context and the function resolves.
 */
export async function reportWebVitals(options: ReportWebVitalsOptions = {}): Promise<void> {
  const enabled = options.enabled ?? import.meta.env.PROD;
  if (!enabled) return;

  const load = options.load ?? (() => import('web-vitals') as Promise<WebVitals>);

  let vitals: WebVitals;
  try {
    vitals = await load();
  } catch (error) {
    reportOptionalChunkFailure('web-vitals', error);
    return;
  }

  const report = ({ name, value, id }: Metric) => {
    Sentry.setMeasurement(name, Math.round(name === 'CLS' ? value * 1000 : value), 'millisecond');
    // Also send as a custom event so Sentry's perf tab picks it up.
    Sentry.addBreadcrumb({ category: 'web-vitals', message: name, data: { value, id }, level: 'info' });
  };

  vitals.onCLS(report);
  vitals.onINP(report);
  vitals.onLCP(report);
  vitals.onFCP(report);
  vitals.onTTFB(report);
}
