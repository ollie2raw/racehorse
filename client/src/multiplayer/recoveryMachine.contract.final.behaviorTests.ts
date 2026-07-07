/**
 * Phase J — recovery machine contract finalization.
 */

import {
  closeRecoveryEpisode,
  createRecoveryMachine,
  reduceRecovery,
  type RecoveryEffect,
  type RecoveryMachineSnapshot,
} from './recoveryMachine.ts';
import {
  clearAllIngressState,
  dispatchSocketEvent,
  getSocketEpisodeProjectionGate,
  getSocketEpisodeSequence,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
  setSocketEpisodeSequenceForTests,
} from './socketEventBus.ts';
import {
  shouldDropClosedEpisodeProjection,
  shouldDropStaleEpisodeStateUpdate,
} from './useRoomSocketSync.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function baseSnapshot(
  overrides: Partial<RecoveryMachineSnapshot> = {},
): RecoveryMachineSnapshot {
  return {
    state: 'idle',
    policy: 'auto',
    targetRoom: null,
    pendingResyncRoomCode: null,
    attempt: 0,
    episodeId: 0,
    manualRetry: false,
    lastMessage: '',
    ...overrides,
  };
}

function countResyncEffects(effects: RecoveryEffect[]): number {
  return effects.filter((effect) => effect.type === 'resync').length;
}

/** 1. RESYNC_OK after USER_LEAVE does NOTHING */
function testResyncOkAfterUserLeaveIsNoOp(): void {
  const leave = reduceRecovery(
    baseSnapshot({
      state: 'resyncing',
      targetRoom: 'ABCD',
      attempt: 2,
      episodeId: 3,
    }),
    { type: 'USER_LEAVE' },
  );
  assertEqual(leave.snapshot.state, 'idle', 'idle after leave');
  assertEqual(leave.snapshot.policy, 'disabled', 'policy disabled after leave');

  const resyncOk = reduceRecovery(leave.snapshot, { type: 'RESYNC_OK' });
  assertEqual(resyncOk.snapshot.state, 'idle', 'still idle');
  assertEqual(resyncOk.effects.length, 0, 'no effects from stale RESYNC_OK');
}

/** 2. pendingResyncRoomCode cannot survive episode closure */
function testPendingCannotSurviveEpisodeClosure(): void {
  const resyncing = baseSnapshot({
    state: 'resyncing',
    targetRoom: 'ROOM1',
    pendingResyncRoomCode: 'ROOM1',
    episodeId: 2,
    attempt: 1,
  });

  const closed = reduceRecovery(resyncing, { type: 'RESYNC_OK' });
  assertEqual(closed.snapshot.pendingResyncRoomCode, null, 'pending cleared on close');
  assertEqual(closed.snapshot.lastEpisodeClosedAt, 2, 'episode marked closed');
  assertEqual(countResyncEffects(closed.effects), 0, 'no chained resync after success close');
}

/** 3. stale state:update after terminal is ignored */
function testStaleStateUpdateAfterTerminalIgnored(): void {
  resetSocketEventBusForTests();
  setSocketEpisodeSequenceForTests(4);

  clearAllIngressState('terminal-reset');
  const gate = getSocketEpisodeProjectionGate();
  assertEqual(gate.isClosed, true, 'gate closed after terminal reset');
  assertEqual(gate.id, 4, 'gate id matches closed episode');

  assertTrue(
    shouldDropClosedEpisodeProjection(gate, 4),
    'state update for closed episode dropped',
  );
  assertEqual(
    shouldDropClosedEpisodeProjection(gate, 5),
    false,
    'different episode not dropped by closure gate alone',
  );
}

/** 4. RESYNC_OK cannot fire twice per episode */
function testResyncOkCannotFireTwicePerEpisode(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ABCD' });
  assertEqual(machine.getSnapshot().state, 'resyncing', 'resyncing');

  machine.dispatch({ type: 'RESYNC_OK' });
  assertEqual(machine.getSnapshot().state, 'idle', 'idle after first RESYNC_OK');
  assertEqual(machine.getSnapshot().lastEpisodeClosedAt, machine.getSnapshot().episodeId, 'episode closed');

  const before = machine.getSnapshot();
  machine.dispatch({ type: 'RESYNC_OK' });
  const after = machine.getSnapshot();
  assertEqual(after.state, before.state, 'state unchanged on second RESYNC_OK');
  assertEqual(after.lastEpisodeClosedAt, before.lastEpisodeClosedAt, 'closure marker unchanged');
  assertEqual(after.episodeId, before.episodeId, 'episode unchanged on second RESYNC_OK');
  assertEqual(countResyncEffects(effects), 1, 'only one resync effect total');
}

/** 5. join → resync → leave → reconnect → no cross-episode replay */
function testJoinResyncLeaveReconnectNoCrossEpisodeReplay(): void {
  resetSocketEventBusForTests();
  const effects: RecoveryEffect[] = [];
  let joinHandled = 0;

  registerNormalizedSocketRouter({
    roomJoinOk: () => {
      joinHandled += 1;
    },
  });

  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  dispatchSocketEvent({ type: 'ROOM_JOIN_OK', payload: { ok: true, roomCode: 'ROOM1' } });
  assertEqual(getSocketEpisodeSequence(), 1, 'socket episode established');

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'SOCKET_CONNECTED' });
  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'ROOM_JOIN_OK' });
  machine.dispatch({ type: 'RESYNC_OK' });

  const resyncCountBeforeReplay = countResyncEffects(effects);
  machine.dispatch({ type: 'USER_LEAVE' });

  const gateAfterLeave = getSocketEpisodeProjectionGate();
  assertEqual(gateAfterLeave.isClosed, true, 'ingress closed after leave');

  dispatchSocketEvent({
    type: 'ROOM_JOIN_OK',
    payload: { ok: true, roomCode: 'ROOM1' },
    episodeSequence: 0,
  });

  assertEqual(joinHandled, 1, 'stale ROOM_JOIN_OK replay ignored after leave');
  assertEqual(
    countResyncEffects(effects),
    resyncCountBeforeReplay,
    'no extra resync cycles from replay',
  );
}

/** 6. queued RESYNC_NEEDED after success is dropped */
function testQueuedResyncNeededAfterSuccessDropped(): void {
  const resyncing = baseSnapshot({
    state: 'resyncing',
    targetRoom: 'ROOM9',
    pendingResyncRoomCode: 'ROOM9',
    episodeId: 5,
    attempt: 0,
  });

  const firstOk = reduceRecovery(resyncing, { type: 'RESYNC_OK' });
  assertEqual(firstOk.snapshot.state, 'idle', 'idle after success');
  assertEqual(firstOk.snapshot.pendingResyncRoomCode, null, 'pending dropped');
  assertEqual(countResyncEffects(firstOk.effects), 0, 'no chained resync from queued pending');

  const secondNeeded = reduceRecovery(firstOk.snapshot, { type: 'RESYNC_NEEDED', roomCode: 'ROOM9' });
  assertEqual(secondNeeded.snapshot.state, 'resyncing', 'new resync only from fresh request');
  assertEqual(countResyncEffects(secondNeeded.effects), 1, 'one resync for new request');
}

/** 7. projection never applies cross-episode snapshot */
function testProjectionNeverAppliesCrossEpisodeSnapshot(): void {
  setSocketEpisodeSequenceForTests(6);
  const currentEpisode = 4;

  assertTrue(
    shouldDropStaleEpisodeStateUpdate(currentEpisode, 3, getSocketEpisodeSequence()),
    'older episode state update dropped',
  );

  clearAllIngressState('terminal-reset');
  const gate = getSocketEpisodeProjectionGate();
  assertTrue(
    shouldDropClosedEpisodeProjection(gate, gate.id),
    'closed-episode snapshot dropped',
  );

  const closed = closeRecoveryEpisode(
    baseSnapshot({ state: 'idle', episodeId: 7, pendingResyncRoomCode: 'X' }),
  );
  assertEqual(closed.lastEpisodeClosedAt, 7, 'recovery episode closure marker set');
  assertEqual(closed.pendingResyncRoomCode, null, 'pending cleared at closure');
}

function run(): void {
  testResyncOkAfterUserLeaveIsNoOp();
  testPendingCannotSurviveEpisodeClosure();
  testStaleStateUpdateAfterTerminalIgnored();
  testResyncOkCannotFireTwicePerEpisode();
  testJoinResyncLeaveReconnectNoCrossEpisodeReplay();
  testQueuedResyncNeededAfterSuccessDropped();
  testProjectionNeverAppliesCrossEpisodeSnapshot();
  console.log('recoveryMachine.contract.final.behaviorTests: all passed');
}

run();