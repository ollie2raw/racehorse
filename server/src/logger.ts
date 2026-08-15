import pino from 'pino';
import { config } from './config';

export const rootLogger = pino({
  level: process.env.LOG_LEVEL ?? (config.isProd ? 'info' : 'debug'),
  base: { service: 'racehorse-server' },
  // Pretty-print locally; emit raw JSON in production for log aggregation.
  transport: config.isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } },
});

export type Logger = pino.Logger;

/**
 * Scoped logger for a subsystem (e.g. 'daily-fritz', 'room-session').
 * Pass per-request/per-connection context (correlationId, userId, roomId) as bindings.
 */
export function childLogger(scope: string, bindings: Record<string, unknown> = {}): Logger {
  return rootLogger.child({ scope, ...bindings });
}
