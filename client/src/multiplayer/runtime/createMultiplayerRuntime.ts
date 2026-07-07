import {
  createAuthRuntime,
  createControllerRuntime,
  createGameplayRuntime,
  createJoinFlightRuntime,
  createNavigationRuntime,
  createProjectionRuntime,
  createReconnectRuntime,
  createRecoveryRuntime,
  createRoomRuntime,
  createSessionRuntime,
  createSocketRegistrarRuntime,
  createSocketRuntime,
  createTournamentAttachRuntime,
} from './runtimeComposition';
import type { MultiplayerRuntime, MultiplayerRuntimeBootstrap } from './runtimeTypes';

let activeRuntime: MultiplayerRuntime | null = null;

/**
 * Authoritative multiplayer runtime composition root.
 * Constructs every subsystem slice exactly once — no nested runtime construction.
 */
export function createMultiplayerRuntime(bootstrap: MultiplayerRuntimeBootstrap): MultiplayerRuntime {
  if (activeRuntime) {
    throw new Error(
      '[multiplayer-runtime] createMultiplayerRuntime called more than once — runtime is singleton per app session',
    );
  }

  const session = createSessionRuntime();
  const recovery = createRecoveryRuntime(bootstrap);
  const projection = createProjectionRuntime();
  const room = createRoomRuntime(bootstrap);
  const gameplay = createGameplayRuntime(bootstrap);
  const socket = createSocketRuntime(bootstrap);
  const registrars = createSocketRegistrarRuntime();
  const joinFlight = createJoinFlightRuntime(bootstrap);
  const reconnect = createReconnectRuntime(bootstrap);
  const auth = createAuthRuntime(bootstrap);
  const navigation = createNavigationRuntime(bootstrap);
  const controller = createControllerRuntime({
    socket,
    joinFlight,
    reconnect,
    auth,
    navigation,
  });
  const tournamentAttach = createTournamentAttachRuntime({
    bootstrap,
    socket,
    navigation,
    recovery,
    session,
  });

  const runtime: MultiplayerRuntime = Object.freeze({
    session,
    recovery,
    projection,
    room,
    gameplay,
    socket,
    registrars,
    controller,
    tournamentAttach,
    destroy: () => {
      activeRuntime = null;
    },
  });

  activeRuntime = runtime;
  return runtime;
}

/** Test-only reset — not for production use outside behavior tests. */
export function resetMultiplayerRuntimeSingletonForTests(): void {
  activeRuntime = null;
}

export function getActiveMultiplayerRuntimeForTests(): MultiplayerRuntime | null {
  return activeRuntime;
}