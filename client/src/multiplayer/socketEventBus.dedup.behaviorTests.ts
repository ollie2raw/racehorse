/**
 * Phase F — socket ingestion deduplication and integrity gates.
 */

import {
  createRecoveryMachine,
  reduceRecovery,
  type RecoveryEffect,
} from './recoveryMachine.ts';
import {
  dispatchSocketEvent,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
} from './socketEventBus.ts';
import {
  shouldDropPreProjectionStateReplay,
  STATE_REPLAY_SILENT_DROP_GAP,
} from './useRoomSocketSync.ts';

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

function countEffectsOfType(effects: RecoveryEffect[], type: RecoveryEffect['type']): number {
  return effects.filter((effect) => effect.type === type).length;
}

function testDuplicateRoomJoinOkBurstProcessedOnce(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      handled += 1;
    },
  });

  const payload = { ok: true as const, roomCode: 'ABCD', you: 'p1', state: { sequence: 12 } };

  for (let index = 0; index < 10; index += 1) {
    dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload });
  }

  assertEqual(handled, 1, 'ROOM_JOIN_OK handled once under burst');
}

function testDuplicateResyncNeededBurstDispatchedOnce(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    resyncNeeded: () => {
      handled += 1;
    },
  });

  for (let index = 0; index < 5; index += 1) {
    dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: 'ROOM1' } });
  }

  assertEqual(handled, 1, 'RESYNC_NEEDED routed once within dedup window');
}

function testStateUpdateHighFrequencyStreamNotDropped(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    stateUpdate: () => {
      handled += 1;
    },
  });

  for (let sequence = 1; sequence <= 200; sequence += 1) {
    dispatchSocketEvent({
      type: 'STATE_UPDATE',
      payload: { state: { sequence } },
    });
  }

  assertEqual(handled, 200, 'STATE_UPDATE stream never deduped');
}

function testStaleReplayAfterJoinDroppedBySequenceGate(): void {
  assertTrue(
    shouldDropPreProjectionStateReplay(120, 120 - STATE_REPLAY_SILENT_DROP_GAP - 1),
    'ghost replay below watermark gap is dropped',
  );
  assertFalse(
    shouldDropPreProjectionStateReplay(120, 120 - STATE_REPLAY_SILENT_DROP_GAP),
    'at-gap replay is not silently dropped',
  );
  assertFalse(
    shouldDropPreProjectionStateReplay(120, 118),
    'slightly stale replay remains for reject_stale path',
  );
}

function testRecoveryMachineResyncingReentrySpamIgnored(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });
  assertEqual(machine.getSnapshot().state, 'resyncing', 'entered resyncing');

  const before = machine.getSnapshot();
  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });

  assertEqual(machine.getSnapshot(), before, 'resyncing spam leaves snapshot unchanged');
  assertEqual(countEffectsOfType(effects, 'resync'), 1, 'single resync effect total');
}

function testReducerStillQueuesResyncWhileJoining(): void {
  const { snapshot, effects } = reduceRecovery(
    {
      state: 'joining',
      policy: 'auto',
      targetRoom: 'ABCD',
      pendingResyncRoomCode: null,
      attempt: 1,
      episodeId: 1,
      manualRetry: false,
      lastMessage: '',
    },
    { type: 'RESYNC_NEEDED', roomCode: 'ABCD' },
  );

  assertEqual(snapshot.pendingResyncRoomCode, 'ABCD', 'Phase B queue semantics preserved');
  assertEqual(effects.length, 0, 'no immediate resync while joining');
}

function run(): void {
  testDuplicateRoomJoinOkBurstProcessedOnce();
  testDuplicateResyncNeededBurstDispatchedOnce();
  testStateUpdateHighFrequencyStreamNotDropped();
  testStaleReplayAfterJoinDroppedBySequenceGate();
  testRecoveryMachineResyncingReentrySpamIgnored();
  testReducerStillQueuesResyncWhileJoining();
  console.log('socketEventBus.dedup.behaviorTests: all passed');
}

run();