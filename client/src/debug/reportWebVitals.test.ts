// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportOptionalChunkFailure } = vi.hoisted(() => ({
  reportOptionalChunkFailure: vi.fn(),
}));
vi.mock('../utils/optionalChunk', () => ({ reportOptionalChunkFailure }));

const { reportWebVitals } = await import('./reportWebVitals');

/**
 * The import this exists to guard is the one implicated in the production
 * "Importing a module script failed" report: it ran on every load of `/`,
 * behind a bare `void` with no catch, so a failed fetch of a telemetry chunk
 * became an unhandled rejection — and the global recovery handler reloaded the
 * page over it.
 */
describe('reportWebVitals', () => {
  beforeEach(() => reportOptionalChunkFailure.mockReset());

  it('subscribes to the vitals it reports', async () => {
    const onCLS = vi.fn();
    await reportWebVitals({
      enabled: true,
      load: async () => ({ onCLS, onINP: vi.fn(), onLCP: vi.fn(), onFCP: vi.fn(), onTTFB: vi.fn() }),
    });

    expect(onCLS).toHaveBeenCalledTimes(1);
  });

  it('resolves rather than rejecting when the chunk cannot be fetched', async () => {
    // The whole point: no unhandled rejection escapes.
    await expect(
      reportWebVitals({
        enabled: true,
        load: () => Promise.reject(new Error('Importing a module script failed.')),
      }),
    ).resolves.toBeUndefined();
  });

  it('reports the failed fetch as an optional chunk', async () => {
    await reportWebVitals({
      enabled: true,
      load: () => Promise.reject(new Error('Importing a module script failed.')),
    });

    expect(reportOptionalChunkFailure).toHaveBeenCalledWith('web-vitals', expect.any(Error));
  });

  it('does nothing at all outside production', async () => {
    const load = vi.fn();
    await reportWebVitals({ load, enabled: false });

    expect(load).not.toHaveBeenCalled();
  });
});
