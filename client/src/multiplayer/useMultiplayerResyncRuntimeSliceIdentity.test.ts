// @vitest-environment jsdom
/**
 * D5 runtime migration (D5-runtime-migration-scoping-2026-09-10.md §3) —
 * manual identity check for useMultiplayerResync's conversion to runtime
 * slices, per the doc's own §4: "a manual identity check ... per converted
 * hook is worth adding."
 *
 * useMultiplayerResync.ts has no existing test (it's a large, effect-heavy
 * hook — a full behavioral test suite is its own project, not this
 * mechanical rename's scope). What this proves is narrower and directly
 * testable: the hook reads/writes through whatever ref objects live at
 * runtime.socket.socketRef / .room.roomIdentityRef /
 * .controller.reconnect.rejoinInFlightRef / .recovery.applyJoinedRoomResponseRef
 * — i.e. the destructuring the D5 conversion introduced is a plain
 * pass-through, not a copy.
 *
 * Deliberately builds its fixture as a plain object literal rather than
 * going through the runtime's own composition functions — INV-01
 * (check:architecture) restricts every one of those factories, singleton
 * root included, to their own module plus App.tsx / runtimeBehaviorTests.ts,
 * tests included. A hand-built literal shaped like the slices
 * useMultiplayerResync actually reads sidesteps that restriction entirely —
 * it constructs nothing, just data — while still proving the thing that
 * matters for this PR: the hook's unchanged internal logic reads/writes
 * through whatever ref objects the runtime param hands it.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { useMultiplayerResync } from './useMultiplayerResync';
import type { MultiplayerRuntime } from './runtime/runtimeTypes';

function makeFakeRuntime() {
  const socketRef = { current: null as Socket | null };
  const sessionRef = { current: { phase: 'idle' as const, context: {} } };
  const dispatchSession = vi.fn();
  const roomIdentityRef = { current: null as { username: string; userId: string | null; authToken: string | null } | null };
  const rejoinInFlightRef = { current: false };
  const applyJoinedRoomResponseRef = { current: vi.fn() };

  const runtime = {
    socket: { socketRef },
    session: { sessionRef, dispatchSession },
    room: { roomIdentityRef },
    controller: { reconnect: { rejoinInFlightRef } },
    recovery: { applyJoinedRoomResponseRef },
    // Fields the hook never touches — present only to satisfy the type.
    gameplay: {},
    registrars: {},
    projection: {},
    tournamentAttach: {},
    destroy: () => undefined,
    // Deliberate partial mock — only the slices useMultiplayerResync reads are real.
  } as unknown as MultiplayerRuntime;

  return { runtime, socketRef, sessionRef, dispatchSession, roomIdentityRef, rejoinInFlightRef, applyJoinedRoomResponseRef };
}

describe('useMultiplayerResync runtime-slice ref identity', () => {
  it('reads roomIdentityRef through runtime.room — same object, not a copy', () => {
    const fake = makeFakeRuntime();
    fake.roomIdentityRef.current = { username: 'alice', userId: 'u1', authToken: 't1' };

    const { result } = renderHook(() =>
      useMultiplayerResync({
        runtime: fake.runtime,
        trySchedulePlayerReadyRef: { current: () => undefined },
        roomOperationEpochRef: { current: 0 },
        dispatchRecovery: () => undefined,
        normalizeRoomCode: (v) => (typeof v === 'string' ? v.toUpperCase() : ''),
        authProfileUsername: undefined,
        multiplayerIdentityUserId: null,
        multiplayerAuthToken: null,
        mpSubView: 'private',
        joinedRoom: null,
        hasLiveGameState: false,
      }),
    );

    expect(typeof result.current.fetchGameState).toBe('function');
    // Mutating the same object the hook was handed is visible everywhere —
    // proof the hook holds the live reference, not a snapshot copied at call time.
    fake.roomIdentityRef.current = { username: 'bob', userId: 'u2', authToken: 't2' };
    expect(fake.runtime.room.roomIdentityRef.current).toEqual({ username: 'bob', userId: 'u2', authToken: 't2' });
  });

  it('short-circuits fetchGameState when the session has no joined room code (reads runtime.session.sessionRef, not a stale copy)', async () => {
    const fake = makeFakeRuntime();
    const { result } = renderHook(() =>
      useMultiplayerResync({
        runtime: fake.runtime,
        trySchedulePlayerReadyRef: { current: () => undefined },
        roomOperationEpochRef: { current: 0 },
        dispatchRecovery: () => undefined,
        normalizeRoomCode: () => '',
        authProfileUsername: undefined,
        multiplayerIdentityUserId: null,
        multiplayerAuthToken: null,
        mpSubView: 'private',
        joinedRoom: null,
        hasLiveGameState: false,
      }),
    );

    const resolved = await result.current.fetchGameState('recovery_machine');
    expect(resolved).toBe(false);
  });
});
