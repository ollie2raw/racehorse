/**
 * The events have to fire once each, at a real trigger.
 *
 * This repo shipped #61 for an effect that re-fired on an object reference
 * rather than an identity, and StrictMode double-invokes effects in
 * development. Every assertion below is about count, not just presence —
 * a test that only checked "did it fire" would pass while double-counting
 * every session and halving every retention number.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  track,
  identifyUser,
  resetAnalytics,
  __setAnalyticsTransport,
  type AnalyticsTransport,
} from './analytics';

function fakeTransport() {
  const capture = vi.fn();
  const identify = vi.fn();
  const reset = vi.fn();
  const transport: AnalyticsTransport = { capture, identify, reset };
  __setAnalyticsTransport(transport);
  return { capture, identify, reset };
}

/** track() is fire-and-forget, so let its promise settle before asserting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('analytics transport', () => {
  beforeEach(() => __setAnalyticsTransport(null));

  it('records an event once per call', async () => {
    const { capture } = fakeTransport();
    track('session_start');
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('session_start', undefined);
  });

  it('carries the mode rather than fragmenting the event name', async () => {
    const { capture } = fakeTransport();
    track('game_opened', { mode: 'daily_fritz' });
    track('game_opened', { mode: 'puzzle_rush' });
    await settle();
    expect(capture.mock.calls.map(([event]) => event)).toEqual(['game_opened', 'game_opened']);
    expect(capture.mock.calls.map(([, props]) => props?.mode)).toEqual([
      'daily_fritz',
      'puzzle_rush',
    ]);
  });

  it('is a no-op with no transport, rather than throwing into product code', async () => {
    __setAnalyticsTransport(null);
    expect(() => track('session_start')).not.toThrow();
    await settle();
  });

  it('identifies and resets through the transport', async () => {
    const { identify, reset } = fakeTransport();
    identifyUser('user-1');
    resetAnalytics();
    await settle();
    expect(identify).toHaveBeenCalledWith('user-1', undefined);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
