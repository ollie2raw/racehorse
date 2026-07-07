/**
 * Phase I — concurrency stabilization and single-source dispatch lock.
 */

import {
  createRecoveryMachine,
  reduceRecovery,
  resetRecoveryConcurrencyStateForTests,
  type RecoveryEffect,
} from './recoveryMachine.ts';
import {
  dispatchSocketEvent,
  getSocketDispatchQueueLengthForTests,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
} from './socketEventBus.ts';
import { shouldDropStaleProjectionCommit } from './useRoomSocketSync.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function countEffectsOfType(effects: RecoveryEffect[], type: RecoveryEffect['type']): number {
  return effects.filter((effect) => effect.type === type).length;
}

function testRapidRoomJoinOkBurstSingleProcessed(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      handled += 1;
    },
  });

  for (let index = 0; index < 10; index += 1) {
    dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'ROOM1' } });
  }

  assertEqual(handled, 1, 'rapid ROOM_JOIN_OK burst processed once');
}

function testResyncAndStateUpdateInterleavingNoDoubleResync(): void {
  resetSocketEventBusForTests();
  let resyncDispatched = 0;
  let stateHandled = 0;

  registerNormalizedSocketRouter({
    resyncNeeded: () => {
      resyncDispatched += 1;
    },
    stateUpdate: () => {
      stateHandled += 1;
    },
  });

  dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: 'ROOM1' } });
  dispatchSocketEvent({ type: 'STATE_UPDATE', payload: { state: { sequence: 1 } } });
  dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: 'ROOM1' } });

  assertEqual(resyncDispatched, 1, 'duplicate interleaved resync collapsed');
  assertEqual(stateHandled, 1, 'state update processed once');
  assertEqual(getSocketDispatchQueueLengthForTests(), 0, 'dispatch queue drained');
}

async function testAsyncMicrotaskRaceNoStaleOverwrite(): Promise<void> {
  resetSocketEventBusForTests();
  const order: string[] = [];

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      order.push('join');
    },
    stateUpdate: () => {
      order.push('state');
    },
  });

  const first = Promise.resolve().then(() => {
    dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'A' } });
  });
  const second = Promise.resolve().then(() => {
    dispatchSocketEvent({ type: 'STATE_UPDATE', payload: { state: { sequence: 2 } } });
  });

  await Promise.all([first, second]);

  assertEqual(order.length, 2, 'both events processed');
  assertEqual(order[0], 'join', 'join serialized before state');
  assertEqual(order[1], 'state', 'state follows join');
}

function testReducerReentryDuringDispatchIgnored(): void {
  resetRecoveryConcurrencyStateForTests();

  const locked = {
    state: 'joining' as const,
    policy: 'auto' as const,
    targetRoom: 'ROOM1',
    pendingResyncRoomCode: null,
    attempt: 1,
    episodeId: 1,
    manualRetry: false,
    lastMessage: '',
    _transitionLock: true,
  };

  const blocked = reduceRecovery(locked, { type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });
  assertEqual(blocked.effects.length, 0, 'locked reducer re-entry ignored');
  assertEqual(blocked.snapshot._transitionLock, false, 'transition lock released');
}

function testProjectionCommitOverwriteDropped(): void {
  const first = Symbol('first');
  const second = Symbol('second');
  let current: symbol | null = first;

  assertFalse(shouldDropStaleProjectionCommit(current, first), 'active commit applies');
  current = second;
  assertTrue(
    shouldDropStaleProjectionCommit(current, first),
    'stale commit dropped before projection',
  );
}

function assertFalse(value: boolean, label: string): void {
  assertEqual(value, false, label);
}

function testDispatchEpochDropsStaleEffects(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });
  assertEqual(countEffectsOfType(effects, 'resync'), 1, 'first dispatch emits resync');
  assertEqual(machine.getSnapshot().state, 'resyncing', 'machine resyncing');

  machine.dispatch({ type: 'RESYNC_OK' });
  assertEqual(machine.getSnapshot().state, 'idle', 'resync completes');
}

async function run(): Promise<void> {
  testRapidRoomJoinOkBurstSingleProcessed();
  testResyncAndStateUpdateInterleavingNoDoubleResync();
  await testAsyncMicrotaskRaceNoStaleOverwrite();
  testReducerReentryDuringDispatchIgnored();
  testProjectionCommitOverwriteDropped();
  testDispatchEpochDropsStaleEffects();
  console.log('socketEventBus.concurrency.behaviorTests: all passed');
}

void run();