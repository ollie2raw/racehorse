/**
 * Phase G — cross-layer episode ordering and re-entrancy collapse.
 */

import {
  createRecoveryMachine,
  reduceRecovery,
  type RecoveryEffect,
} from './recoveryMachine.ts';
import {
  dispatchSocketEvent,
  getSocketEpisodeSequence,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
  setSocketEpisodeSequenceForTests,
} from './socketEventBus.ts';
import {
  nextEpisodeSequenceCursor,
  shouldDropStaleEpisodeStateUpdate,
} from './useRoomSocketSync.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function countEffectsOfType(effects: RecoveryEffect[], type: RecoveryEffect['type']): number {
  return effects.filter((effect) => effect.type === type).length;
}

function testJoinDisconnectOldRoomJoinOkReplayIgnored(): void {
  resetSocketEventBusForTests();
  let handled = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      handled += 1;
    },
  });

  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'ABCD' } });
  assertEqual(handled, 1, 'initial join handled');
  assertEqual(getSocketEpisodeSequence(), 1, 'episode advanced after join');

  dispatchSocketEvent({
    type: 'TRANSPORT_FAIL',
    payload: { reason: 'disconnect', roomCode: 'ABCD' },
  });
  assertEqual(getSocketEpisodeSequence(), 2, 'episode advanced after transport fail');

  dispatchSocketEvent({
    type: 'ROOM_JOIN_OK',
    payload: { ok: true, roomCode: 'ABCD' },
    episodeSequence: 0,
  });

  assertEqual(handled, 1, 'stale ROOM_JOIN_OK replay ignored');
}

function testResyncPendingFromOldEpisodeNotFlushed(): void {
  const snapshot = {
    state: 'joining' as const,
    policy: 'auto' as const,
    targetRoom: 'ABCD',
    pendingResyncRoomCode: 'ABCD',
    attempt: 1,
    episodeId: 2,
    manualRetry: false,
    lastMessage: '',
  };

  const result = reduceRecovery(snapshot, {
    type: 'ROOM_JOIN_OK',
    episodeSequence: 1,
  });

  assertEqual(result.snapshot.state, 'idle', 'stale join settles idle');
  assertEqual(result.snapshot.pendingResyncRoomCode, null, 'stale pending not flushed');
  assertEqual(countEffectsOfType(result.effects, 'resync'), 0, 'no resync effect from stale flush');
}

function testStateUpdateFromPreviousSocketDropped(): void {
  setSocketEpisodeSequenceForTests(3);
  const currentEpisode = 2;

  assertTrue(
    shouldDropStaleEpisodeStateUpdate(currentEpisode, 1, getSocketEpisodeSequence()),
    'previous-socket STATE_UPDATE dropped by episode gate',
  );
}

function testReconnectResetsEpisodeCounters(): void {
  resetSocketEventBusForTests();
  let transportHandled = 0;

  registerNormalizedSocketRouter({
    transportFail: () => {
      transportHandled += 1;
    },
  });

  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'ROOM1' } });
  const afterJoin = getSocketEpisodeSequence();

  dispatchSocketEvent({
    type: 'TRANSPORT_FAIL',
    payload: { reason: 'disconnect', roomCode: 'ROOM1' },
  });

  assertEqual(getSocketEpisodeSequence(), afterJoin + 1, 'reconnect boundary advanced episode');
  assertEqual(transportHandled, 1, 'transport fail consumed once');
}

function testRapidReconnectSpamNoCrossEpisodeLeakage(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  const before = machine.getSnapshot();

  for (let index = 0; index < 5; index += 1) {
    machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1', episodeSequence: 0 });
  }

  assertEqual(machine.getSnapshot(), before, 'rapid reconnect spam does not mutate episode');
  assertEqual(countEffectsOfType(effects, 'resync'), 0, 'no cross-episode resync leakage');
}

function testPhaseBQueueSurvivesInsideSameEpisode(): void {
  const joining = {
    state: 'joining' as const,
    policy: 'auto' as const,
    targetRoom: 'ABCD',
    pendingResyncRoomCode: 'ABCD',
    attempt: 1,
    episodeId: 1,
    manualRetry: false,
    lastMessage: '',
  };

  const result = reduceRecovery(joining, { type: 'ROOM_JOIN_OK' });

  assertEqual(result.snapshot.state, 'resyncing', 'same-episode pending still flushes');
  assertEqual(result.snapshot.pendingResyncRoomCode, null, 'pending consumed on flush');
  assertEqual(countEffectsOfType(result.effects, 'resync'), 1, 'resync effect emitted');
}

function testRecoveryMachineIgnoresStaleResyncNeeded(): void {
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: () => {},
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  assertEqual(machine.getSnapshot().episodeId, 1, 'reconnect episode started');

  const before = machine.getSnapshot();
  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1', episodeSequence: 0 });

  assertEqual(machine.getSnapshot(), before, 'stale RESYNC_NEEDED ignored at dispatch barrier');
}

function testEpisodeCursorAdvancesOnValidStateUpdate(): void {
  const next = nextEpisodeSequenceCursor(2, 3, 4);
  assertEqual(next, 4, 'episode cursor tracks bus + incoming');
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function run(): void {
  testJoinDisconnectOldRoomJoinOkReplayIgnored();
  testResyncPendingFromOldEpisodeNotFlushed();
  testStateUpdateFromPreviousSocketDropped();
  testReconnectResetsEpisodeCounters();
  testRapidReconnectSpamNoCrossEpisodeLeakage();
  testPhaseBQueueSurvivesInsideSameEpisode();
  testRecoveryMachineIgnoresStaleResyncNeeded();
  testEpisodeCursorAdvancesOnValidStateUpdate();
  console.log('socketEventBus.episodeOrdering.behaviorTests: all passed');
}

run();