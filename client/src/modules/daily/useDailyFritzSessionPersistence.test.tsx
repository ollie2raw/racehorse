// @vitest-environment jsdom
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
      verifiedMatchId: 'verified-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      gameNumber: 1,
      dailyFritzHandIndex: 0,
      authorityRevision: 1,
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
    expect(JSON.parse(window.localStorage.getItem(storageKey)!).transcriptProtocolVersion).toBe(2);
  });

  it('never persists a new authority cursor with the previous hand match', () => {
    const storageKey = 'racehorse:daily-fritz:test-authority-cursor';
    const handOne = createBotMatch(60, 7);
    const handTwo = { ...handOne, handNumber: 2 };
    const base = {
      enabled: true,
      storageKey,
      attemptId: 'attempt-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      gameNumber: 1,
      moveLog: [],
      movesUsed: 0,
      preGameDrawActive: false,
      drawSequenceActive: false,
      handResult: null,
    };

    const { rerender } = renderHook(
      ({ handIndex, authorityRevision, match }) => {
        useDailyFritzSessionPersistence({
          ...base,
          dailyFritzHandIndex: handIndex,
          authorityRevision,
          match,
        });
      },
      { initialProps: { handIndex: 0, authorityRevision: 4, match: handOne } },
    );

    expect(JSON.parse(window.localStorage.getItem(storageKey)!).authorityRevision).toBe(4);

    rerender({ handIndex: 1, authorityRevision: 5, match: handOne });
    const duringBoundary = JSON.parse(window.localStorage.getItem(storageKey)!);
    expect(duringBoundary.currentHandIndex).toBe(0);
    expect(duringBoundary.authorityRevision).toBe(4);
    expect(duringBoundary.match.handNumber).toBe(1);

    rerender({ handIndex: 1, authorityRevision: 5, match: handTwo });
    const afterBoundary = JSON.parse(window.localStorage.getItem(storageKey)!);
    expect(afterBoundary.currentHandIndex).toBe(1);
    expect(afterBoundary.authorityRevision).toBe(5);
    expect(afterBoundary.match.handNumber).toBe(2);
  });
});
