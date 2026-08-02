import { afterEach, describe, expect, it } from 'vitest';
import { dailyFritzTelemetryEventId, getDailyFritzTelemetrySession } from './telemetry';

describe('Daily Fritz client telemetry identity', () => {
  afterEach(() => window.sessionStorage.clear());

  it('keeps one session identity per daily challenge within a browser tab', () => {
    const first = getDailyFritzTelemetrySession('2026-08-01');
    const repeated = getDailyFritzTelemetrySession('2026-08-01');
    const nextDay = getDailyFritzTelemetrySession('2026-08-02');

    expect(first).toBe(repeated);
    expect(nextDay).not.toBe(first);
  });

  it('creates stable bounded event identities for exactly-once client events', () => {
    expect(dailyFritzTelemetryEventId('attempt-1', 'first_move'))
      .toBe('attempt-1:first_move:once');
    expect(dailyFritzTelemetryEventId('x'.repeat(200), 'recovery_succeeded', 'resume-1'))
      .toHaveLength(160);
  });
});
