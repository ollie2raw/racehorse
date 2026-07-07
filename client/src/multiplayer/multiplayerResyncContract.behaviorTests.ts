/**
 * Indirect fetchGameState + recovery machine contract (post Phase B queue).
 */

import {
  createRecoveryMachine,
  reduceRecovery,
  type RecoveryEffect,
  type RecoveryMachineSnapshot,
} from './recoveryMachine.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
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

/** Mirrors indirect fetchGameState: dispatch RESYNC_NEEDED and return true. */
function simulateIndirectFetchGameState(
  dispatch: (event: { type: 'RESYNC_NEEDED'; roomCode: string }) => void,
  roomCode: string,
  _reason: string,
): boolean {
  const normalized = roomCode.trim().toUpperCase();
  if (!normalized) return false;
  dispatch({ type: 'RESYNC_NEEDED', roomCode: normalized });
  return true;
}

function countResyncEffects(effects: RecoveryEffect[]): number {
  return effects.filter((e) => e.type === 'resync').length;
}

function testIndirectPathReturnsTrueAndQueuesWhileJoining(): void {
  let snapshot = baseSnapshot();
  const dispatch = (event: { type: 'RESYNC_NEEDED'; roomCode: string }) => {
    const result = reduceRecovery(snapshot, event);
    snapshot = result.snapshot;
  };

  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_LOST', roomCode: 'ABCD' }).snapshot;
  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_CONNECTED' }).snapshot;
  assertEqual(snapshot.state, 'joining', 'precondition joining');

  const returned = simulateIndirectFetchGameState(dispatch, 'ABCD', 'sequence_regression');
  assertEqual(returned, true, 'indirect path returns true');
  assertEqual(snapshot.state, 'joining', 'still joining');
  assertEqual(snapshot.pendingResyncRoomCode, 'ABCD', 'request queued');
}

function testIndirectPathTriggersResyncImmediatelyFromIdle(): void {
  let snapshot = baseSnapshot({ targetRoom: 'ABCD' });
  const effectsLog: RecoveryEffect[][] = [];

  const dispatch = (event: { type: 'RESYNC_NEEDED'; roomCode: string }) => {
    const result = reduceRecovery(snapshot, event);
    snapshot = result.snapshot;
    effectsLog.push(result.effects);
  };

  simulateIndirectFetchGameState(dispatch, 'ABCD', 'stale_state_update');
  assertEqual(snapshot.state, 'resyncing', 'idle accepts resync immediately');
  assertEqual(countResyncEffects(effectsLog[0] ?? []), 1, 'resync effect emitted from idle');
}

function testDirectRecoveryMachinePathStillBlockedWhileJoining(): void {
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: () => {},
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'SOCKET_CONNECTED' });
  assertEqual(machine.getSnapshot().state, 'joining', 'joining before direct resync');

  const directAllowed = machine.getSnapshot().state === 'idle';
  assertEqual(directAllowed, false, 'recovery_machine path still blocked while joining');
}

function testMultipleIndirectRequestsWhileJoiningCoalesceAndFlush(): void {
  let snapshot = baseSnapshot();
  let resyncEffectCount = 0;

  const dispatch = (event: { type: 'RESYNC_NEEDED'; roomCode: string }) => {
    const result = reduceRecovery(snapshot, event);
    snapshot = result.snapshot;
    resyncEffectCount += countResyncEffects(result.effects);
  };

  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_LOST', roomCode: 'WXYZ' }).snapshot;
  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_CONNECTED' }).snapshot;

  for (const reason of ['sequence_regression', 'stale_state_update', 'hand_identity_mismatch']) {
    simulateIndirectFetchGameState(dispatch, 'WXYZ', reason);
  }

  assertEqual(snapshot.state, 'joining', 'still joining after three indirect requests');
  assertEqual(snapshot.pendingResyncRoomCode, 'WXYZ', 'coalesced pending room');
  assertEqual(resyncEffectCount, 0, 'no immediate resync effects');

  const flushed = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  assertEqual(flushed.snapshot.state, 'resyncing', 'flushed after join ok');
  assertEqual(countResyncEffects(flushed.effects), 1, 'one resync on flush');
}

function testQueuedResyncAfterReconnectJoinCompletes(): void {
  let snapshot = baseSnapshot();
  const dispatch = (event: { type: 'RESYNC_NEEDED'; roomCode: string }) => {
    const result = reduceRecovery(snapshot, event);
    snapshot = result.snapshot;
  };

  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_LOST', roomCode: 'ROOM9' }).snapshot;
  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_CONNECTED' }).snapshot;
  simulateIndirectFetchGameState(dispatch, 'ROOM9', 'sequence_regression');
  assertEqual(snapshot.pendingResyncRoomCode, 'ROOM9', 'queued during join');

  const flushed = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  snapshot = flushed.snapshot;
  assertEqual(snapshot.state, 'resyncing', 'resync flushed after reconnect completes');
  assertEqual(countResyncEffects(flushed.effects), 1, 'resync effect on flush');
}

function run(): void {
  testIndirectPathReturnsTrueAndQueuesWhileJoining();
  testIndirectPathTriggersResyncImmediatelyFromIdle();
  testDirectRecoveryMachinePathStillBlockedWhileJoining();
  testMultipleIndirectRequestsWhileJoiningCoalesceAndFlush();
  testQueuedResyncAfterReconnectJoinCompletes();
  console.log('multiplayerResyncContract.behaviorTests: all passed');
}

run();