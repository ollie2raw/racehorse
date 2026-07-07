/**
 * Phase W — long-session memory bounds for ingress registries.
 */

import {
  getProcessedTransportEventIdCountForTests,
  markProcessedTransportEventId,
  PROCESSED_TRANSPORT_ID_EVICT_COUNT,
  PROCESSED_TRANSPORT_ID_MAX_SIZE,
  resetSocketEventBusForTests,
  resetTransportReplayRegistry,
} from './socketEventBus.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function testProcessedTransportIdsBoundedAtFiveHundred(): void {
  resetSocketEventBusForTests();
  for (let index = 0; index < 600; index += 1) {
    markProcessedTransportEventId(`processed-transport-${index}`);
  }
  assertTrue(
    getProcessedTransportEventIdCountForTests() <= PROCESSED_TRANSPORT_ID_MAX_SIZE,
    'processed transport ids bounded at 500',
  );
}

function testProcessedTransportIdsEvictsOldest(): void {
  resetSocketEventBusForTests();
  for (let index = 0; index < PROCESSED_TRANSPORT_ID_MAX_SIZE; index += 1) {
    markProcessedTransportEventId(`seed-${index}`);
  }
  const overflow = PROCESSED_TRANSPORT_ID_EVICT_COUNT + 5;
  for (let index = 0; index < overflow; index += 1) {
    markProcessedTransportEventId(`overflow-${index}`);
  }
  assertTrue(
    getProcessedTransportEventIdCountForTests() <= PROCESSED_TRANSPORT_ID_MAX_SIZE,
    'overflow keeps registry bounded',
  );
}

function testResetTransportRegistryClearsProcessedIds(): void {
  resetSocketEventBusForTests();
  markProcessedTransportEventId('clear-me');
  assertEqual(getProcessedTransportEventIdCountForTests(), 1, 'seeded one id');
  resetTransportReplayRegistry();
  assertEqual(getProcessedTransportEventIdCountForTests(), 0, 'registry reset clears processed ids');
}

function run(): void {
  testProcessedTransportIdsBoundedAtFiveHundred();
  testProcessedTransportIdsEvictsOldest();
  testResetTransportRegistryClearsProcessedIds();
  console.log('socketEventBus.memory.behaviorTests: all passed');
}

run();