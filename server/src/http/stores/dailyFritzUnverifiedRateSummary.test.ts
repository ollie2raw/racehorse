/**
 * The unverified-attempt count has to reach an operator, not just exist as a
 * pure function. It rides the existing daily health summary (the repo's
 * established daily aggregate, surfaced at /api/daily-fritz/health) and emits
 * one clearly-labelled log line per summary build so it can be grepped or
 * alerted on without new infrastructure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { infoLogMock } = vi.hoisted(() => ({ infoLogMock: vi.fn() }));

vi.mock('../../logger', () => ({
  childLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: infoLogMock,
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../config', () => ({
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
  captureMessage: vi.fn(),
}));

import { listDailyFritzHealthSummary } from './dailyFritzHealthSummary';
import { resetCircuitBreaker } from '../../supabaseUtils';

const RUN_DATE = '2026-08-24';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const ATTEMPT_ROWS = [
  // Completed protocol-v2 run that lost a hand → counted.
  {
    status: 'completed',
    result: {
      verification_protocol_version: 2,
      verification_status: 'rejected',
      unverified_hands: [{ hand_index: 3, verifier_code: 'fritz_state_mismatch' }],
    },
  },
  // Still in progress and already unverified → counted; a live regression
  // must be visible before the run finishes.
  {
    status: 'started',
    result: {
      verification_protocol_version: 2,
      verification_status: 'rejected',
      unverified_hands: [{ hand_index: 1, verifier_code: 'fritz_state_mismatch' }],
    },
  },
  // Clean v2 run → not counted.
  {
    status: 'completed',
    result: { verification_protocol_version: 2, verification_status: 'verified' },
  },
  // Legacy pre-authority completion → excluded from the v2 count, but still
  // counted by the pre-existing legacyUnverifiedCompletions figure.
  { status: 'completed', result: { verification_status: 'legacy_unverified' } },
];

beforeEach(() => {
  resetCircuitBreaker();
  mockFetch.mockReset();
  infoLogMock.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    const target = String(url);
    if (target.includes('daily_fritz_funnel_metrics')) {
      return jsonResponse([
        { event_type: 'attempt_started', total: 10 },
        { event_type: 'attempt_completed', total: 8 },
      ]);
    }
    if (target.includes('daily_fritz_failure_metrics')) {
      return jsonResponse([{ verifier_code: 'fritz_state_mismatch', total: 4 }]);
    }
    if (target.includes('daily_fritz_attempts')) return jsonResponse(ATTEMPT_ROWS);
    throw new Error(`Unexpected fetch: ${target}`);
  });
});

afterEach(() => {
  resetCircuitBreaker();
});

describe('daily unverified-attempt metric', () => {
  it('reports the protocol-v2 unverified attempt count for the day', async () => {
    const summary = await listDailyFritzHealthSummary(RUN_DATE);

    expect(summary.metrics.unverifiedHandAttempts).toBe(2);
    // The pre-existing legacy figure must not shift underneath this addition.
    expect(summary.metrics.legacyUnverifiedCompletions).toBe(1);
  });

  it('emits one greppable daily log line carrying the count', async () => {
    await listDailyFritzHealthSummary(RUN_DATE);

    const line = infoLogMock.mock.calls.find(
      ([, message]) => typeof message === 'string'
        && message.includes('[daily-fritz-unverified-rate]'),
    );
    expect(line).toBeTruthy();
    const fields = line?.[0] as Record<string, unknown>;
    expect(fields.runDate).toBe(RUN_DATE);
    expect(fields.unverifiedHandAttempts).toBe(2);
    expect(fields.attemptsStarted).toBe(10);
  });
});
