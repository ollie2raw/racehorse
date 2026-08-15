import * as Sentry from '@sentry/node';
import { childLogger } from '../../logger';

export function prodSafeError(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return error instanceof Error ? error.message : String(error);
}

export function capture500(error: unknown, context?: Record<string, unknown>): void {
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export const log = childLogger('daily-fritz');
