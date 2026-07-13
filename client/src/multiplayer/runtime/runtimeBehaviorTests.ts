import {
  createMultiplayerRuntime,
  getActiveMultiplayerRuntimeForTests,
  resetMultiplayerRuntimeSingletonForTests,
} from './createMultiplayerRuntime';
import type { MultiplayerRuntimeBootstrap } from './runtimeTypes';
import {
  selectLegacyAppSessionRuntime,
  selectRecoveryRuntime,
  selectSessionRuntime,
} from './runtimeSelectors';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

function createBootstrap(): MultiplayerRuntimeBootstrap {
  return {
    socketRef: { current: null },
    connectRef: { current: () => undefined },
    pendingCreateOnConnectRef: { current: false },
    pendingCreateResolversRef: { current: [] },
    autoJoinAttemptedRef: { current: false },
    joinInFlightRef: { current: false },
    createInFlightRef: { current: false },
    inviteJoinInFlightRef: { current: false },
    autoConnectAttemptedRef: { current: false },
    reconnectRoomCodeRef: { current: null },
    reconnectShouldJoinRef: { current: false },
    preventAutoRejoinRef: { current: false },
    reconnectAttemptTimerRef: { current: null },
    reconnectAttemptCountRef: { current: 0 },
    rejoinInFlightRef: { current: false },
    authUserRef: { current: null },
    authProfileRef: { current: null },
    authAccessTokenRef: { current: null },
    multiplayerIdentityUserIdRef: { current: null },
    appModeRef: { current: 'home' },
    setAppMode: () => undefined,
    joinedRoomResponseRef: { current: null },
    roomIdentityRef: { current: null },
    youRef: { current: '' },
    stateRef: { current: null },
    maxSequenceRef: { current: -1 },
    roomPlayersRef: { current: [] },
    applyJoinedRoomResponseRef: { current: () => undefined },
    clearRecoverableRoomStateRef: { current: () => undefined },
    resetMultiplayerRoomStateRef: { current: () => undefined },
    resyncInFlightRef: { current: false },
    roomOperationEpochRef: { current: 0 },
    resyncBufferedUpdateRef: { current: null },
    resyncFlushRef: { current: null },
    rematchAwaitingStateRef: { current: false },
    schedulePlayerReadyRef: { current: async () => undefined },
    trySchedulePlayerReadyRef: { current: () => undefined },
    isMutedRef: { current: false },
    gameplayRefs: {
      draggingStateRef: { current: false },
      handRevealShownRef: { current: null },
      handRevealTimerRef: { current: null },
    },
  };
}

resetMultiplayerRuntimeSingletonForTests();
const bootstrap = createBootstrap();
const runtime = createMultiplayerRuntime(bootstrap);

assertTrue(getActiveMultiplayerRuntimeForTests() === runtime, 'singleton active runtime');
assertEqual(runtime.session.getSnapshot().phase, 'idle', 'session starts idle');

runtime.session.dispatchSession({ type: 'SOCKET_CONNECTED' });
assertEqual(runtime.session.getSnapshot().phase, 'connected', 'session dispatch works');

const legacy = selectLegacyAppSessionRuntime(runtime);
assertTrue(legacy.socketRuntime === runtime.socket, 'legacy socket slice');
assertTrue(selectSessionRuntime(runtime).sessionRef === runtime.session.sessionRef, 'session selector');
assertTrue(
  selectRecoveryRuntime(runtime).resyncInFlightRef === bootstrap.resyncInFlightRef,
  'recovery refs from bootstrap',
);

let duplicateThrown = false;
try {
  createMultiplayerRuntime(bootstrap);
} catch {
  duplicateThrown = true;
}
assertTrue(duplicateThrown, 'duplicate createMultiplayerRuntime throws');

runtime.destroy();
resetMultiplayerRuntimeSingletonForTests();

console.log('runtimeBehaviorTests: all passed');
