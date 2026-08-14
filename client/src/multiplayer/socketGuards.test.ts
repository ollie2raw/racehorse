// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { MutableRefObject } from 'react';
import {
  SEQUENCE_REGRESSION_THRESHOLD,
  evaluateSequenceUpdate,
  wrapSocketHandler,
} from './socketGuards';
import { logger } from '../utils/logger';

function makeWatermark(initial: number): MutableRefObject<number> {
  return { current: initial };
}

describe('evaluateSequenceUpdate', () => {
  describe('valid forward progression', () => {
    it('accepts a sequence ahead of the watermark', () => {
      const ref = makeWatermark(5);
      expect(evaluateSequenceUpdate(ref, 6)).toEqual({ action: 'accept', sequence: 6 });
    });

    it('accepts a large forward jump (reconnect catch-up)', () => {
      const ref = makeWatermark(0);
      expect(evaluateSequenceUpdate(ref, 42)).toEqual({ action: 'accept', sequence: 42 });
    });

    it('accepts the first authoritative update after watermark reset', () => {
      const ref = makeWatermark(-1);
      expect(evaluateSequenceUpdate(ref, 1)).toEqual({ action: 'accept', sequence: 1 });
    });
  });

  describe('duplicate sequence handling', () => {
    it('accepts an update equal to the watermark', () => {
      const ref = makeWatermark(12);
      expect(evaluateSequenceUpdate(ref, 12)).toEqual({ action: 'accept', sequence: 12 });
    });

    it('does not mutate the watermark ref (callers own advancement)', () => {
      const ref = makeWatermark(7);
      evaluateSequenceUpdate(ref, 9);
      expect(ref.current).toBe(7);
    });
  });

  describe('stale sequence rejection', () => {
    it('rejects a slightly stale update within the regression threshold', () => {
      const ref = makeWatermark(20);
      expect(evaluateSequenceUpdate(ref, 15)).toEqual({
        action: 'reject_stale',
        incoming: 15,
        watermark: 20,
      });
    });

    it('rejects stale update exactly one below watermark', () => {
      const ref = makeWatermark(8);
      expect(evaluateSequenceUpdate(ref, 7)).toEqual({
        action: 'reject_stale',
        incoming: 7,
        watermark: 8,
      });
    });

    it('treats a gap equal to the threshold as stale (not regression)', () => {
      const ref = makeWatermark(20);
      const incoming = 20 - SEQUENCE_REGRESSION_THRESHOLD;
      expect(evaluateSequenceUpdate(ref, incoming)).toEqual({
        action: 'reject_stale',
        incoming,
        watermark: 20,
      });
    });
  });

  describe('sequence regression detection', () => {
    it('rejects a backward jump beyond the regression threshold', () => {
      const ref = makeWatermark(30);
      expect(evaluateSequenceUpdate(ref, 19)).toEqual({
        action: 'reject_regression',
        incoming: 19,
        watermark: 30,
      });
    });

    it('rejects regression when gap is threshold + 1', () => {
      const ref = makeWatermark(20);
      const incoming = 20 - SEQUENCE_REGRESSION_THRESHOLD - 1;
      expect(evaluateSequenceUpdate(ref, incoming)).toEqual({
        action: 'reject_regression',
        incoming,
        watermark: 20,
      });
    });

    it('documents reconnect watermark reset accepting any fresh sequence', () => {
      const ref = makeWatermark(100);
      ref.current = -1;
      expect(evaluateSequenceUpdate(ref, 3)).toEqual({ action: 'accept', sequence: 3 });
    });
  });

  describe('edge cases around reconnect and malformed payloads', () => {
    it('accepts with current watermark when incoming is null', () => {
      const ref = makeWatermark(4);
      expect(evaluateSequenceUpdate(ref, null)).toEqual({ action: 'accept', sequence: 4 });
    });

    it('accepts with current watermark when incoming is undefined', () => {
      const ref = makeWatermark(4);
      expect(evaluateSequenceUpdate(ref, undefined)).toEqual({ action: 'accept', sequence: 4 });
    });

    it('accepts with current watermark when incoming is NaN', () => {
      const ref = makeWatermark(9);
      expect(evaluateSequenceUpdate(ref, Number.NaN)).toEqual({ action: 'accept', sequence: 9 });
    });

    it('accepts with current watermark when incoming is Infinity', () => {
      const ref = makeWatermark(2);
      expect(evaluateSequenceUpdate(ref, Number.POSITIVE_INFINITY)).toEqual({
        action: 'accept',
        sequence: 2,
      });
    });

    it('handles watermark at zero with forward progression', () => {
      const ref = makeWatermark(0);
      expect(evaluateSequenceUpdate(ref, 1)).toEqual({ action: 'accept', sequence: 1 });
    });
  });
});

describe('wrapSocketHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('invokes the wrapped handler with event arguments', () => {
    const handler = vi.fn();
    const wrapped = wrapSocketHandler('state:update', handler);
    wrapped('room', { sequence: 1 });
    expect(handler).toHaveBeenCalledWith('room', { sequence: 1 });
  });

  it('swallows handler throws and logs the error', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const handler = vi.fn(() => {
      throw new Error('handler boom');
    });
    const wrapped = wrapSocketHandler('state:update', handler);

    expect(() => wrapped()).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('runs recoverOnError when the handler throws', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const recover = vi.fn();
    const wrapped = wrapSocketHandler(
      'state:update',
      () => {
        throw new Error('boom');
      },
      { recoverOnError: recover },
    );

    wrapped();
    await Promise.resolve();
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('logs recovery failures without rethrowing', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const wrapped = wrapSocketHandler(
      'state:update',
      () => {
        throw new Error('boom');
      },
      {
        recoverOnError: async () => {
          throw new Error('recovery failed');
        },
      },
    );

    wrapped();
    await Promise.resolve();
    expect(errorSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});