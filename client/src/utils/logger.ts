import * as Sentry from '@sentry/react';

export const logger = {
  error: (context: string, error: unknown, extra?: Record<string, unknown>): void => {
    console.error(`[${context}]`, error, extra);
    Sentry.captureException(error, { extra: { context, ...extra } });
  },
  warn: (context: string, message: string, extra?: Record<string, unknown>): void => {
    if (import.meta.env?.DEV) console.warn(`[${context}]`, message, extra);
  },
  info: (context: string, message: string, extra?: Record<string, unknown>): void => {
    if (import.meta.env?.DEV) console.info(`[${context}]`, message, extra);
  },
  /** Production-safe operational telemetry — Sentry breadcrumb always; console when DEV or mp_telemetry=1. */
  operational: (context: string, event: string, extra?: Record<string, unknown>): void => {
    Sentry.addBreadcrumb({
      category: `mp.${context}`,
      message: event,
      level: 'info',
      data: extra,
    });
    const verbose =
      import.meta.env?.DEV ||
      (typeof window !== 'undefined' && window.localStorage.getItem('mp_telemetry') === '1');
    if (verbose) {
      console.info(`[mp:${context}]`, event, extra ?? {});
    }
  },
};
