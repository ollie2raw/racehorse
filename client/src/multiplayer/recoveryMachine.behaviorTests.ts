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

function testRoomJoinOkNeedsResync(): void {
  const { snapshot, effects } = reduceRecovery(
    baseSnapshot({ state: 'joining', targetRoom: 'ABCD', attempt: 1, episodeId: 1 }),
    { type: 'ROOM_JOIN_OK', needsResync: true },
  );
  assertEqual(snapshot.state, 'resyncing', 'state');
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

function testResyncNeededOnlyFromIdle(): void {
  for (const state of ['connecting', 'joining', 'resyncing', 'failed'] as const) {
    const { snapshot, effects } = reduceRecovery(
      baseSnapshot({ state, targetRoom: 'ABCD', attempt: 1, episodeId: 1 }),
      { type: 'RESYNC_NEEDED', roomCode: 'ABCD' },
    );
    assertEqual(snapshot.state, state, `unchanged while ${state}`);
    assertEqual(effects.length, 0, `no resync while ${state}`);
  }
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

function testSessionSupersededAutoReconnect(): void {
  const { snapshot, effects } = reduceRecovery(baseSnapshot({ policy: 'auto' }), {
    type: 'SESSION_SUPERSEDED',
    roomCode: 'abcd',
  });
  assertEqual(snapshot.state, 'connecting', 'state');
  assertEqual(snapshot.targetRoom, 'ABCD', 'target');
  assertEqual(effects.some((e) => e.type === 'connect'), true, 'connect effect');
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
  testRoomJoinOkNeedsResync();
  testTransportFailRetriesUntilMax();
  testRoomJoinTerminalClearsRecoverability();
  testUserRetryFromFailed();
  testUserLeaveClearsEverything();
  testResyncNeededWhileConnected();
  testResyncNeededBlockedWhenDisabled();
  testResyncNeededOnlyFromIdle();
  testManualJoinSetsManualRetry();
  testSessionSupersededAutoReconnect();
  testShimDerivations();
  testMachineSchedulerFiresScheduledRetry();
  testMachineLogsEveryTransition();
  console.log('recoveryMachine.behaviorTests: all passed');
}

run();
