/**
 * Phase W — background lifecycle resync policy.
 */

import {
  createLifecycleHiddenTracker,
  evaluateLifecycleResumeResync,
  LIFECYCLE_HIDDEN_RESYNC_MS,
  LIFECYCLE_RESYNC_COOLDOWN_MS,
} from './multiplayerLifecycleRecovery.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function baseInput(
  overrides: Partial<Parameters<typeof evaluateLifecycleResumeResync>[0]> = {},
) {
  const now = 1_000_000;
  return {
    now,
    hiddenSinceMs: now - LIFECYCLE_HIDDEN_RESYNC_MS - 1,
    roomCode: 'ABCD',
    matchStarted: true,
    recoveryState: 'idle' as const,
    socketConnected: true,
    resyncInFlight: false,
    rejoinInFlight: false,
    intentionalDisconnect: false,
    lastLifecycleResyncAtMs: 0,
    ...overrides,
  };
}

function testResyncAfterLongHiddenTab(): void {
  const decision = evaluateLifecycleResumeResync(baseInput());
  assertEqual(decision.shouldResync, true, 'long hidden tab requests resync');
  assertEqual(decision.reason, 'hidden_stale', 'hidden_stale reason');
}

function testNoResyncWhenHiddenTooShort(): void {
  const now = 2_000_000;
  const decision = evaluateLifecycleResumeResync(
    baseInput({
      now,
      hiddenSinceMs: now - 5_000,
    }),
  );
  assertEqual(decision.shouldResync, false, 'short hidden skips resync');
  assertEqual(decision.reason, 'hidden_duration_short', 'short hidden reason');
}

function testNoResyncDuringActiveRecovery(): void {
  const decision = evaluateLifecycleResumeResync(
    baseInput({ recoveryState: 'joining' }),
  );
  assertEqual(decision.shouldResync, false, 'active recovery blocks lifecycle resync');
}

function testNoResyncWithinCooldown(): void {
  const now = 3_000_000;
  const decision = evaluateLifecycleResumeResync(
    baseInput({
      now,
      hiddenSinceMs: now - LIFECYCLE_HIDDEN_RESYNC_MS - 1,
      lastLifecycleResyncAtMs: now - LIFECYCLE_RESYNC_COOLDOWN_MS + 1,
    }),
  );
  assertEqual(decision.shouldResync, false, 'cooldown blocks duplicate lifecycle resync');
}

function testHiddenTrackerConsumesOnce(): void {
  const tracker = createLifecycleHiddenTracker();
  tracker.markHidden(100);
  assertEqual(tracker.getHiddenSince(), 100, 'hidden since recorded');
  assertEqual(tracker.consumeHiddenSince(200), 100, 'consume returns hidden since');
  assertEqual(tracker.getHiddenSince(), null, 'hidden since cleared after consume');
}

function run(): void {
  testResyncAfterLongHiddenTab();
  testNoResyncWhenHiddenTooShort();
  testNoResyncDuringActiveRecovery();
  testNoResyncWithinCooldown();
  testHiddenTrackerConsumesOnce();
  console.log('multiplayerLifecycleRecovery.behaviorTests: all passed');
}

run();