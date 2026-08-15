import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));
vi.mock('@sentry/react', () => sentry);

describe('client operational logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('captures a secondary-write rejection without throwing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sentry.captureException.mockReturnValue('event-id');

    expect(() =>
      logger.error('multiplayer.post_match_recording', new Error('write failed'), {
        roomCode: 'ROOM1',
      }),
    ).not.toThrow();
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'write failed' }),
      expect.objectContaining({
        extra: expect.objectContaining({
          context: 'multiplayer.post_match_recording',
          roomCode: 'ROOM1',
        }),
      }),
    );
  });
});
