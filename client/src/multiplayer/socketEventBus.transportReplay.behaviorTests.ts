/**
 * Phase H — transport-level replay immunity and cleanup contract.
 */

import {
  dispatchSocketEvent,
  getRawTransportReplayFingerprintCountForTests,
  interpretRawSocketEvent,
  markProcessedTransportEventId,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
  resetTransportReplayRegistry,
  setSocketEpisodeSequenceForTests,
} from './socketEventBus.ts';
import { createRecoveryMachine } from './recoveryMachine.ts';
import {
  shouldDropTransportReplayProjection,
} from './useRoomSocketSync.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function testSocketReplayIdenticalPacketDroppedAfterReconnect(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    stateUpdate: () => {
      handled += 1;
    },
  });

  const payload = { state: { sequence: 42 }, transportId: 'evt-reconnect-1' };
  interpretRawSocketEvent('state:update', payload);
  interpretRawSocketEvent('state:update', payload);

  assertEqual(handled, 1, 'identical raw packet replay dropped');
}

function testDuplicateStateUpdateTransportOnlyOnce(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    stateUpdate: () => {
      handled += 1;
    },
  });

  const payload = { state: { sequence: 7 }, eventId: 'dup-state-7' };
  dispatchSocketEvent({ type: 'STATE_UPDATE', payload });
  dispatchSocketEvent({ type: 'STATE_UPDATE', payload });

  assertEqual(handled, 1, 'duplicate STATE_UPDATE only normalized once');
}

function testRoomJoinOkReplayIgnoredIfProcessed(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      handled += 1;
    },
  });

  const payload = { ok: true as const, roomCode: 'ROOM1', state: { sequence: 3 } };
  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload });
  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload });

  assertEqual(handled, 1, 'processed ROOM_JOIN_OK transport replay ignored');
}

function testSixHundredEventFloodBoundedMemory(): void {
  resetSocketEventBusForTests();
  registerNormalizedSocketRouter({ stateUpdate: () => {} });

  for (let index = 0; index < 600; index += 1) {
    interpretRawSocketEvent('state:update', {
      state: { sequence: index },
      transportId: `flood-${index}`,
    });
  }

  assertEqual(
    getRawTransportReplayFingerprintCountForTests() <= 500,
    true,
    'transport replay registry bounded at 500',
  );
}

function testCrossEpisodeReplayFullyIgnored(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      handled += 1;
    },
  });

  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'ABCD' } });
  dispatchSocketEvent({
    type: 'TRANSPORT_FAIL',
    payload: { reason: 'disconnect', roomCode: 'ABCD' },
  });
  setSocketEpisodeSequenceForTests(3);

  dispatchSocketEvent({
    type: 'ROOM_JOIN_OK',
    payload: { ok: true, roomCode: 'ABCD' },
    episodeSequence: 0,
  });

  assertEqual(handled, 1, 'cross-episode ROOM_JOIN_OK replay ignored');
}

function testProjectionLockDropsProcessedTransportId(): void {
  resetTransportReplayRegistry();
  const transportId = 'STATE_UPDATE:ROOM1:9:evt-9';
  assertEqual(shouldDropTransportReplayProjection(undefined), false, 'missing transport id allowed');
  assertEqual(
    shouldDropTransportReplayProjection(transportId),
    false,
    'first projection pass not blocked',
  );
  markProcessedTransportEventId(transportId);
  assertEqual(
    shouldDropTransportReplayProjection(transportId),
    true,
    'processed transport id dropped before projection',
  );
}

function testRecoveryLeaveResetsTransportRegistry(): void {
  resetSocketEventBusForTests();
  interpretRawSocketEvent('state:update', {
    state: { sequence: 1 },
    transportId: 'leave-reset-1',
  });
  assertEqual(getRawTransportReplayFingerprintCountForTests(), 1, 'registry populated');

  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: () => {},
  });
  machine.dispatch({ type: 'USER_LEAVE' });

  assertEqual(getRawTransportReplayFingerprintCountForTests(), 0, 'registry cleared on teardown');
}

function run(): void {
  testSocketReplayIdenticalPacketDroppedAfterReconnect();
  testDuplicateStateUpdateTransportOnlyOnce();
  testRoomJoinOkReplayIgnoredIfProcessed();
  testSixHundredEventFloodBoundedMemory();
  testCrossEpisodeReplayFullyIgnored();
  testProjectionLockDropsProcessedTransportId();
  testRecoveryLeaveResetsTransportRegistry();
  console.log('socketEventBus.transportReplay.behaviorTests: all passed');
}

run();