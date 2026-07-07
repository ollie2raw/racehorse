/**
 * Phase D — join ack coordinator (no recovery machine / resync transport tests).
 */

import type { GameState } from '../types.ts';
import { processJoinAck, type ProcessJoinAckParams } from './joinAckCoordinator.ts';
import type { RoomAckResponse } from './roomTransport.ts';
import { reduceSession } from './session/sessionReducer.ts';
import { INITIAL_SESSION_SNAPSHOT } from './session/sessionTypes.ts';
import type { SessionEvent, SessionSnapshot } from './session/sessionTypes.ts';
import {
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
} from './socketEventBus.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function assertFalse(value: boolean, label: string): void {
  assertEqual(value, false, label);
}

type DispatchEvent = { type: string; roomCode?: string };

function createHarness(overrides: Partial<ProcessJoinAckParams> = {}) {
  const dispatches: DispatchEvent[] = [];
  const sessionEvents: SessionEvent[] = [];
  let joinedRoom: string | null = null;
  let roomCode = '';
  let you = '';
  const players: { id: string }[] = [];
  const sessionRef = { current: INITIAL_SESSION_SNAPSHOT };
  const dispatchSession = (event: SessionEvent) => {
    sessionEvents.push(event);
    sessionRef.current = reduceSession(sessionRef.current, event);
  };
  const joinedRoomResponseRef = { current: null as RoomAckResponse | null };
  const youRef = { current: '' };
  const roomPlayersRef = { current: [] as { id: string }[] };
  const roomIdentityRef = { current: null as ProcessJoinAckParams['roomIdentityRef']['current'] };
  let snapshotApplied = false;
  let snapshotState: GameState | null = null;

  const base: ProcessJoinAckParams = {
    resp: { ok: true, roomCode: 'ABCD', you: 'p1', players: [{ id: 'p1' }] },
    normalizeRoomCode: (value) =>
      typeof value === 'string' ? value.trim().toUpperCase() : '',
    dispatchRecovery: (event) => {
      dispatches.push({
        type: event.type,
        roomCode: 'roomCode' in event ? event.roomCode : undefined,
      });
    },
    applySnapshot: () => {
      snapshotApplied = true;
      snapshotState = {
        playerIds: ['p1', 'p2'],
        players: {
          p1: { id: 'p1', hand: [{ low: 0, high: 1 }], score: 0 },
          p2: { id: 'p2', hand: [], score: 0 },
        },
        handCounts: { p1: 1, p2: 1 },
        sequence: 3,
      } as GameState;
      return { ok: true, nextState: snapshotState };
    },
    applyRoomEventMeta: () => {},
    setJoinedRoom: (code) => {
      joinedRoom = code;
    },
    setRoomCode: (code) => {
      roomCode = code;
    },
    setYou: (value) => {
      you = value;
      youRef.current = value;
    },
    setPlayers: (value) => {
      const next = typeof value === 'function' ? value(players as never) : value;
      players.splice(0, players.length, ...(next as { id: string }[]));
      roomPlayersRef.current = players;
    },
    normalizeRoomPlayers: (value) =>
      Array.isArray(value)
        ? value.filter((p): p is { id: string } => Boolean(p && typeof p.id === 'string'))
        : [],
    sessionRef,
    dispatchSession,
    joinedRoomResponseRef,
    youRef,
    roomPlayersRef,
    roomIdentityRef,
    roomIdentity: { username: 'Guest', userId: null, authToken: null },
    ...overrides,
  };

  return {
    base,
    dispatches,
    sessionEvents,
    sessionRef,
    get joinedRoom() {
      return joinedRoom;
    },
    get roomCode() {
      return roomCode;
    },
    get you() {
      return you;
    },
    get snapshotApplied() {
      return snapshotApplied;
    },
    get snapshotState() {
      return snapshotState;
    },
  };
}

function testValidJoinAppliesSnapshotAndRoom(): void {
  const harness = createHarness();
  const result = processJoinAck(harness.base);

  assertTrue(result.accepted, 'accepted');
  assertEqual(result.roomCode, 'ABCD', 'room code');
  assertEqual(harness.joinedRoom, 'ABCD', 'joined room set');
  assertEqual(harness.roomCode, 'ABCD', 'room code state set');
  assertTrue(harness.snapshotApplied, 'snapshot applied');
  assertEqual(harness.you, 'p1', 'you set');
  assertTrue(
    harness.dispatches.some((e) => e.type === 'ROOM_JOIN_OK'),
    'ROOM_JOIN_OK dispatched',
  );
  assertTrue(
    harness.sessionEvents.some((e) => e.type === 'ROOM_JOIN_OK'),
    'session ROOM_JOIN_OK dispatched',
  );
  assertEqual(harness.sessionRef.current.context.roomCode, 'ABCD', 'session room code');
}

function testProjectionFailureDispatchesResyncNeeded(): void {
  resetSocketEventBusForTests();
  const socketDispatches: DispatchEvent[] = [];
  registerNormalizedSocketRouter({
    resyncNeeded: ({ roomCode }) => {
      socketDispatches.push({ type: 'RESYNC_NEEDED', roomCode });
    },
  });

  const harness = createHarness({
    applySnapshot: () => ({ ok: false, nextState: null }),
    resp: {
      ok: true,
      roomCode: 'PROJ1',
      you: 'p1',
      state: { playerIds: ['p1'] } as GameState,
      players: [{ id: 'p1' }],
    },
  });

  processJoinAck(harness.base);

  assertEqual(socketDispatches.length, 1, 'one RESYNC_NEEDED');
  assertEqual(socketDispatches[0]?.roomCode, 'PROJ1', 'resync room code');
}

function testHandMismatchDispatchesResyncNeeded(): void {
  resetSocketEventBusForTests();
  const socketDispatches: DispatchEvent[] = [];
  registerNormalizedSocketRouter({
    resyncNeeded: ({ roomCode }) => {
      socketDispatches.push({ type: 'RESYNC_NEEDED', roomCode });
    },
  });

  const mismatchState = {
    playerIds: ['p1', 'p2'],
    players: {
      p1: { id: 'p1', hand: [], score: 0 },
      p2: { id: 'p2', hand: [], score: 0 },
    },
    handCounts: { p1: 2, p2: 1 },
    sequence: 4,
  } as GameState;

  const harness = createHarness({
    applySnapshot: () => ({ ok: true, nextState: mismatchState }),
    resp: {
      ok: true,
      roomCode: 'HAND1',
      you: 'p1',
      players: [{ id: 'p1' }],
      matchStarted: true,
    },
  });

  processJoinAck(harness.base);

  assertEqual(socketDispatches.length, 1, 'one RESYNC_NEEDED for hand mismatch');
  assertEqual(socketDispatches[0]?.roomCode, 'HAND1', 'hand mismatch resync room');
}

function testMalformedResponseDoesNotMutateState(): void {
  const harness = createHarness({
    resp: { ok: false, error: 'not_found', roomCode: 'BAD1' },
  });

  const result = processJoinAck(harness.base);

  assertFalse(result.accepted, 'not accepted');
  assertEqual(harness.joinedRoom, null, 'joined room unchanged');
  assertEqual(harness.roomCode, '', 'room code unchanged');
  assertFalse(harness.snapshotApplied, 'snapshot not applied');
  assertEqual(harness.dispatches.length, 0, 'no recovery dispatches');
  assertEqual(harness.base.joinedRoomResponseRef.current, null, 'join response ref untouched');
  assertEqual(harness.sessionEvents.length, 0, 'no session events');
}

function run(): void {
  testValidJoinAppliesSnapshotAndRoom();
  testProjectionFailureDispatchesResyncNeeded();
  testHandMismatchDispatchesResyncNeeded();
  testMalformedResponseDoesNotMutateState();
  console.log('joinAckCoordinator.behaviorTests: all passed');
}

run();