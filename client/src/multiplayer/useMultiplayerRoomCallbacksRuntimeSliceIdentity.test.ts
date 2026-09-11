// @vitest-environment jsdom
/**
 * D5 runtime migration — manual identity check for useMultiplayerRoomCallbacks'
 * conversion to runtime slices, per D5-runtime-migration-scoping-2026-09-10.md
 * §4's note: "a manual identity check ... per converted hook is worth adding."
 * Same approach as useMultiplayerResyncRuntimeSliceIdentity.test.ts (#183).
 *
 * Builds its fixture as a plain object literal shaped like the runtime slices
 * this hook actually reads, rather than constructing anything through the
 * runtime's own composition functions — check:architecture's INV-01 restricts
 * every one of those (the singleton root and the individual slice factories
 * alike) to their own module plus App.tsx / runtimeBehaviorTests.ts, tests
 * included, and text-scans multiplayer/use* files for even a bare mention of
 * the restricted name. A hand-built literal constructs nothing, so it doesn't
 * trip that rule, while still proving what matters here: the hook's
 * unchanged internal logic reads/writes through whatever ref objects the
 * runtime param hands it, not a copy.
 *
 * resetClientGameSession is the target — it's the one callback that touches
 * every migrated slice in one call (room.maxSequenceRef, recovery's buffered
 * update ref, session's dispatch) plus two of the confirmed orphan refs, so
 * one behavioral test exercises the whole conversion at once.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { useMultiplayerRoomCallbacks, type UseMultiplayerRoomCallbacksParams } from './useMultiplayerRoomCallbacks';
import type { MultiplayerRuntime } from './runtime/runtimeTypes';

function makeFakeRuntime() {
  const socketRef = { current: null as Socket | null };
  const sessionRef = { current: { phase: 'idle' as const, context: {} } };
  const dispatchSession = vi.fn();
  const pendingCreateResolversRef = { current: [] as Array<(code: string | null) => void> };
  const autoJoinAttemptedRef = { current: false };
  const maxSequenceRef = { current: 7 };
  const roomPlayersRef = { current: [] as unknown[] };
  const roomIdentityRef = { current: null as { username: string; userId: string | null; authToken: string | null } | null };
  const youRef = { current: '' };
  const joinedRoomResponseRef = { current: null as unknown };
  const resyncBufferedUpdateRef = { current: { some: 'buffered-update' } as unknown };
  const applyJoinedRoomResponseRef = { current: vi.fn() };

  const runtime = {
    socket: { socketRef },
    session: { sessionRef, dispatchSession },
    controller: { joinFlight: { pendingCreateResolversRef, autoJoinAttemptedRef } },
    room: { maxSequenceRef, roomPlayersRef, roomIdentityRef, youRef, joinedRoomResponseRef },
    recovery: { resyncBufferedUpdateRef, applyJoinedRoomResponseRef },
    gameplay: {},
    registrars: {},
    projection: {},
    tournamentAttach: {},
    destroy: () => undefined,
    // Deliberate partial mock — only the slices useMultiplayerRoomCallbacks reads are real.
  } as unknown as MultiplayerRuntime;

  return { runtime, maxSequenceRef, resyncBufferedUpdateRef, dispatchSession };
}

function makeBaseParams(
  runtime: MultiplayerRuntime,
): UseMultiplayerRoomCallbacksParams {
  return {
    runtime,
    maxEventSequenceRef: { current: 3 },
    roomMatchIdRef: { current: 'match-1' },
    roomOperationEpochRef: { current: 0 },
    shellDelegatesRef: { current: null },
    appModeRef: { current: 'multiplayer' },
    applyRoomEventMetaRef: { current: () => undefined },
    schedulePlayerReadyRef: { current: async () => undefined },
    trySchedulePlayerReadyRef: { current: () => undefined },
    dispatchRecovery: () => undefined,
    setJoinedRoom: () => undefined,
    setRoomCode: () => undefined,
    setYou: () => undefined,
    setPlayers: () => undefined,
    setTournamentMatch: () => undefined,
    setError: () => undefined,
    setOverlayPayload: () => undefined,
    setAppMode: () => undefined,
    showToast: () => undefined,
    shellSetState: () => undefined,
    shellSetLegalMoves: () => undefined,
    shellSetCanDraw: () => undefined,
    shellSetSelectedTile: () => undefined,
    shellSetHandReveal: () => undefined,
    shellSetRematchRequested: () => undefined,
    shellSetRematchReadyIds: () => undefined,
    shellSetActionError: () => undefined,
    authProfile: null,
    authUser: null,
    multiplayerIdentityUserId: null,
    multiplayerAuthToken: null,
    normalizeRoomCode: (v) => (typeof v === 'string' ? v.toUpperCase() : ''),
    clearTournamentAttachRefs: () => undefined,
    applyTournamentMetadataFromJoin: () => undefined,
    tournament: { clearPendingMatch: () => undefined, clearRecoveryMatch: () => undefined },
  };
}

describe('useMultiplayerRoomCallbacks runtime-slice ref identity', () => {
  it('resetClientGameSession writes through the exact runtime-slice ref objects, not copies', () => {
    const fake = makeFakeRuntime();
    const { result } = renderHook(() => useMultiplayerRoomCallbacks(makeBaseParams(fake.runtime)));

    expect(fake.maxSequenceRef.current).toBe(7);
    expect(fake.resyncBufferedUpdateRef.current).not.toBeNull();

    act(() => {
      result.current.resetClientGameSession();
    });

    // These assertions read the *original* fixture-held ref objects, not
    // anything routed back through the hook — proving the hook mutated the
    // same objects the runtime param handed it.
    expect(fake.maxSequenceRef.current).toBe(-1);
    expect(fake.resyncBufferedUpdateRef.current).toBeNull();
    expect(fake.dispatchSession).toHaveBeenCalledWith({ type: 'SESSION_RESET_GAME' });
  });
});
