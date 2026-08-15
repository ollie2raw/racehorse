import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordOperationalFailure } from './operationalTelemetry';
import { rootLogger } from './logger';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('@sentry/node', () => sentry);

describe('recordOperationalFailure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('records structured diagnostics without throwing into the primary flow', () => {
    const warn = vi.spyOn(rootLogger, 'warn').mockImplementation(() => undefined as never);
    sentry.captureException.mockReturnValue('event-id');

    expect(() =>
      recordOperationalFailure('daily_puzzle.activity_write', new Error('offline'), {
        attemptId: 'attempt-1',
      }),
    ).not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        operationalScope: 'daily_puzzle.activity_write',
        err: expect.objectContaining({ message: 'offline' }),
        attemptId: 'attempt-1',
      }),
      'operational failure',
    );
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'offline' }),
      expect.objectContaining({
        level: 'warning',
        tags: { operational_scope: 'daily_puzzle.activity_write' },
      }),
    );
  });
});
