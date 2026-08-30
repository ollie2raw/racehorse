// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addBreadcrumb, captureException } = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock('@sentry/react', () => ({ addBreadcrumb, captureException }));

const { reportOptionalChunkFailure } = await import('./optionalChunk');

describe('reportOptionalChunkFailure', () => {
  beforeEach(() => {
    addBreadcrumb.mockReset();
    captureException.mockReset();
  });

  it('records the failure as context, not as its own Sentry issue', () => {
    // These chunks are optional by definition. Capturing each one as an
    // exception is how a flaky mobile connection turns into an alert storm.
    reportOptionalChunkFailure('web-vitals', new Error('Importing a module script failed.'));

    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledTimes(1);
  });

  it('names the chunk and the reason in the breadcrumb', () => {
    reportOptionalChunkFailure('canvas-confetti', new Error('boom'));

    const crumb = addBreadcrumb.mock.calls[0]![0] as { data?: Record<string, unknown> };
    expect(crumb.data).toMatchObject({ chunk: 'canvas-confetti', reason: 'boom' });
  });

  it('survives a non-Error rejection', () => {
    expect(() => reportOptionalChunkFailure('web-vitals', 'plain string')).not.toThrow();
    const crumb = addBreadcrumb.mock.calls[0]![0] as { data?: Record<string, unknown> };
    expect(crumb.data).toMatchObject({ reason: 'plain string' });
  });

  it('never throws, whatever Sentry does', () => {
    // It is only ever called from a catch handler. Throwing there would
    // recreate the unhandled rejection it exists to prevent.
    addBreadcrumb.mockImplementation(() => {
      throw new Error('sentry unavailable');
    });

    expect(() => reportOptionalChunkFailure('web-vitals', new Error('boom'))).not.toThrow();
  });
});
