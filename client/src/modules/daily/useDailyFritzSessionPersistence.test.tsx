// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { useDailyFritzSessionPersistence } from './useDailyFritzSessionPersistence.ts';
import type { DailyFritzMatchSession } from './dailyFritzMatchSession.ts';
import {
  DAILY_FRITZ_SERVER_CHECKPOINT_SCHEMA_VERSION,
  DAILY_FRITZ_SESSION_SCHEMA_VERSION,
} from './dailyFritzSessionStorage.ts';
import { DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS } from '../../dailyFritz/dailyFritzCheckpointUnload.ts';

const { saveDailyFritzCheckpointMock, flushDailyFritzCheckpointOnUnloadMock } = vi.hoisted(() => ({
  saveDailyFritzCheckpointMock: vi.fn(async () => ({ ok: true, checkpoint_revision: 99 })),
  flushDailyFritzCheckpointOnUnloadMock: vi.fn(() => true),
}));

vi.mock('../../dailyFritz/api.ts', () => ({
  saveDailyFritzCheckpoint: saveDailyFritzCheckpointMock,
  recordDailyFritzTelemetry: vi.fn(async () => undefined),
}));

vi.mock('../../dailyFritz/dailyFritzCheckpointUnload.ts', async () => {
  const actual = await vi.importActual<typeof import('../../dailyFritz/dailyFritzCheckpointUnload.ts')>(
    '../../dailyFritz/dailyFritzCheckpointUnload.ts',
  );
  return {
    ...actual,
    flushDailyFritzCheckpointOnUnload: flushDailyFritzCheckpointOnUnloadMock,
  };
});

vi.mock('../../api/client.ts', () => ({
  getAuthHeaders: vi.fn(async () => ({
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    hasToken: true,
  })),
}));

function sessionFromHand(handIndex: number, match = createBotMatch(60, 7)): DailyFritzMatchSession {
  match.handNumber = handIndex + 1;
  return {
    cursor: { gameNumber: 1, handIndex, revision: handIndex + 4 },
    match,
  };
}

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
    const base = {
      enabled: true,
      storageKey,
      attemptId: 'attempt-1',
      verifiedMatchId: 'verified-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      session: sessionFromHand(0),
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
    const persisted = JSON.parse(window.localStorage.getItem(storageKey)!);
    expect(persisted.schemaVersion).toBe(DAILY_FRITZ_SESSION_SCHEMA_VERSION);
    expect(persisted.session.cursor.handIndex).toBe(0);
    expect(persisted.transcriptProtocolVersion).toBe(2);
  });

  it('persists coherent session snapshots atomically', () => {
    const storageKey = 'racehorse:daily-fritz:test-authority-cursor';
    const handOne = sessionFromHand(0);
    const handTwo = sessionFromHand(1, { ...handOne.match, handNumber: 2 });
    const base = {
      enabled: true,
      storageKey,
      attemptId: 'attempt-1',
      verifiedMatchId: 'verified-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      moveLog: [],
      movesUsed: 0,
      preGameDrawActive: false,
      drawSequenceActive: false,
      handResult: null,
    };

    const { rerender } = renderHook(
      ({ session }: { session: DailyFritzMatchSession }) => {
        useDailyFritzSessionPersistence({ ...base, session });
      },
      { initialProps: { session: handOne } },
    );

    expect(JSON.parse(window.localStorage.getItem(storageKey)!).authorityRevision).toBe(4);

    rerender({ session: handTwo });

    const afterBoundary = JSON.parse(window.localStorage.getItem(storageKey)!);
    expect(afterBoundary.schemaVersion).toBe(DAILY_FRITZ_SESSION_SCHEMA_VERSION);
    expect(afterBoundary.session.cursor.handIndex).toBe(1);
    expect(afterBoundary.currentHandIndex).toBe(1);
    expect(afterBoundary.authorityRevision).toBe(5);
    expect(afterBoundary.match.handNumber).toBe(2);
  });

  it('flushes a pending debounced checkpoint on pagehide before the timer fires', async () => {
    const storageKey = 'racehorse:daily-fritz:test-pagehide-flush';
    const base = {
      enabled: true,
      storageKey,
      attemptId: 'attempt-1',
      verifiedMatchId: 'verified-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      session: sessionFromHand(0),
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

    expect(saveDailyFritzCheckpointMock).not.toHaveBeenCalled();
    expect(flushDailyFritzCheckpointOnUnloadMock).not.toHaveBeenCalled();

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
    expect(saveDailyFritzCheckpointMock).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(flushDailyFritzCheckpointOnUnloadMock).toHaveBeenCalledTimes(1);
    expect(flushDailyFritzCheckpointOnUnloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'attempt-1',
        verifiedMatchId: 'verified-1',
        accessToken: 'test-token',
        checkpoint: expect.objectContaining({
          schemaVersion: DAILY_FRITZ_SERVER_CHECKPOINT_SCHEMA_VERSION,
          checkpointRevision: expect.any(Number),
        }),
      }),
    );
    const flushCall = flushDailyFritzCheckpointOnUnloadMock.mock.calls.at(0)?.at(0) as
      | { checkpoint: Record<string, unknown> }
      | undefined;
    expect(flushCall?.checkpoint).not.toHaveProperty('session');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(saveDailyFritzCheckpointMock).not.toHaveBeenCalled();
  });

  describe('mid-hand checkpoint window', () => {
    const entry = (n: number) => ({
      moveNumber: n,
      handNumber: 1,
      player: 'you' as const,
      action: 'place' as const,
      tile: [0, n] as [number, number],
      position: 'left' as const,
      boardEnds: [-1, -1] as [number, number],
      handBefore: [[0, n]] as [number, number][],
      validMoves: [[0, n]] as [number, number][],
      pipDelta: 1,
      pointsScored: 0,
      boardState: [],
      boardRenderState: null,
      handSnapshot: [[0, n]] as [number, number][],
      engineBestMove: null,
    });
    const props = (n: number, over: Record<string, unknown> = {}) => ({
      enabled: true,
      storageKey: 'racehorse:daily-fritz:test-window',
      attemptId: 'attempt-1',
      verifiedMatchId: 'verified-1',
      runDate: '2026-07-25',
      runFingerprint: 'run-fingerprint',
      session: sessionFromHand(0),
      moveLog: Array.from({ length: n }, (_, i) => entry(i + 1)),
      movesUsed: n,
      preGameDrawActive: false,
      drawSequenceActive: false,
      handResult: null,
      ...over,
    });
    const revisionOf = (call: unknown) =>
      ((call as { checkpoint: { checkpointRevision: number } }).checkpoint).checkpointRevision;
    const callArg = (i: number) => (saveDailyFritzCheckpointMock.mock.calls as unknown as unknown[][])[i][0];
    const settle = () => act(async () => { await Promise.resolve(); });

    it('posts once per window with the newest state, and the window is not restarted by later moves', async () => {
      const { rerender } = renderHook((p) => useDailyFritzSessionPersistence(p), { initialProps: props(1) });
      for (let n = 2; n <= 5; n++) {
        act(() => { vi.advanceTimersByTime(2_500); });
        rerender(props(n));
      }
      // 10 s in: still inside the window the first move opened.
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(0);
      act(() => { vi.advanceTimersByTime(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS - 10_000); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(1);
      const posted = callArg(0);
      const local = JSON.parse(window.localStorage.getItem('racehorse:daily-fritz:test-window')!);
      expect(revisionOf(posted)).toBe(local.checkpointRevision);
    });

    it('flushes the unsent state when the tab is hidden (once), and not when it becomes visible', async () => {
      const { rerender } = renderHook((p) => useDailyFritzSessionPersistence(p), { initialProps: props(1) });
      rerender(props(2));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(flushDailyFritzCheckpointOnUnloadMock).not.toHaveBeenCalled();
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(flushDailyFritzCheckpointOnUnloadMock).toHaveBeenCalledTimes(1);
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(flushDailyFritzCheckpointOnUnloadMock).toHaveBeenCalledTimes(1);
      act(() => { vi.advanceTimersByTime(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS * 2); });
      expect(saveDailyFritzCheckpointMock).not.toHaveBeenCalled();
    });

    it('flushes the unsent state when the screen unmounts', () => {
      const { rerender, unmount } = renderHook((p) => useDailyFritzSessionPersistence(p), { initialProps: props(1) });
      rerender(props(2));
      unmount();
      expect(flushDailyFritzCheckpointOnUnloadMock).toHaveBeenCalledTimes(1);
    });

    it('posts the hand-end checkpoint immediately, ahead of the window', async () => {
      const handOne = sessionFromHand(0);
      const { rerender } = renderHook((p) => useDailyFritzSessionPersistence(p), { initialProps: props(1, { session: handOne }) });
      expect(saveDailyFritzCheckpointMock).not.toHaveBeenCalled();
      rerender(props(2, { session: { ...handOne, match: { ...handOne.match, handOver: true } } }));
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(1);
      // and nothing is left to fire later
      act(() => { vi.advanceTimersByTime(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS * 2); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the latest state and retries when the post fails (offline), then stops once it lands', async () => {
      saveDailyFritzCheckpointMock
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(null as never);
      const { rerender } = renderHook((p) => useDailyFritzSessionPersistence(p), { initialProps: props(1) });
      act(() => { vi.advanceTimersByTime(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(1);
      // a newer state arrives while offline: the retry carries it, not the stale one
      rerender(props(2));
      act(() => { vi.advanceTimersByTime(2_000); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(2);
      const lastRev = revisionOf(callArg(1));
      expect(lastRev).toBeGreaterThan(revisionOf(callArg(0)));
      act(() => { vi.advanceTimersByTime(5_000); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(3); // second failure retried, third lands
      act(() => { vi.advanceTimersByTime(60_000); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(3);
    });

    it('sends a still-pending checkpoint when the browser comes back online', async () => {
      saveDailyFritzCheckpointMock.mockResolvedValueOnce(null as never);
      renderHook((p) => useDailyFritzSessionPersistence(p), { initialProps: props(1) });
      act(() => { vi.advanceTimersByTime(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(1);
      act(() => { window.dispatchEvent(new Event('online')); });
      await settle();
      // the retry timer is already armed, so online does not double-post; the retry fires on schedule
      act(() => { vi.advanceTimersByTime(2_000); });
      await settle();
      expect(saveDailyFritzCheckpointMock).toHaveBeenCalledTimes(2);
    });
  });
});
