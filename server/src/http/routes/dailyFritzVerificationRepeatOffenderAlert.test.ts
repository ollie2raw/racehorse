/**
 * DF-G2 — the verification-bypass ops alert already existed; this proves the
 * per-user aggregation added on top of it: the alert carries the user's recent
 * failure count and escalates from `warning` to `error` once that count crosses
 * the repeat-offender threshold, so a serial transcript-tamperer is not lost in
 * a stream of one-off warnings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

const { recordEventMock, countFailuresMock } = vi.hoisted(() => ({
  recordEventMock: vi.fn().mockResolvedValue(undefined),
  countFailuresMock: vi.fn().mockResolvedValue(0),
}));

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));

vi.mock('../../logger', () => ({
  childLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../stores/dailyFritzEventStore', () => ({
  recordDailyFritzEvent: recordEventMock,
  countRecentDailyFritzVerificationFailures: countFailuresMock,
}));

import {
  DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD,
  recordDailyFritzAdvanceWithoutVerification,
} from './dailyFritzVerificationGlue';

async function bypass() {
  await recordDailyFritzAdvanceWithoutVerification({
    attemptId: 'attempt-x',
    runDate: '2026-09-02',
    userId: 'user-x',
    requestId: 'req-x',
    gameNumber: 1,
    handIndex: 2,
    verifierCode: 'fritz_state_mismatch',
    operation: 'record-game',
    message: 'diverged',
  });
}

afterEach(() => {
  vi.mocked(Sentry.captureMessage).mockClear();
  recordEventMock.mockClear();
  countFailuresMock.mockReset().mockResolvedValue(0);
});

describe('DF-G2 verification-bypass alert aggregation', () => {
  it('a first-time failure is a warning and carries the user failure count', async () => {
    countFailuresMock.mockResolvedValue(1);
    await bypass();

    const [, opts] = vi.mocked(Sentry.captureMessage).mock.calls.at(0)!;
    const o = opts as { level: string; tags: Record<string, string>; extra: Record<string, unknown> };
    expect(o.level).toBe('warning');
    expect(o.tags.daily_fritz_alert).toBe('verification_bypassed');
    expect(o.extra.userRecentVerificationFailures).toBe(1);
    expect(countFailuresMock).toHaveBeenCalledWith('user-x');
  });

  it('escalates to error + a distinct tag once the user hits the repeat-offender threshold', async () => {
    countFailuresMock.mockResolvedValue(DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD);
    await bypass();

    const [, opts] = vi.mocked(Sentry.captureMessage).mock.calls.at(0)!;
    const o = opts as { level: string; tags: Record<string, string>; extra: Record<string, unknown> };
    expect(o.level).toBe('error');
    expect(o.tags.daily_fritz_alert).toBe('verification_bypassed_repeat');
    expect(o.extra.userRecentVerificationFailures).toBe(DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD);
  });

  it('does not alert on an infrastructure verifier code (unchanged behaviour)', async () => {
    await recordDailyFritzAdvanceWithoutVerification({
      attemptId: 'attempt-x',
      runDate: '2026-09-02',
      userId: 'user-x',
      requestId: 'req-x',
      gameNumber: 1,
      handIndex: 2,
      verifierCode: 'missing_hand_start_progress',
      operation: 'record-game',
      message: 'infra',
    });
    // Infrastructure failures use the separate infrastructure alert path, not this one.
    const bypassCalls = vi.mocked(Sentry.captureMessage).mock.calls.filter(
      ([msg]) => String(msg).includes('verification bypassed'),
    );
    expect(bypassCalls).toHaveLength(0);
    expect(countFailuresMock).not.toHaveBeenCalled();
  });
});
