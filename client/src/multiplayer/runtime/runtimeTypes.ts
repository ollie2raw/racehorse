import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode, GameState } from '../../types';
import type { RoomAckResponse } from '../roomTransport';
import type { RoomPlayer } from '../protocol';
import type { SessionEvent, SessionSnapshot } from '../session/sessionTypes';
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

/** Imperative session surface — machine owned by composition root, React subscribes via provider. */
export type SessionRuntimeSlice = Readonly<{
  sessionRef: MutableRefObject<SessionSnapshot>;
  dispatchSession: (event: SessionEvent) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SessionSnapshot;
}>;

/** Projection layer ownership marker — behavior frozen in useRoomSocketSync / projection/*. */
export type ProjectionRuntimeSlice = Readonly<{
  owner: 'projection.layer';
  ingress: 'socketEventBus.STATE_UPDATE';
  applyPath: 'multiplayer/projection';
}>;

/** Socket registrar ownership — registration only, no gameplay. */
export type SocketRegistrarRuntimeSlice = Readonly<{
  connectionRegistrar: 'multiplayer/registerMultiplayerConnectionSocketHandlers';
  gameplayRegistrar: 'multiplayer/registerMultiplayerConnectionGameplaySocketHandlers';
  roomSyncRegistrar: 'multiplayer/useRoomSocketSync';
  tournamentRegistrar: 'tournament/registerTournamentSocketHandlers';
}>;

/** Controller-facing bundles consumed by connection + lobby hooks. */
export type ControllerRuntimeSlice = Readonly<{
  socket: MultiplayerSocketRuntime;
  joinFlight: MultiplayerJoinFlightRuntime;
  reconnect: MultiplayerReconnectRuntime;
  auth: MultiplayerAuthRuntime;
  navigation: MultiplayerNavigationRuntime;
}>;

/** External refs and setters supplied by the React application boundary. */
export type MultiplayerRuntimeBootstrap = {
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  pendingCreateResolversRef: MutableRefObject<Array<(code: string | null) => void>>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
  appModeRef: MutableRefObject<AppMode>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  joinedRoomResponseRef: MutableRefObject<RoomAckResponse | null>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  applyJoinedRoomResponseRef: MutableRefObject<(resp: RoomAckResponse) => void>;
  clearRecoverableRoomStateRef: MutableRefObject<() => void>;
  resetMultiplayerRoomStateRef: MutableRefObject<
    (options?: { keepPlayers?: boolean; clearRoomCode?: boolean }) => void
  >;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<import('../protocol').StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  isMutedRef: MutableRefObject<boolean>;
  gameplayRefs: MultiplayerGameplayRefsRuntime;
};

/** Authoritative composed multiplayer runtime — constructed exactly once per app session. */
export type MultiplayerRuntime = Readonly<{
  session: SessionRuntimeSlice;
  recovery: MultiplayerRecoveryRuntime;
  projection: ProjectionRuntimeSlice;
  room: MultiplayerRoomRuntime;
  gameplay: MultiplayerGameplayRefsRuntime;
  socket: MultiplayerSocketRuntime;
  registrars: SocketRegistrarRuntimeSlice;
  controller: ControllerRuntimeSlice;
  tournamentAttach: TournamentAttachRuntime;
  destroy: () => void;
}>;