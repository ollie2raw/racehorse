/**
 * Phase E — normalized socket event routing (router only).
 */

import {
  dispatchSocketEvent,
  interpretRawSocketEvent,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
} from './socketEventBus.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function testRoomJoinOkRoutesToJoinAckOnly(): void {
  resetSocketEventBusForTests();
  const calls: string[] = [];

  registerNormalizedSocketRouter({
    roomJoinOk: () => calls.push('joinAck'),
    stateUpdate: () => calls.push('stateUpdate'),
    resyncNeeded: () => calls.push('resync'),
    transportFail: () => calls.push('transport'),
    roomJoinTerminal: () => calls.push('terminal'),
  });

  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'ABCD' } });

  assertEqual(calls.length, 1, 'single handler');
  assertEqual(calls[0], 'joinAck', 'join ack only');
}

function testResyncNeededRoutesToRecoveryOnly(): void {
  resetSocketEventBusForTests();
  const calls: string[] = [];

  registerNormalizedSocketRouter({
    roomJoinOk: () => calls.push('joinAck'),
    stateUpdate: () => calls.push('stateUpdate'),
    resyncNeeded: () => calls.push('recovery'),
    transportFail: () => calls.push('transport'),
    roomJoinTerminal: () => calls.push('terminal'),
  });

  dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: 'ROOM1' } });

  assertEqual(calls.length, 1, 'single handler');
  assertEqual(calls[0], 'recovery', 'recovery only');
}

function testStateUpdateRoutesToBufferPipelineOnly(): void {
  resetSocketEventBusForTests();
  const calls: string[] = [];

  registerNormalizedSocketRouter({
    roomJoinOk: () => calls.push('joinAck'),
    stateUpdate: () => calls.push('buffer'),
    resyncNeeded: () => calls.push('resync'),
    transportFail: () => calls.push('transport'),
    roomJoinTerminal: () => calls.push('terminal'),
  });

  interpretRawSocketEvent('state:update', { state: { sequence: 1 } });

  assertEqual(calls.length, 1, 'single handler');
  assertEqual(calls[0], 'buffer', 'state buffer only');
}

function testNoEventReachesMultipleHandlers(): void {
  resetSocketEventBusForTests();
  let joinCount = 0;
  let stateCount = 0;
  let resyncCount = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      joinCount += 1;
    },
    stateUpdate: () => {
      stateCount += 1;
    },
    resyncNeeded: () => {
      resyncCount += 1;
    },
    transportFail: () => {
      joinCount += 1;
    },
    roomJoinTerminal: () => {
      stateCount += 1;
    },
  });

  dispatchSocketEvent({ type: 'TRANSPORT_FAIL', payload: { reason: 'disconnect' } });
  dispatchSocketEvent({ type: 'ROOM_JOIN_TERMINAL', payload: { error: 'abandoned' } });

  assertEqual(joinCount, 1, 'transport only increments transport slot');
  assertEqual(stateCount, 1, 'terminal only increments terminal slot');
  assertEqual(resyncCount, 0, 'resync untouched');
}

function testUnhandledNormalizedEventIsSafeWhenUnrouted(): void {
  resetSocketEventBusForTests();
  let warned = false;
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes('[socketEventBus] unhandled normalized event')) {
      warned = true;
    }
  };

  try {
    dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: 'X' } });
  } finally {
    console.warn = originalWarn;
  }

  if (import.meta.env?.DEV) {
    assertTrue(warned, 'unhandled normalized event warned in DEV');
  } else {
    assertEqual(warned, false, 'unhandled normalized event silent outside DEV');
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function run(): void {
  testRoomJoinOkRoutesToJoinAckOnly();
  testResyncNeededRoutesToRecoveryOnly();
  testStateUpdateRoutesToBufferPipelineOnly();
  testNoEventReachesMultipleHandlers();
  testUnhandledNormalizedEventIsSafeWhenUnrouted();
  console.log('socketEventBus.behaviorTests: all passed');
}

run();