import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/node', () => sentry);

const warnSpy = vi.hoisted(() => vi.fn());
vi.mock('./logger', () => ({
  childLogger: () => ({ warn: warnSpy }),
}));

import { recordOperationalFailure } from './operationalTelemetry';

describe('recordOperationalFailure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records structured diagnostics without throwing into the primary flow', () => {
    sentry.captureException.mockReturnValue('event-id');

    expect(() =>
      recordOperationalFailure('daily_puzzle.activity_write', new Error('offline'), {
        attemptId: 'attempt-1',
      }),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'offline' }), operational_scope: 'daily_puzzle.activity_write', attemptId: 'attempt-1' }),
      '[operational:daily_puzzle.activity_write]',
    );
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'offline' }),
      expect.objectContaining({
        level: 'warning',
        tags: { operational_scope: 'daily_puzzle.activity_write' },
      }),
    );
  });

  it('coerces non-Error failures to Error before capturing', () => {
    recordOperationalFailure('some.scope', 'string failure');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.objectContaining({ message: 'string failure' }) }),
      '[operational:some.scope]',
    );
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'string failure' }),
      expect.anything(),
    );
  });
});
