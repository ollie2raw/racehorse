import * as Sentry from '@sentry/node';
import { childLogger } from './logger';

const log = childLogger('operational');

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

/**
 * Records a non-blocking operational failure without changing the primary
 * gameplay/API outcome. Use this instead of empty promise catches.
 */
export function recordOperationalFailure(
  scope: string,
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  const normalized = normalizeError(error);
  log.warn({ err: normalized, operational_scope: scope, ...context }, `[operational:${scope}]`);
  Sentry.captureException(normalized, {
    level: 'warning',
    tags: { operational_scope: scope },
    extra: context,
  });
}
