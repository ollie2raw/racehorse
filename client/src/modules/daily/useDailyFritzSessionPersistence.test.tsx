// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { useDailyFritzSessionPersistence } from './useDailyFritzSessionPersistence.ts';
import { DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS } from '../../dailyFritz/dailyFritzCheckpointUnload.ts';

const saveDailyFritzCheckpoint = vi.fn(async () => ({ ok: true, checkpoint_revision: 99 }));
const flushDailyFritzCheckpointOnUnload = vi.fn(() => true);

vi.mock('../../dailyFritz/api.ts', () => ({
  saveDailyFritzCheckpoint: (...args: unknown[]) => saveDailyFritzCheckpoint(...args),
  recordDailyFritzTelemetry: vi.fn(async () => undefined),
}));

vi.mock('../../dailyFritz/dailyFritzCheckpointUnload.ts', async () => {
  const actual = await vi.importActual<typeof import('../../dailyFritz/dailyFritzCheckpointUnload.ts')>(
    '../../dailyFritz/dailyFritzCheckpointUnload.ts',
  );
  return {
    ...actual,
    flushDailyFritzCheckpointOnUnload: (...args: unknown[]) => flushDailyFritzCheckpointOnUnload(...args),
  };
});

vi.mock('../../api/client.ts', () => ({
  getAuthHeaders: vi.fn(async () => ({
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    hasToken: true,
  })),
}));

describe('useDailyFritzSessionPersistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
      verifiedMatchId: 'verified-1',
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

  it('flushes a pending debounced checkpoint on pagehide before the timer fires', async () => {
    const storageKey = 'racehorse:daily-fritz:test-pagehide-flush';
    const match = createBotMatch(60, 7);
    match.handNumber = 1;
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
      moveLog: [{
        moveNumber: 1,
        handNumber: 1,
        player: 'you' as const,
        action: 'place' as const,
        tile: [0, 1] as [number, number],
        position: 'left' as const,
        boardEnds: [-1, -1] as [number, number],
        handBefore: [[0, 1]] as [number, number][],
        validMoves: [[0, 1]] as [number, number][],
        pipDelta: 1,
        pointsScored: 0,
        boardState: [],
        boardRenderState: null,
        handSnapshot: [[0, 1]] as [number, number][],
        engineBestMove: null,
      }],
      movesUsed: 1,
      preGameDrawActive: false,
      drawSequenceActive: false,
      handResult: null,
    };

    const { rerender } = renderHook(
      ({ moveLog }) => {
        useDailyFritzSessionPersistence({ ...base, moveLog });
      },
      { initialProps: { moveLog: base.moveLog } },
    );

    expect(saveDailyFritzCheckpoint).not.toHaveBeenCalled();
    expect(flushDailyFritzCheckpointOnUnload).not.toHaveBeenCalled();

    rerender({
      moveLog: [
        ...base.moveLog,
        {
          ...base.moveLog[0],
          moveNumber: 2,
          tile: [1, 2] as [number, number],
        },
      ],
    });

    act(() => {
      vi.advanceTimersByTime(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS - 100);
    });
    expect(saveDailyFritzCheckpoint).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(flushDailyFritzCheckpointOnUnload).toHaveBeenCalledTimes(1);
    expect(flushDailyFritzCheckpointOnUnload).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        verifiedMatchId: 'verified-1',
        accessToken: 'test-token',
        checkpoint: expect.objectContaining({ checkpointRevision: expect.any(Number) }),
      }),
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(saveDailyFritzCheckpoint).not.toHaveBeenCalled();
  });
});
