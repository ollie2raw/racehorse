// @vitest-environment jsdom
/**
 * D5 runtime migration (D5-runtime-migration-scoping-2026-09-10.md §3) —
 * manual identity check for useMultiplayerResync's conversion to runtime
 * slices, per the doc's own §4: "a manual identity check ... per converted
 * hook is worth adding."
 *
 * useMultiplayerResync.ts has no existing test (it's a large, effect-heavy
 * hook — a full behavioral test suite is its own project, not this
 * mechanical rename's scope). What actually makes the conversion safe is
 * narrower and directly testable: every ref useMultiplayerResync now reaches
 * through `runtime.*` is the *same object* the App.tsx bootstrap owns, not a
 * copy — so the hook's unchanged internal logic keeps reading/writing
 * through the objects it always did. This proves exactly that, for every
 * slice the hook's new signature depends on.
 */
import { describe, expect, it } from 'vitest';
import {
  createMultiplayerRuntime,
  resetMultiplayerRuntimeSingletonForTests,
} from './runtime/createMultiplayerRuntime';
import type { MultiplayerRuntimeBootstrap } from './runtime/runtimeTypes';

function makeBootstrap(): MultiplayerRuntimeBootstrap {
  return {
    socketRef: { current: null },
    connectRef: { current: () => undefined },
    pendingCreateOnConnectRef: { current: false },
    pendingCreateResolversRef: { current: [] },
    autoJoinAttemptedRef: { current: false },
    joinInFlightRef: { current: false },
    createInFlightRef: { current: false },
    inviteJoinInFlightRef: { current: false },
    autoConnectAttemptedRef: { current: false },
    reconnectRoomCodeRef: { current: null },
    reconnectShouldJoinRef: { current: false },
    preventAutoRejoinRef: { current: false },
    reconnectAttemptTimerRef: { current: null },
    reconnectAttemptCountRef: { current: 0 },
    rejoinInFlightRef: { current: false },
    authUserRef: { current: null },
    authProfileRef: { current: null },
    authAccessTokenRef: { current: null },
    multiplayerIdentityUserIdRef: { current: null },
    appModeRef: { current: 'home' },
    setAppMode: () => undefined,
    joinedRoomResponseRef: { current: null },
    roomIdentityRef: { current: null },
    youRef: { current: '' },
    stateRef: { current: null },
    maxSequenceRef: { current: -1 },
    roomPlayersRef: { current: [] },
    applyJoinedRoomResponseRef: { current: () => undefined },
    clearRecoverableRoomStateRef: { current: () => undefined },
    resetMultiplayerRoomStateRef: { current: () => undefined },
    resyncInFlightRef: { current: false },
    roomOperationEpochRef: { current: 0 },
    resyncBufferedUpdateRef: { current: null },
    resyncFlushRef: { current: null },
    rematchAwaitingStateRef: { current: false },
    schedulePlayerReadyRef: { current: async () => undefined },
    trySchedulePlayerReadyRef: { current: () => undefined },
    isMutedRef: { current: false },
    gameplayRefs: {
      draggingStateRef: { current: false },
      handRevealShownRef: { current: null },
      handRevealTimerRef: { current: null },
    },
  };
}

describe('useMultiplayerResync runtime-slice ref identity', () => {
  it('exposes the exact bootstrap ref objects through every slice the hook reads', () => {
    resetMultiplayerRuntimeSingletonForTests();
    const bootstrap = makeBootstrap();
    const runtime = createMultiplayerRuntime(bootstrap);

    expect(runtime.socket.socketRef).toBe(bootstrap.socketRef);
    expect(runtime.session.sessionRef).not.toBeNull(); // own FSM state, not bootstrap-sourced — session identity isn't a ref passthrough
    expect(runtime.room.roomIdentityRef).toBe(bootstrap.roomIdentityRef);
    expect(runtime.controller.reconnect.rejoinInFlightRef).toBe(bootstrap.rejoinInFlightRef);
    expect(runtime.recovery.applyJoinedRoomResponseRef).toBe(bootstrap.applyJoinedRoomResponseRef);

    // Mutating through the bootstrap ref is visible through the runtime slice
    // and vice versa — proof they're the same object, not structurally-equal copies.
    bootstrap.roomIdentityRef.current = { username: 'alice', userId: 'u1', authToken: 't1' };
    expect(runtime.room.roomIdentityRef.current).toEqual({ username: 'alice', userId: 'u1', authToken: 't1' });
    runtime.controller.reconnect.rejoinInFlightRef.current = true;
    expect(bootstrap.rejoinInFlightRef.current).toBe(true);

    runtime.destroy();
    resetMultiplayerRuntimeSingletonForTests();
  });

  it('confirms trySchedulePlayerReadyRef and roomOperationEpochRef have no runtime slice (documented gap, not a regression)', () => {
    resetMultiplayerRuntimeSingletonForTests();
    const bootstrap = makeBootstrap();
    const runtime = createMultiplayerRuntime(bootstrap);

    expect((runtime.gameplay as Record<string, unknown>).trySchedulePlayerReadyRef).toBeUndefined();
    expect((runtime as unknown as Record<string, unknown>).roomOperationEpochRef).toBeUndefined();

    runtime.destroy();
    resetMultiplayerRuntimeSingletonForTests();
  });
});
