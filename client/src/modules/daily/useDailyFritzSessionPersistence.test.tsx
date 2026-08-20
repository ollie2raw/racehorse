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
});
