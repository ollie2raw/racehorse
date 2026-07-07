import type { MutableRefObject } from 'react';
import { logger } from '../utils/logger';

/** Reject stale updates; large backward jumps trigger full resync. */
export const SEQUENCE_REGRESSION_THRESHOLD = 10;

export type SequenceDecision =
  | { action: 'accept'; sequence: number }
  | { action: 'reject_stale'; incoming: number; watermark: number }
  | { action: 'reject_regression'; incoming: number; watermark: number };

export function evaluateSequenceWatermark(
  watermark: number,
  incoming: number | undefined | null,
): SequenceDecision {
  if (typeof incoming !== 'number' || !Number.isFinite(incoming)) {
    return { action: 'accept', sequence: watermark };
  }
  if (incoming < watermark) {
    const gap = watermark - incoming;
    if (gap > SEQUENCE_REGRESSION_THRESHOLD) {
      return { action: 'reject_regression', incoming, watermark };
    }
    return { action: 'reject_stale', incoming, watermark };
  }
  return { action: 'accept', sequence: incoming };
}

export function evaluateSequenceUpdate(
  watermarkRef: MutableRefObject<number>,
  incoming: number | undefined | null,
): SequenceDecision {
  return evaluateSequenceWatermark(watermarkRef.current, incoming);
}

export function wrapSocketHandler<TArgs extends unknown[]>(
  eventName: string,
  handler: (...args: TArgs) => void,
  options?: {
    recoverOnError?: () => void | Promise<void>;
  },
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    try {
      handler(...args);
    } catch (error) {
      logger.error('socketGuards.ts', error, { eventName, message: `[socket:${eventName}] handler error` });
      if (options?.recoverOnError) {
        void Promise.resolve(options.recoverOnError()).catch((recoveryError) => {
          logger.error('socketGuards.ts', recoveryError, { eventName, message: `[socket:${eventName}] recovery failed` });
        });
      }
    }
  };
}
