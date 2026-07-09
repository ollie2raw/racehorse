import {
  MAX_RECOVERY_ATTEMPTS,
  canEnterJoinOrResync,
  createRecoveryMachine,
  deriveLegacyRoomRecoveryState,
  derivePreventAutoRejoin,
  deriveReconnectRoomCode,
  deriveReconnectShouldJoin,
  formatRecoveryLog,
  isTerminalJoinError,
  reduceRecovery,
  recoveryBackoffMs,
  type RecoveryEffect,
  type RecoveryMachineSnapshot,
} from './recoveryMachine.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
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

function testBackoffCurve(): void {
  assertEqual(recoveryBackoffMs(1), 2250, 'attempt 1 backoff');
  assertEqual(recoveryBackoffMs(8), 7500, 'attempt 8 backoff (max delay)');
}

function testTerminalJoinErrors(): void {
  assertEqual(isTerminalJoinError('Room abandoned'), true, 'abandoned');
  assertEqual(isTerminalJoinError('match_completed'), true, 'match_completed');
  assertEqual(isTerminalJoinError('Room not found'), true, 'not found');
  assertEqual(isTerminalJoinError('timeout'), false, 'timeout transient');
}

function testSocketLostAutoStartsConnecting(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot(), {
    type: 'SOCKET_LOST',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'connecting', 'state');
  assertEqual(snapshot.targetRoom, 'ABCD', 'target room normalized');
  assertEqual(snapshot.attempt, 1, 'attempt reset to 1');
  assertEqual(snapshot.episodeId, 1, 'episode incremented');
  assertEqual(effects.some((e) => e.type === 'schedule'), true, 'schedules retry');
}

function testSocketLostDisabledStaysIdle(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot({ policy: 'disabled' }), {
    type: 'SOCKET_LOST',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(effects.length, 0, 'no effects');
}

function testSocketLostManualOnlyStaysIdleWithTarget(): void {
  const { snapshot } = reduceRecovery(baseSnapshot({ policy: 'manual_only' }), {
    type: 'SOCKET_LOST',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(snapshot.targetRoom, 'ABCD', 'target preserved for manual retry');
}

function testResyncingTrapPolicyDisabledOnConnect(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({
      state: 'connecting',
      policy: 'disabled',
      targetRoom: 'ABCD',
      attempt: 1,
      episodeId: 2,
    }),
    { type: 'SOCKET_CONNECTED' },
  );
  assertEqual(snapshot.state, 'idle', 'must not enter joining/resyncing');
  assertEqual(effects.some((e) => e.type === 'room_join'), false, 'no room join');
  assertEqual(deriveLegacyRoomRecoveryState(snapshot), 'idle', 'legacy UI idle');
}

function testResyncingTrapManualOnlyWithoutRetryOnConnect(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({
      state: 'connecting',
      policy: 'manual_only',
      targetRoom: 'ABCD',
      manualRetry: false,
      attempt: 1,
      episodeId: 1,
    }),
    { type: 'SOCKET_CONNECTED' },
  );
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(effects.some((e) => e.type === 'room_join'), false, 'no join');
  assertEqual(derivePreventAutoRejoin(snapshot), true, 'prevent auto rejoin shim');
}

function testSocketConnectedAutoEntersJoining(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({
      state: 'connecting',
      targetRoom: 'WXYZ',
      attempt: 1,
      episodeId: 1,
    }),
    { type: 'SOCKET_CONNECTED' },
  );
  assertEqual(snapshot.state, 'joining', 'state');
  assertDeepEqual(
    effects.filter((e) => e.type === 'room_join'),
    [{ type: 'room_join', roomCode: 'WXYZ' }],
    'room join effect',
  );
  assertEqual(deriveReconnectShouldJoin(snapshot), true, 'should join shim');
}

function testRoomJoinOkReturnsIdle(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({ state: 'joining', targetRoom: 'ABCD', attempt: 2, episodeId: 3 }),
    { type: 'ROOM_JOIN_OK' },
  );
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(snapshot.attempt, 0, 'attempt reset');
  assertEqual(effects.some((e) => e.type === 'cancel_schedule'), true, 'cancel schedule');
}

function testJoinOkFlushesPendingResyncToResyncing(): void {
  let snapshot = baseSnapshot({ state: 'joining', targetRoom: 'ABCD', attempt: 1, episodeId: 1 });
  snapshot = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'ABCD' }).snapshot;
  const { snapshot: next, effects } = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  assertEqual(next.state, 'resyncing', 'state');
  assertDeepEqual(
    effects.filter((e) => e.type === 'resync'),
    [{ type: 'resync', roomCode: 'ABCD' }],
    'resync effect',
  );
}

function testConnectingJoinOkFlushesPendingResyncToResyncing(): void {
  let snapshot = baseSnapshot({ state: 'connecting', targetRoom: 'ABCD', attempt: 1, episodeId: 1 });
  snapshot = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'ABCD' }).snapshot;
  const { snapshot: next, effects } = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  assertEqual(next.state, 'resyncing', 'state');
  assertDeepEqual(
    effects.filter((e) => e.type === 'resync'),
    [{ type: 'resync', roomCode: 'ABCD' }],
    'resync effect',
  );
}

function testTransportFailRetriesUntilMax(): void {
  let snapshot = baseSnapshot({
    state: 'connecting',
    targetRoom: 'ABCD',
    attempt: 1,
    episodeId: 1,
  });
  for (let i = 1; i < MAX_RECOVERY_ATTEMPTS; i += 1) {
    const result = reduceRecovery(snapshot, { type: 'TRANSPORT_FAIL' });
    snapshot = result.snapshot;
    assertEqual(snapshot.state, 'connecting', `still connecting after fail ${i}`);
    assertEqual(snapshot.attempt, i + 1, `attempt after fail ${i}`);
    assertEqual(result.effects.some((e) => e.type === 'schedule'), true, `schedule after fail ${i}`);
  }
  const exhausted = reduceRecovery(snapshot, { type: 'TRANSPORT_FAIL' });
  assertEqual(exhausted.snapshot.state, 'failed', 'failed after max attempts');
  assertEqual(exhausted.snapshot.policy, 'manual_only', 'policy manual_only after exhaust');
}

function testRoomJoinTerminalClearsRecoverability(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({ state: 'joining', targetRoom: 'ABCD', attempt: 1, episodeId: 1 }),
    { type: 'ROOM_JOIN_TERMINAL', error: 'match abandoned' },
  );
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(snapshot.policy, 'disabled', 'policy disabled');
  assertEqual(snapshot.targetRoom, null, 'target cleared');
  assertEqual(
    effects.some((e) => e.type === 'clear_terminal_room'),
    true,
    'clear terminal room effect',
  );
}

function testUserRetryFromFailed(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({
      state: 'failed',
      policy: 'manual_only',
      targetRoom: 'ABCD',
      attempt: 5,
      episodeId: 4,
    }),
    { type: 'USER_RETRY' },
  );
  assertEqual(snapshot.state, 'connecting', 'state');
  assertEqual(snapshot.attempt, 1, 'attempt reset');
  assertEqual(snapshot.manualRetry, true, 'manual retry flag');
  assertEqual(effects.some((e) => e.type === 'connect'), true, 'connect effect');
}

function testUserLeaveClearsEverything(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({
      state: 'joining',
      targetRoom: 'ABCD',
      attempt: 2,
      episodeId: 2,
    }),
    { type: 'USER_LEAVE' },
  );
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(snapshot.policy, 'disabled', 'policy disabled');
  assertEqual(snapshot.targetRoom, null, 'target cleared');
  assertEqual(effects.some((e) => e.type === 'cancel_schedule'), true, 'timer cancelled');
}

function testResyncNeededWhileConnected(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot({ policy: 'auto' }), {
    type: 'RESYNC_NEEDED',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'resyncing', 'state');
  assertEqual(snapshot.targetRoom, 'ABCD', 'target');
  assertEqual(effects.some((e) => e.type === 'resync'), true, 'resync effect');
}

function testResyncNeededBlockedWhenDisabled(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot({ policy: 'disabled' }), {
    type: 'RESYNC_NEEDED',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(effects.length, 0, 'no resync');
}

function testResyncNeededQueuesWhileNonIdle(): void {
  for (const state of ['connecting', 'joining', 'failed'] as const) {
    const { snapshot, effects } = reduceRecovery(
      baseSnapshot({ state, targetRoom: 'ABCD', attempt: 1, episodeId: 1 }),
      { type: 'RESYNC_NEEDED', roomCode: 'ABCD' },
    );
    assertEqual(snapshot.state, state, `unchanged while ${state}`);
    assertEqual(snapshot.pendingResyncRoomCode, 'ABCD', `queued while ${state}`);
    assertEqual(effects.length, 0, `no immediate resync while ${state}`);
  }
}

function countEffectsOfType(effects: RecoveryEffect[], type: RecoveryEffect['type']): number {
  return effects.filter((e) => e.type === type).length;
}

/** Integration: RESYNC_NEEDED during joining is queued until ROOM_JOIN_OK. */
function testResyncNeededDuringReconnectJoiningIsQueued(): void {
  let snapshot = baseSnapshot();

  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_LOST', roomCode: 'ABCD' }).snapshot;
  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_CONNECTED' }).snapshot;
  assertEqual(snapshot.state, 'joining', 'joining after socket connected');

  const duringJoin = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'ABCD' });
  assertEqual(duringJoin.snapshot.state, 'joining', 'still joining after resync needed');
  assertEqual(duringJoin.snapshot.pendingResyncRoomCode, 'ABCD', 'queued during join');
  assertEqual(countEffectsOfType(duringJoin.effects, 'resync'), 0, 'no resync effect during join');
}

/** Integration: RESYNC_NEEDED while connecting is queued. */
function testResyncNeededWhileConnectingIsQueued(): void {
  const snapshot = baseSnapshot({
    state: 'connecting',
    targetRoom: 'ABCD',
    attempt: 1,
    episodeId: 2,
  });
  const { snapshot: next, effects } = reduceRecovery(snapshot, {
    type: 'RESYNC_NEEDED',
    roomCode: 'ABCD',
  });
  assertEqual(next.state, 'connecting', 'still connecting');
  assertEqual(next.pendingResyncRoomCode, 'ABCD', 'queued while connecting');
  assertEqual(effects.length, 0, 'no immediate effects while connecting');
}

/** Integration: multiple RESYNC_NEEDED events coalesce to one pending room. */
function testMultipleResyncNeededWhileJoiningCoalesce(): void {
  let snapshot = baseSnapshot({
    state: 'joining',
    targetRoom: 'ABCD',
    attempt: 1,
    episodeId: 3,
  });
  let totalResyncEffects = 0;

  for (let i = 0; i < 3; i += 1) {
    const result = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'ABCD' });
    snapshot = result.snapshot;
    totalResyncEffects += countEffectsOfType(result.effects, 'resync');
  }

  assertEqual(snapshot.state, 'joining', 'still joining after triple dispatch');
  assertEqual(snapshot.pendingResyncRoomCode, 'ABCD', 'single coalesced pending room');
  assertEqual(totalResyncEffects, 0, 'no immediate resync effects');
}

/** Integration: after reconnect join completes, the next RESYNC_NEEDED is honored. */
function testResyncNeededAcceptedAfterReconnectJoinOk(): void {
  let snapshot = baseSnapshot({
    state: 'joining',
    targetRoom: 'WXYZ',
    attempt: 1,
    episodeId: 4,
  });

  snapshot = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' }).snapshot;
  assertEqual(snapshot.state, 'idle', 'idle after room join ok');

  const resync = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'WXYZ' });
  assertEqual(resync.snapshot.state, 'resyncing', 'resyncing after idle resync needed');
  assertEqual(countEffectsOfType(resync.effects, 'resync'), 1, 'resync effect emitted');
}

/** Reducer aligns with dispatch: RESYNC_NEEDED while resyncing is ignored. */
function testResyncNeededIgnoredWhileResyncing(): void {
  const snapshot = baseSnapshot({
    state: 'resyncing',
    targetRoom: 'ABCD',
    attempt: 0,
    episodeId: 1,
    lastMessage: 'Syncing game state…',
  });
  const { snapshot: next, effects } = reduceRecovery(snapshot, {
    type: 'RESYNC_NEEDED',
    roomCode: 'ABCD',
  });
  assertEqual(next.state, 'resyncing', 'still resyncing');
  assertEqual(next.pendingResyncRoomCode, null, 'not queued while resyncing');
  assertEqual(effects.length, 0, 'no duplicate resync effect');
}

/** Integration: queued resync flushes once when reconnect join completes. */
function testReconnectEpisodeFlushesQueuedResyncOnJoinOk(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'SOCKET_CONNECTED' });
  assertEqual(machine.getSnapshot().state, 'joining', 'joining mid-reconnect');

  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'ROOM1' });
  assertEqual(machine.getSnapshot().pendingResyncRoomCode, 'ROOM1', 'queued during joining');

  machine.dispatch({ type: 'ROOM_JOIN_OK' });
  assertEqual(machine.getSnapshot().state, 'resyncing', 'flushed to resyncing after join ok');
  assertEqual(machine.getSnapshot().pendingResyncRoomCode, null, 'pending cleared on flush');
  assertEqual(countEffectsOfType(effects, 'resync'), 1, 'single resync effect on flush');
}

function testManualJoinSetsManualRetry(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot({ policy: 'manual_only' }), {
    type: 'MANUAL_JOIN',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'joining', 'state');
  assertEqual(snapshot.manualRetry, true, 'manual retry');
  assertEqual(canEnterJoinOrResync(snapshot), true, 'can enter join');
  assertEqual(effects.some((e) => e.type === 'room_join'), true, 'join emitted');
}

function testSessionSupersededDisablesRecovery(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot({ policy: 'auto' }), {
    type: 'SESSION_SUPERSEDED',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'idle', 'state');
  assertEqual(snapshot.policy, 'disabled', 'policy');
  assertEqual(snapshot.targetRoom, null, 'target');
  assertEqual(effects.some((e) => e.type === 'connect'), false, 'no connect effect');
  assertEqual(
    effects.some((e) => e.type === 'clear_terminal_room' && e.roomCode === 'ABCD'),
    true,
    'clear stored room effect',
  );
}

function testShimDerivations(): void {
  const joining = baseSnapshot({ state: 'joining', targetRoom: 'ABCD', policy: 'auto' });
  assertEqual(deriveReconnectShouldJoin(joining), true, 'should join when joining');
  assertEqual(derivePreventAutoRejoin(joining), false, 'auto policy allows join');
  assertEqual(deriveReconnectRoomCode(joining), 'ABCD', 'room code shim');
  assertEqual(deriveLegacyRoomRecoveryState(joining), 'reconnecting', 'legacy reconnecting');
}

function testMachineSchedulerFiresScheduledRetry(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: {
      schedule(_delayMs, cb) {
        cb();
      },
      cancel() {},
    },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  assertEqual(machine.getSnapshot().state, 'connecting', 'connecting after socket lost');
  assertEqual(effects.some((e) => e.type === 'connect'), true, 'scheduled retry connects');
}

function testMachineLogsEveryTransition(): void {
  const logs: string[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onLog: (entry) => logs.push(formatRecoveryLog(entry)),
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'ROOM1' });
  machine.dispatch({ type: 'SOCKET_CONNECTED' });

  assertEqual(logs.length >= 2, true, 'at least two transition logs');
  assertEqual(logs[0]?.includes('[room:recovery]'), true, 'log prefix');
  assertEqual(logs[0]?.includes('event=SOCKET_LOST'), true, 'socket lost event');
  assertEqual(logs[1]?.includes('event=SOCKET_CONNECTED'), true, 'socket connected event');
}

function run(): void {
  testBackoffCurve();
  testTerminalJoinErrors();
  testSocketLostAutoStartsConnecting();
  testSocketLostDisabledStaysIdle();
  testSocketLostManualOnlyStaysIdleWithTarget();
  testResyncingTrapPolicyDisabledOnConnect();
  testResyncingTrapManualOnlyWithoutRetryOnConnect();
  testSocketConnectedAutoEntersJoining();
  testRoomJoinOkReturnsIdle();
  testJoinOkFlushesPendingResyncToResyncing();
  testConnectingJoinOkFlushesPendingResyncToResyncing();
  testTransportFailRetriesUntilMax();
  testRoomJoinTerminalClearsRecoverability();
  testUserRetryFromFailed();
  testUserLeaveClearsEverything();
  testResyncNeededWhileConnected();
  testResyncNeededBlockedWhenDisabled();
  testResyncNeededQueuesWhileNonIdle();
  testResyncNeededDuringReconnectJoiningIsQueued();
  testResyncNeededWhileConnectingIsQueued();
  testMultipleResyncNeededWhileJoiningCoalesce();
  testResyncNeededAcceptedAfterReconnectJoinOk();
  testResyncNeededIgnoredWhileResyncing();
  testReconnectEpisodeFlushesQueuedResyncOnJoinOk();
  testManualJoinSetsManualRetry();
  testSessionSupersededDisablesRecovery();
  testShimDerivations();
  testMachineSchedulerFiresScheduledRetry();
  testMachineLogsEveryTransition();
  console.log('recoveryMachine.behaviorTests: all passed');
}

run();
