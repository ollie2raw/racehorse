/**
 * Phase 3 item 3.2: circuit breaker for non-critical supabase reads.
 *
 * Forces real failures through the circuit-breaker logic and confirms
 * the 4th call is short-circuited without ever hitting the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally so no real network calls escape
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('./config', () => ({
  config: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePoolerUrl: null,
    supabaseServiceKey: 'test-service-key',
  },
}));

// Sentry mock — we just want to confirm it's called on breaker open
vi.mock('@sentry/node', () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setContext: vi.fn() })),
  captureException: vi.fn(),
}));

import { supabaseFetch, resetCircuitBreaker, isCircuitOpen } from './supabaseUtils';
import * as Sentry from '@sentry/node';

beforeEach(() => {
  resetCircuitBreaker();
  mockFetch.mockReset();
  vi.mocked(Sentry.captureException).mockClear();
  vi.mocked(Sentry.withScope).mockClear();
});

afterEach(() => {
  resetCircuitBreaker();
});

function makeFailResponse(status = 503): Response {
  return {
    ok: false,
    status,
    text: async () => 'Service Unavailable',
  } as unknown as Response;
}

describe('Supabase circuit breaker (item 3.2)', () => {
  it('allows calls through when closed', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' } as unknown as Response);
    await expect(
      supabaseFetch('/rest/v1/test', { circuitBreakable: true }),
    ).resolves.toEqual([]);
    expect(isCircuitOpen()).toBe(false);
  });

  it('opens the breaker after 3 failures in the window', async () => {
    mockFetch.mockResolvedValue(makeFailResponse());

    for (let i = 0; i < 3; i++) {
      await expect(
        supabaseFetch('/rest/v1/test', { circuitBreakable: true }),
      ).rejects.toThrow('Supabase request failed');
    }

    expect(isCircuitOpen()).toBe(true);
  });

  it('short-circuits the 4th call without hitting fetch when breaker is open', async () => {
    mockFetch.mockResolvedValue(makeFailResponse());

    // Drive 3 failures to open the breaker
    for (let i = 0; i < 3; i++) {
      await expect(
        supabaseFetch('/rest/v1/test', { circuitBreakable: true }),
      ).rejects.toThrow();
    }

    expect(isCircuitOpen()).toBe(true);
    const callsBefore = mockFetch.mock.calls.length;

    // 4th call must be short-circuited — fetch must NOT be called
    await expect(
      supabaseFetch('/rest/v1/test', { circuitBreakable: true }),
    ).rejects.toThrow('circuit breaker is open');

    expect(mockFetch.mock.calls.length).toBe(callsBefore); // no additional fetch call
  });

  it('does NOT open breaker for write (POST) calls', async () => {
    mockFetch.mockResolvedValue(makeFailResponse());

    for (let i = 0; i < 3; i++) {
      await expect(
        supabaseFetch('/rest/v1/test', { method: 'POST', body: '{}', circuitBreakable: true }),
      ).rejects.toThrow();
    }

    // Writes never trip the breaker
    expect(isCircuitOpen()).toBe(false);
  });

  it('does NOT short-circuit non-circuitBreakable GET calls even when breaker is open', async () => {
    mockFetch.mockResolvedValue(makeFailResponse());

    for (let i = 0; i < 3; i++) {
      await expect(
        supabaseFetch('/rest/v1/test', { circuitBreakable: true }),
      ).rejects.toThrow();
    }
    expect(isCircuitOpen()).toBe(true);

    // Non-circuitBreakable reads bypass the breaker
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{"ok":true}' } as unknown as Response);
    await expect(
      supabaseFetch('/rest/v1/critical', { circuitBreakable: false }),
    ).resolves.toEqual({ ok: true });
  });

  it('captures to Sentry when the breaker opens', async () => {
    mockFetch.mockResolvedValue(makeFailResponse());

    for (let i = 0; i < 3; i++) {
      await expect(
        supabaseFetch('/rest/v1/test', { circuitBreakable: true }),
      ).rejects.toThrow();
    }

    expect(Sentry.withScope).toHaveBeenCalledTimes(1);
  });
});
