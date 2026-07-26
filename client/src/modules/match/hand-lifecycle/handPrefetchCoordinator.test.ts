import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyFritzPrefetchParams } from './types.ts';

const mocks = vi.hoisted(() => ({
  nextDailyFritzHand: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../daily/dailyFritzContracts.ts', () => ({
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS: 12_000,
  nextDailyFritzHand: mocks.nextDailyFritzHand,
}));

import { HandPrefetchCoordinator } from './handPrefetchCoordinator.ts';

const params = {
  dailyFritzPackage: {
    attempt_id: 'attempt-1',
    verified_match_id: 'match-1',
    run_date: '2026-07-25',
  },
  dailyFritzHandIndex: 0,
  gameNumber: 1,
  transcript: null,
  completedHandScores: { you: 0, fritz: 0 },
} as DailyFritzPrefetchParams;

describe('HandPrefetchCoordinator', () => {
  beforeEach(() => {
    mocks.nextDailyFritzHand.mockClear();
  });

  it('does not replace a completed-hand request when lifecycle observes completion twice', () => {
    const coordinator = new HandPrefetchCoordinator();
    coordinator.startPrefetch(params);
    coordinator.startPrefetch(params);

    expect(mocks.nextDailyFritzHand).toHaveBeenCalledTimes(1);
    expect(coordinator.hasInFlightRequest()).toBe(true);
  });
});
