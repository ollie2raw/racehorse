import { useMemo } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';
import type { UseMultiplayerConnectionParams } from './useMultiplayerConnection';
import type { RecoveryEvent, RecoveryMachineSnapshot } from './recoveryMachine';
import type {
  MultiplayerAuthRuntime,
  MultiplayerConnectionConfig,
  MultiplayerConnectionState,
  MultiplayerConnectionUiSetters,
  MultiplayerGameplayRefsRuntime,
  MultiplayerJoinFlightRuntime,
  MultiplayerNavigationRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerRecoveryCallbacksRuntime,
  MultiplayerRoomRuntime,
  MultiplayerRoomSocialRuntime,
  MultiplayerSocketRuntime,
  RoomRecoveryState,
} from './multiplayerRuntime';

type RoomPlayer = { id: string; username: string; userId: string | null };

export type UseMultiplayerConnectionHostParamsSource = {
  emitWithAck: MultiplayerConnectionConfig['emitWithAck'];
  normalizeRoomCode: MultiplayerConnectionConfig['normalizeRoomCode'];
  lastRoomStorageKey: string;
  serverUrl: string;
  showToast: MultiplayerConnectionConfig['showToast'];
  emitCreateRoom: MultiplayerConnectionConfig['emitCreateRoom'];
  socket: Socket | null;
  isConnecting: boolean;
  isConnected: boolean;
  roomRecoveryState: RoomRecoveryState;
  appMode: MultiplayerConnectionState['appMode'];
  authUserId: string | null;
  authEmail: string | null;
  authProfileUsername: string | null;
  tournamentId: string | null;
  tournamentStateStatus: string | null;
  roomCode: string;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  draggingStateRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isMutedRef: MutableRefObject<boolean>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  recoveryDispatchRef?: MutableRefObject<
    (event: RecoveryEvent) => RecoveryMachineSnapshot | null
  >;
  applyJoinedRoomResponse: (resp: unknown) => void;
  fetchGameState: (reason: string) => Promise<boolean>;
  resetClientGameSession: () => void;
  clearReconnectAttemptTimer: () => void;
  clearTransientRoomUi: () => void;
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
  setTournamentId: Dispatch<SetStateAction<string | null>>;
  setTournamentState: Dispatch<SetStateAction<unknown>>;
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

export type UseMultiplayerConnectionHostParamsResult = {
  multiplayerConnectionHostParams: UseMultiplayerConnectionParams;
  multiplayerConnectionConfig: MultiplayerConnectionConfig;
  multiplayerConnectionState: MultiplayerConnectionState;
};

export function useMultiplayerConnectionHostParams(
  source: UseMultiplayerConnectionHostParamsSource,
): UseMultiplayerConnectionHostParamsResult {
  const multiplayerConnectionConfig = useMemo(
    (): MultiplayerConnectionConfig => ({
      emitWithAck: source.emitWithAck,
      normalizeRoomCode: source.normalizeRoomCode,
      lastRoomStorageKey: source.lastRoomStorageKey,
      serverUrl: source.serverUrl,
      showToast: source.showToast,
      emitCreateRoom: source.emitCreateRoom,
    }),
    [
      source.emitCreateRoom,
      source.emitWithAck,
      source.lastRoomStorageKey,
      source.normalizeRoomCode,
      source.serverUrl,
      source.showToast,
    ],
  );

  const multiplayerConnectionState = useMemo(
    (): MultiplayerConnectionState => ({
      socket: source.socket,
      isConnecting: source.isConnecting,
      isConnected: source.isConnected,
      roomRecoveryState: source.roomRecoveryState,
      appMode: source.appMode,
      authUserId: source.authUserId,
      authEmail: source.authEmail,
      authProfileUsername: source.authProfileUsername,
      tournamentId: source.tournamentId,
      tournamentStateStatus: source.tournamentStateStatus,
      roomCode: source.roomCode,
    }),
    [
      source.appMode,
      source.authEmail,
      source.authProfileUsername,
      source.authUserId,
      source.isConnected,
      source.isConnecting,
      source.roomCode,
      source.roomRecoveryState,
      source.socket,
      source.tournamentId,
      source.tournamentStateStatus,
    ],
  );

  const gameplayRefsRuntime = useMemo(
    (): MultiplayerGameplayRefsRuntime & {
      isMutedRef: MutableRefObject<boolean>;
      rematchAwaitingStateRef: MutableRefObject<boolean>;
    } => ({
      draggingStateRef: source.draggingStateRef,
      handRevealShownRef: source.handRevealShownRef,
      handRevealTimerRef: source.handRevealTimerRef,
      isMutedRef: source.isMutedRef,
      rematchAwaitingStateRef: source.rematchAwaitingStateRef,
    }),
    [],
  );

  const connectionRecoveryRuntime = useMemo(
    (): MultiplayerRecoveryCallbacksRuntime => ({
      applyJoinedRoomResponse: source.applyJoinedRoomResponse,
      fetchGameState: source.fetchGameState,
      resetClientGameSession: source.resetClientGameSession,
      clearReconnectAttemptTimer: source.clearReconnectAttemptTimer,
      clearTransientRoomUi: source.clearTransientRoomUi,
      rematchAwaitingStateRef: source.rematchAwaitingStateRef,
    }),
    [
      source.applyJoinedRoomResponse,
      source.clearReconnectAttemptTimer,
      source.clearTransientRoomUi,
      source.fetchGameState,
      source.rematchAwaitingStateRef,
      source.resetClientGameSession,
    ],
  );

  const connectionUiSetters = useMemo(
    (): MultiplayerConnectionUiSetters => ({
      setSocket: source.setSocket,
      setIsConnected: source.setIsConnected,
      setIsConnecting: source.setIsConnecting,
      setIsRecoveringConnection: source.setIsRecoveringConnection,
      setRoomRecoveryState: source.setRoomRecoveryState,
      setRoomRecoveryMessage: source.setRoomRecoveryMessage,
      setYou: source.setYou,
      setServerWaking: source.setServerWaking,
      setError: source.setError,
      setActionError: source.setActionError,
      setRematchRequested: source.setRematchRequested,
      setRematchReadyIds: source.setRematchReadyIds,
      setOpponentDragging: source.setOpponentDragging,
      setJoinedRoom: source.setJoinedRoom,
      setState: source.setState,
      setLegalMoves: source.setLegalMoves,
      setCanDraw: source.setCanDraw,
      setTournamentId: source.setTournamentId,
      setTournamentState: source.setTournamentState,
      setTournamentActiveRoom: source.setTournamentActiveRoom,
      setRoomCode: source.setRoomCode,
      setHandReveal: source.setHandReveal,
      setPlayers: source.setPlayers,
      setSelectedTile: source.setSelectedTile,
      setPendingUiAction: source.setPendingUiAction,
    }),
    [],
  );

  const multiplayerConnectionHostParams = useMemo(
    (): UseMultiplayerConnectionParams => ({
      config: multiplayerConnectionConfig,
      connectionState: multiplayerConnectionState,
      socketRuntime: source.socketRuntime,
      roomRuntime: source.roomRuntime,
      reconnectRuntime: source.reconnectRuntime,
      joinFlightRuntime: source.joinFlightRuntime,
      authRuntime: source.authRuntime,
      navigationRuntime: source.navigationRuntime,
      gameplayRefsRuntime,
      recoveryRuntime: connectionRecoveryRuntime,
      roomSocialRuntime: source.roomSocialRuntime,
      uiSetters: connectionUiSetters,
      recoveryDispatchRef: source.recoveryDispatchRef,
    }),
    [
      multiplayerConnectionConfig,
      multiplayerConnectionState,
      source.authRuntime,
      source.joinFlightRuntime,
      source.navigationRuntime,
      source.reconnectRuntime,
      source.recoveryDispatchRef,
      source.roomRuntime,
      source.roomSocialRuntime,
      source.socketRuntime,
      gameplayRefsRuntime,
      connectionRecoveryRuntime,
      connectionUiSetters,
    ],
  );

  return {
    multiplayerConnectionHostParams,
    multiplayerConnectionConfig,
    multiplayerConnectionState,
  };
}
