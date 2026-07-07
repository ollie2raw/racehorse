import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode, GameState, Move, Tile } from '../../types';
import type { RoomPlayer, RoomRecoveryState } from '../protocol';
import type { PrivateRoomCreateSettings, RoomAckResponse } from '../roomTransport';
import type { MultiplayerNavigationRuntime } from './navigationRuntime';
import type {
  MultiplayerJoinFlightRuntime,
  MultiplayerRoomActionsTransport,
  MultiplayerRoomRuntime,
} from './roomRuntime';


/** Socket instance refs shared across multiplayer/tournament hooks. */
export type MultiplayerSocketRuntime = {
  socketRef: MutableRefObject<Socket | null>;
  connectRef: MutableRefObject<() => void>;
};

/** Reconnect/backoff and auto-rejoin guard refs. */
export type MultiplayerReconnectRuntime = {
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  rejoinInFlightRef: MutableRefObject<boolean>;
};

/** Auth identity refs used when joining/rejoining rooms. */
export type MultiplayerAuthRuntime = {
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
};

/** Room refs read by useMultiplayerConnection after slice flatten. */
export type MultiplayerConnectionRoomRuntime = Pick<
  MultiplayerRoomRuntime,
  'roomIdentityRef' | 'stateRef' | 'youRef'
>;

/** Reconnect refs read by useMultiplayerConnection after slice flatten. */
export type MultiplayerConnectionReconnectRuntime = Pick<
  MultiplayerReconnectRuntime,
  | 'reconnectRoomCodeRef'
  | 'reconnectShouldJoinRef'
  | 'preventAutoRejoinRef'
  | 'reconnectAttemptTimerRef'
  | 'reconnectAttemptCountRef'
  | 'rejoinInFlightRef'
>;

/** Join-flight refs read by useMultiplayerConnection after slice flatten. */
export type MultiplayerConnectionJoinFlightRuntime = Pick<
  MultiplayerJoinFlightRuntime,
  'pendingCreateOnConnectRef' | 'autoJoinAttemptedRef' | 'autoConnectAttemptedRef'
>;

/** Navigation surface read by useMultiplayerConnection (flatten uses setAppMode only). */
export type MultiplayerConnectionNavigationRuntime = Pick<MultiplayerNavigationRuntime, 'setAppMode'>;

export type MultiplayerConnectionUiSetters = {
  setSocket: Dispatch<SetStateAction<Socket | null>>;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  setIsConnecting: Dispatch<SetStateAction<boolean>>;
  setIsRecoveringConnection: Dispatch<SetStateAction<boolean>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setYou: Dispatch<SetStateAction<string>>;
  setServerWaking: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setActionError: Dispatch<SetStateAction<string>>;
  setRematchRequested: Dispatch<SetStateAction<boolean>>;
  setRematchReadyIds: Dispatch<SetStateAction<string[]>>;
  setOpponentDragging: Dispatch<SetStateAction<boolean>>;
  setJoinedRoom: Dispatch<SetStateAction<string | null>>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  setTournamentActiveRoom: Dispatch<SetStateAction<string | null>>;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setHandReveal: Dispatch<
    SetStateAction<{
      handNumber: number;
      opponentRemainingTiles: Tile[];
      yourRemainingTiles: Tile[];
      pointsAwarded: { you: number; opponent: number };
      whoWentOut?: string | null;
      winnerId?: string | null;
      handWinnerId?: string | null;
    } | null>
  >;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
};

export type MultiplayerConnectionConfig = {
  emitWithAck: MultiplayerRoomActionsTransport['emitWithAck'];
  normalizeRoomCode: (value: unknown) => string;
  lastRoomStorageKey: string;
  serverUrl: string;
  showToast: (message: string, duration?: number) => void;
  emitCreateRoom: (
    targetSocket: Socket,
    settings?: PrivateRoomCreateSettings,
  ) => Promise<RoomAckResponse>;
};

export type MultiplayerConnectionState = {
  socket: Socket | null;
  isConnecting: boolean;
  isConnected: boolean;
  roomRecoveryState: RoomRecoveryState;
  appMode: AppMode;
  authUserId?: string | null;
  authEmail?: string | null;
  authProfileUsername?: string | null;
  authAccessToken?: string | null;
  roomCode: string;
};

/** Live connection surface for MultiplayerModeController — reuses hook connectionState + config. */
export type MultiplayerControllerConnectionBundle = {
  connectionState: MultiplayerConnectionState;
  config: Pick<MultiplayerConnectionConfig, 'serverUrl'>;
  connect: () => void;
  retryRoomRecovery: () => void;
  isRecoveringConnection: boolean;
  serverWaking: boolean;
  roomRecoveryMessage: string;
  setAppMode: MultiplayerNavigationRuntime['setAppMode'];
};