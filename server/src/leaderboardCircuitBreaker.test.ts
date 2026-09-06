/**
 * Phase 3 item 3.2 (integration): circuit breaker trips through a real leaderboard
 * call site, not just the raw supabaseFetch primitive.
 *
 * Forces 3 network failures through buildDailyFritzLeaderboard, then confirms the
 * 4th call is short-circuited without hitting fetch at all.
 *
 * (The parallel buildDailyPuzzleLeaderboardForDate cases went with the retired
 * daily-puzzle ladder's attempt-tracking surface — §CQ9.1.6.4.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('./config', () => ({
  config: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePoolerUrl: null,
    supabaseServiceKey: 'test-key',
  },
}));

vi.mock('@sentry/node', () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setContext: vi.fn() })),
  captureException: vi.fn(),
}));

import { resetCircuitBreaker, isCircuitOpen } from './supabaseUtils';
import { buildDailyFritzLeaderboard } from './http/stores/dailyFritzStore';

function make503(): Response {
  return { ok: false, status: 503, text: async () => 'Service Unavailable' } as unknown as Response;
}

beforeEach(() => {
  resetCircuitBreaker();
  mockFetch.mockReset();
});

afterEach(() => {
  resetCircuitBreaker();
});

describe('leaderboard circuit breaker integration (item 3.2)', () => {
  it('trips the breaker after 3 failures through buildDailyFritzLeaderboard', async () => {
    mockFetch.mockResolvedValue(make503());

    for (let i = 0; i < 3; i++) {
      await expect(buildDailyFritzLeaderboard('2026-08-12')).rejects.toThrow('Supabase request failed');
    }

    expect(isCircuitOpen()).toBe(true);
  });

  it('short-circuits 4th Fritz leaderboard call without hitting fetch', async () => {
    mockFetch.mockResolvedValue(make503());

    for (let i = 0; i < 3; i++) {
      await expect(buildDailyFritzLeaderboard('2026-08-12')).rejects.toThrow();
    }

    const callsBefore = mockFetch.mock.calls.length;
    await expect(buildDailyFritzLeaderboard('2026-08-12')).rejects.toThrow('circuit breaker is open');
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });

  it('Daily Fritz leaderboard query is capped to prevent unbounded scans', async () => {
    mockFetch.mockResolvedValue(make503());

    await expect(buildDailyFritzLeaderboard('2026-08-12')).rejects.toThrow();

    // supabaseFetch passes a URL object; convert to string to inspect query params
    const [requestArg] = mockFetch.mock.calls[0] as [URL | string | Request, ...unknown[]];
    const urlStr = String(requestArg instanceof URL ? requestArg.href : requestArg);
    expect(urlStr).toMatch(/limit=\d+/);
    const limitMatch = urlStr.match(/limit=(\d+)/);
    expect(Number(limitMatch?.[1])).toBeGreaterThan(0);
    expect(Number(limitMatch?.[1])).toBeLessThanOrEqual(10_000);
  });
});
