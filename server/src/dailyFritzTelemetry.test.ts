import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_EVENT_TYPES,
  classifyDailyFritzFailure,
  isDailyFritzEventType,
} from './dailyFritzTelemetry';

describe('Daily Fritz telemetry contract', () => {
  it('uses a unique canonical lifecycle taxonomy', () => {
    expect(new Set(DAILY_FRITZ_EVENT_TYPES).size).toBe(DAILY_FRITZ_EVENT_TYPES.length);
    expect(isDailyFritzEventType('first_move')).toBe(true);
    expect(isDailyFritzEventType('made_up_event')).toBe(false);
  });

  it('allows checkpoint_saved in the canonical event taxonomy', () => {
    expect(isDailyFritzEventType('checkpoint_saved')).toBe(true);
  });

  it('allows async_verification_scheduled in the canonical event taxonomy', () => {
    expect(isDailyFritzEventType('async_verification_scheduled')).toBe(true);
  });

  it.each([
    ['stale_revision', 'command', 'authoritative_refresh'],
    ['authority_contract_unsupported', 'challenge', 'client_update_required'],
    ['operation_id_reused', 'verification', 'terminal_integrity_failure'],
    ['database_unavailable', 'persistence', 'transparent_retry'],
  ] as const)('classifies %s consistently', (code, phase, recoveryClass) => {
    expect(classifyDailyFritzFailure(code)).toEqual({ phase, recoveryClass });
  });
});
