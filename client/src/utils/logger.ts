import * as Sentry from '@sentry/react';

export const logger = {
  error: (context: string, error: unknown, extra?: Record<string, unknown>): void => {
    console.error(`[${context}]`, error, extra);
    Sentry.captureException(error, { extra: { context, ...extra } });
  },
  warn: (context: string, message: string, extra?: Record<string, unknown>): void => {
    if (import.meta.env.DEV) console.warn(`[${context}]`, message, extra);
  },
  info: (context: string, message: string, extra?: Record<string, unknown>): void => {
    if (import.meta.env.DEV) console.info(`[${context}]`, message, extra);
  },
};
