import type { MultiplayerSessionStateRuntime } from '../session/sessionRuntimeTypes';
import type { MultiplayerRuntime } from './runtimeTypes';
import type {
  MultiplayerAuthRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerSocketRuntime,
} from './connectionRuntime';
import type { MultiplayerGameplayRefsRuntime } from './gameplayRuntime';
import type { MultiplayerNavigationRuntime } from './navigationRuntime';
import type { MultiplayerJoinFlightRuntime, MultiplayerRoomRuntime } from './roomRuntime';
import type { MultiplayerRecoveryRuntime } from './recoveryRuntime';
import type { TournamentAttachRuntime } from './tournamentRuntime';

export function selectSessionRuntime(runtime: MultiplayerRuntime): MultiplayerSessionStateRuntime {
  return {
    sessionRef: runtime.session.sessionRef,
    dispatchSession: runtime.session.dispatchSession,
  };
}

export function selectRecoveryRuntime(runtime: MultiplayerRuntime): MultiplayerRecoveryRuntime {
  return runtime.recovery;
}

export function selectRoomRuntime(runtime: MultiplayerRuntime): MultiplayerRoomRuntime {
  return runtime.room;
}

export function selectGameplayRuntime(runtime: MultiplayerRuntime): MultiplayerGameplayRefsRuntime {
  return runtime.gameplay;
}

export function selectSocketRuntime(runtime: MultiplayerRuntime): MultiplayerSocketRuntime {
  return runtime.socket;
}

export function selectJoinFlightRuntime(runtime: MultiplayerRuntime): MultiplayerJoinFlightRuntime {
  return runtime.controller.joinFlight;
}

export function selectReconnectRuntime(runtime: MultiplayerRuntime): MultiplayerReconnectRuntime {
  return runtime.controller.reconnect;
}

export function selectAuthRuntime(runtime: MultiplayerRuntime): MultiplayerAuthRuntime {
  return runtime.controller.auth;
}

export function selectNavigationRuntime(runtime: MultiplayerRuntime): MultiplayerNavigationRuntime {
  return runtime.controller.navigation;
}

export function selectTournamentAttachRuntime(runtime: MultiplayerRuntime): TournamentAttachRuntime {
  return runtime.tournamentAttach;
}

/** Legacy useAppSessionRuntime shape — selectors only, no construction. */
export function selectLegacyAppSessionRuntime(runtime: MultiplayerRuntime) {
  return {
    socketRuntime: selectSocketRuntime(runtime),
    joinFlightRuntime: selectJoinFlightRuntime(runtime),
    reconnectRuntime: selectReconnectRuntime(runtime),
    authRuntime: selectAuthRuntime(runtime),
    navigationRuntime: selectNavigationRuntime(runtime),
    roomRuntime: selectRoomRuntime(runtime),
    sessionRuntime: selectSessionRuntime(runtime),
    tournamentAttachRuntime: selectTournamentAttachRuntime(runtime),
  };
}