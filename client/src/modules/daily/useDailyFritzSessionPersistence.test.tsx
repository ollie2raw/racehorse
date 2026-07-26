import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { useDailyFritzSessionPersistence } from './useDailyFritzSessionPersistence.ts';

describe('useDailyFritzSessionPersistence', () => {
  beforeEach(() => window.localStorage.clear());

  it('does not checkpoint intermediate draw presentation state', () => {
    const storageKey = 'racehorse:daily-fritz:test-draw-transaction';
    const match = createBotMatch(60, 7);
    const base = {
      enabled: true,
      storageKey,
      attemptId: 'attempt-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      gameNumber: 1,
      dailyFritzHandIndex: 0,
      match,
      moveLog: [],
      movesUsed: 0,
      preGameDrawActive: false,
      handResult: null,
    };

    const { rerender } = renderHook(
      ({ drawSequenceActive }: { drawSequenceActive: boolean }) => {
        useDailyFritzSessionPersistence({ ...base, drawSequenceActive });
      },
      { initialProps: { drawSequenceActive: true } },
    );

    expect(window.localStorage.getItem(storageKey)).toBeNull();

    rerender({ drawSequenceActive: false });

    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
  });
});
