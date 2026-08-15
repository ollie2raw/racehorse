import { describe, expect, it } from 'vitest';
import {
  DAILY_PUZZLE_EVENT_TYPES,
  classifyDailyPuzzleFailure,
  failureEventTypeForDailyPuzzleCode,
  isDailyPuzzleClientEventType,
  isDailyPuzzleEventType,
  normalizeDailyPuzzleFailureCode,
} from './dailyPuzzleTelemetry';

describe('Daily Puzzle telemetry taxonomy', () => {
  it('keeps a canonical lifecycle vocabulary', () => {
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('mode_impression');
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('first_move');
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('slot_submitted');
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('attempt_completed');
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('verification_failed');
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('command_conflict');
    expect(DAILY_PUZZLE_EVENT_TYPES).toContain('leaderboard_opened');
    expect(isDailyPuzzleEventType('share_completed')).toBe(true);
    expect(isDailyPuzzleEventType('made_up')).toBe(false);
    expect(isDailyPuzzleClientEventType('first_move')).toBe(true);
    expect(isDailyPuzzleClientEventType('attempt_completed')).toBe(false);
  });

  it('classifies retryable and integrity failures differently', () => {
    expect(classifyDailyPuzzleFailure('network_timeout')).toEqual({
      phase: 'persistence',
      recoveryClass: 'transparent_retry',
    });
    expect(classifyDailyPuzzleFailure('illegal_line')).toEqual({
      phase: 'verification',
      recoveryClass: 'terminal_integrity_failure',
    });
    expect(classifyDailyPuzzleFailure('slot_order_invalid')).toEqual({
      phase: 'command',
      recoveryClass: 'authoritative_refresh',
    });
    expect(classifyDailyPuzzleFailure('incompatible_version')).toEqual({
      phase: 'challenge',
      recoveryClass: 'client_update_required',
    });
    expect(failureEventTypeForDailyPuzzleCode('illegal_line')).toBe('verification_failed');
    expect(failureEventTypeForDailyPuzzleCode('stale_revision')).toBe('command_conflict');
    expect(failureEventTypeForDailyPuzzleCode('network_timeout')).toBe('request_failed');
    expect(normalizeDailyPuzzleFailureCode(new Error('Daily Puzzle slot order is invalid.')))
      .toBe('daily_puzzle_slot_order_is_invalid');
  });
});
