/**
 * Phase W — structured multiplayer operational telemetry counters.
 */

import { createRecoveryMachine } from './recoveryMachine.ts';
import {
  getMpTelemetryCountersForTests,
  recordIngressReplayDrop,
  recordResyncRequested,
  resetMpTelemetryForTests,
} from './mpTelemetry.ts';
import { resetSocketEventBusForTests } from './socketEventBus.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function testIngressReplayDropIncrementsCounter(): void {
  resetMpTelemetryForTests();
  recordIngressReplayDrop('STATE_UPDATE', { transportId: 'x' });
  assertEqual(getMpTelemetryCountersForTests().ingressReplayDrop, 1, 'replay drop counted');
}

function testResyncRequestedIncrementsCounter(): void {
  resetMpTelemetryForTests();
  recordResyncRequested('handler_error', { roomCode: 'ROOM1' });
  assertEqual(getMpTelemetryCountersForTests().resyncRequested, 1, 'resync requested counted');
}

function testRecoveryEpisodeStartOnSocketLost(): void {
  resetMpTelemetryForTests();
  resetSocketEventBusForTests();
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
  });
  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  assertEqual(
    getMpTelemetryCountersForTests().recoveryEpisodeStart,
    1,
    'recovery episode start counted',
  );
}

function run(): void {
  testIngressReplayDropIncrementsCounter();
  testResyncRequestedIncrementsCounter();
  testRecoveryEpisodeStartOnSocketLost();
  console.log('mpTelemetry.behaviorTests: all passed');
}

run();