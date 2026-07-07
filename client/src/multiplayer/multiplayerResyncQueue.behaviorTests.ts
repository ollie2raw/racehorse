/**
 * Phase B — resync queue behavior (recovery machine + direct-path cooldown contract).
 */

import {
  createRecoveryMachine,
  reduceRecovery,
  type RecoveryEffect,
  type RecoveryMachineSnapshot,
} from './recoveryMachine.ts';

const RESYNC_COOLDOWN_MS = 1200;

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

function countResyncEffects(effects: RecoveryEffect[]): number {
  return effects.filter((e) => e.type === 'resync').length;
}

/** Mirrors useMultiplayerResync direct-path guards (recovery_machine reason). */
function canExecuteDirectResync(
  now: number,
  cooldownUntil: number,
  resyncInFlight: boolean,
  rejoinInFlight: boolean,
  connected: boolean,
): boolean {
  if (!connected) return false;
  if (resyncInFlight || rejoinInFlight) return false;
  if (now < cooldownUntil) return false;
  return true;
}

function testJoiningQueuedIdleOneResync(): void {
  let snapshot = baseSnapshot();
  let effects: RecoveryEffect[] = [];

  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_LOST', roomCode: 'JOIN1' }).snapshot;
  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_CONNECTED' }).snapshot;
  assertEqual(snapshot.state, 'joining', 'joining');

  const queued = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'JOIN1' });
  snapshot = queued.snapshot;
  assertEqual(snapshot.pendingResyncRoomCode, 'JOIN1', 'queued while joining');

  const flushed = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  snapshot = flushed.snapshot;
  effects = flushed.effects;
  assertEqual(snapshot.state, 'resyncing', 'one resync after idle flush');
  assertEqual(countResyncEffects(effects), 1, 'exactly one resync effect');
}

function testReconnectingQueuedIdleOneResync(): void {
  let snapshot = baseSnapshot();
  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_LOST', roomCode: 'RCON1' }).snapshot;
  assertEqual(snapshot.state, 'connecting', 'connecting');

  const queued = reduceRecovery(snapshot, { type: 'RESYNC_NEEDED', roomCode: 'RCON1' });
  snapshot = queued.snapshot;
  assertEqual(snapshot.pendingResyncRoomCode, 'RCON1', 'queued while connecting');

  snapshot = reduceRecovery(snapshot, { type: 'SOCKET_CONNECTED' }).snapshot;
  assertEqual(snapshot.state, 'joining', 'joining after reconnect');

  const flushed = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  assertEqual(flushed.snapshot.state, 'resyncing', 'resync after join ok');
  assertEqual(countResyncEffects(flushed.effects), 1, 'one resync effect');
}

function testTenResyncNeededEventsCoalesceToOnePending(): void {
  let snapshot = baseSnapshot({
    state: 'joining',
    targetRoom: 'COAL',
    attempt: 1,
    episodeId: 1,
  });

  for (let i = 0; i < 10; i += 1) {
    snapshot = reduceRecovery(snapshot, {
      type: 'RESYNC_NEEDED',
      roomCode: 'coal',
    }).snapshot;
  }

  assertEqual(snapshot.pendingResyncRoomCode, 'COAL', 'single coalesced pending room');
  assertEqual(snapshot.state, 'joining', 'still joining');

  const flushed = reduceRecovery(snapshot, { type: 'ROOM_JOIN_OK' });
  assertEqual(countResyncEffects(flushed.effects), 1, 'single flush resync');
  assertEqual(flushed.snapshot.pendingResyncRoomCode, null, 'pending cleared');
}

function testNoDuplicateResyncAfterQueueFlush(): void {
  const effects: RecoveryEffect[] = [];
  const machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => effects.push(effect),
  });

  machine.dispatch({ type: 'SOCKET_LOST', roomCode: 'NODUP' });
  machine.dispatch({ type: 'SOCKET_CONNECTED' });
  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'NODUP' });
  machine.dispatch({ type: 'ROOM_JOIN_OK' });
  assertEqual(countResyncEffects(effects), 1, 'one resync on flush');

  machine.dispatch({ type: 'RESYNC_OK' });
  assertEqual(machine.getSnapshot().state, 'idle', 'idle after resync ok');
  assertEqual(countResyncEffects(effects), 1, 'no second resync without new request');

  machine.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'NODUP' });
  assertEqual(countResyncEffects(effects), 2, 'new request after idle emits once more');
}

function testCooldownSuppressesRepeatedDirectExecution(): void {
  const start = 1_000_000;
  let cooldownUntil = 0;
  let inFlight = false;

  assertEqual(
    canExecuteDirectResync(start, cooldownUntil, inFlight, false, true),
    true,
    'first direct resync allowed',
  );

  inFlight = true;
  assertEqual(
    canExecuteDirectResync(start, cooldownUntil, inFlight, false, true),
    false,
    'blocked while in flight',
  );
  inFlight = false;
  cooldownUntil = start + RESYNC_COOLDOWN_MS;

  assertEqual(
    canExecuteDirectResync(start + 500, cooldownUntil, false, false, true),
    false,
    'blocked during cooldown window',
  );
  assertEqual(
    canExecuteDirectResync(start + RESYNC_COOLDOWN_MS, cooldownUntil, false, false, true),
    true,
    'allowed after cooldown elapses',
  );
}

function run(): void {
  testJoiningQueuedIdleOneResync();
  testReconnectingQueuedIdleOneResync();
  testTenResyncNeededEventsCoalesceToOnePending();
  testNoDuplicateResyncAfterQueueFlush();
  testCooldownSuppressesRepeatedDirectExecution();
  console.log('multiplayerResyncQueue.behaviorTests: all passed');
}

run();