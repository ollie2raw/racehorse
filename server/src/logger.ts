import pino from 'pino';
import { config } from './config';

export const logger = pino({
  level: config.isProd ? 'info' : 'debug',
});

export function childLogger(context: string) {
  return logger.child({ context });
}
