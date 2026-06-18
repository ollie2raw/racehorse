import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RoomChatEvent, RoomEmoteEvent } from '../components/RoomReactions';
import { traceSocketEvent } from '../debug/socketTrace';
import { playBlockedSound, playHandLoseSound, playHandWinSound } from '../utils/sound';
import type { GameState, Move, Tile } from '../types';
import { wrapSocketHandler } from './socketGuards';
import { emitRoomAbandonMatch, emitRoomLeave, type RoomAckResponse } from './roomTransport';
import type {
  GameRematchStatusPayload,
  LegacyTournamentState,
  TournamentLobbyUpdatePayload,
  TournamentMatchAssignedPayload,
} from './legacyTournamentTypes';
import { syncRecoveryLegacyRefs } from './recoveryConnectionBridge';
import {
  createRecoveryMachine,
  isTerminalJoinError,
  type RecoveryEffect,
  type RecoveryEvent,
  type RecoveryMachine,
  type RecoveryMachineSnapshot,
} from './recoveryMachine';
import type {
  MultiplayerAuthRuntime,
  MultiplayerConnectionConfig,
  MultiplayerConnectionState,
  MultiplayerConnectionUiSetters,
  MultiplayerGameplayRefsRuntime,
  MultiplayerJoinFlightRuntime,
  MultiplayerNavigationRuntime,
  MultiplayerRecoveryCallbacksRuntime,
  MultiplayerReconnectRuntime,
  MultiplayerRoomRuntime,
  MultiplayerRoomSocialRuntime,
  MultiplayerSocketRuntime,
  RoomPlayer,
  RoomRecoveryState,
} from './multiplayerRuntime';

type SocketWithPing = Socket & { __mpPingTimer?: ReturnType<typeof setInterval> };

type HandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

export type UseMultiplayerConnectionParams = {
  config: MultiplayerConnectionConfig;
  connectionState: MultiplayerConnectionState;
  socketRuntime: MultiplayerSocketRuntime;
  roomRuntime: MultiplayerRoomRuntime;
  reconnectRuntime: MultiplayerReconnectRuntime;
  joinFlightRuntime: MultiplayerJoinFlightRuntime;
  authRuntime: MultiplayerAuthRuntime;
  navigationRuntime: MultiplayerNavigationRuntime;
  gameplayRefsRuntime: MultiplayerGameplayRefsRuntime & {
    isMutedRef: MutableRefObject<boolean>;
    rematchAwaitingStateRef: MutableRefObject<boolean>;
  };
  recoveryRuntime: MultiplayerRecoveryCallbacksRuntime;
  roomSocialRuntime: MultiplayerRoomSocialRuntime;
  uiSetters: MultiplayerConnectionUiSetters;
  recoveryDispatchRef?: MutableRefObject<(event: RecoveryEvent) => RecoveryMachineSnapshot | null>;
};

type FlatMultiplayerConnectionParams = {
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
  authUserId?: string | null;
  authEmail?: string | null;
  authProfileUsername?: string | null;
  tournamentId: string | null;
  tournamentStateStatus?: string | null;
  roomCode: string;
  connectRef: MutableRefObject<() => void>;
  socketRef: MutableRefObject<Socket | null>;
  authUserRef: MutableRefObject<{ id?: string | null; email?: string | null } | null>;
  authProfileRef: MutableRefObject<{ username?: string | null } | null>;
  authAccessTokenRef: MutableRefObject<string | null>;
  multiplayerIdentityUserIdRef: MutableRefObject<string | null>;
  joinedRoomRef: MutableRefObject<string | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  pendingCreateOnConnectRef: MutableRefObject<boolean>;
  reconnectRoomCodeRef: MutableRefObject<string | null>;
  reconnectShouldJoinRef: MutableRefObject<boolean>;
  preventAutoRejoinRef: MutableRefObject<boolean>;
  autoJoinAttemptedRef: MutableRefObject<boolean>;
  joinInFlightRef: MutableRefObject<boolean>;
  createInFlightRef: MutableRefObject<boolean>;
  inviteJoinInFlightRef: MutableRefObject<boolean>;
  rejoinInFlightRef: MutableRefObject<boolean>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  reconnectAttemptTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: MutableRefObject<number>;
  autoConnectAttemptedRef: MutableRefObject<boolean>;
  draggingStateRef: MutableRefObject<boolean>;
  isMutedRef: MutableRefObject<boolean>;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  maxSequenceRef: MutableRefObject<number>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
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
  setTournamentState: Dispatch<SetStateAction<LegacyTournamentState | null>>;
  setTournamentActiveRoom: Dispatch<SetStateAction<string | null>>;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setAppMode: Dispatch<SetStateAction<MultiplayerConnectionState['appMode']>>;
  appendRoomReactionRef: MultiplayerRoomSocialRuntime['appendRoomReactionRef'];
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  clearReconnectAttemptTimer: () => void;
  clearTransientRoomUi: () => void;
  fetchGameState: (reason: string) => Promise<boolean>;
  resetClientGameSession: () => void;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
};

function flattenMultiplayerConnectionParams(
  params: UseMultiplayerConnectionParams,
): FlatMultiplayerConnectionParams {
  return {
    ...params.config,
    ...params.connectionState,
    ...params.socketRuntime,
    ...params.roomRuntime,
    ...params.reconnectRuntime,
    ...params.joinFlightRuntime,
    ...params.authRuntime,
    ...params.gameplayRefsRuntime,
    ...params.recoveryRuntime,
    ...params.roomSocialRuntime,
    ...params.uiSetters,
    setAppMode: params.navigationRuntime.setAppMode,
  };
}

export function useMultiplayerConnection(params: UseMultiplayerConnectionParams) {
  const latestRef = useRef<ReturnType<typeof flattenMultiplayerConnectionParams>>(null!);
  useLayoutEffect(() => {
    latestRef.current = flattenMultiplayerConnectionParams(params);
  });
  const { connectionState, config } = params;

  const recoveryMachineRef = useRef<RecoveryMachine | null>(null);
  const establishSocketRef = useRef<() => void>(() => {});
  const handleRecoveryEffectRef = useRef<(effect: RecoveryEffect) => void>(() => {});

  const syncMachineToLegacy = useCallback(() => {
    const machine = recoveryMachineRef.current;
    if (!machine) return;
    const p = latestRef.current;
    syncRecoveryLegacyRefs(machine.getSnapshot(), {
      reconnectShouldJoinRef: p.reconnectShouldJoinRef,
      preventAutoRejoinRef: p.preventAutoRejoinRef,
      reconnectRoomCodeRef: p.reconnectRoomCodeRef,
      reconnectAttemptCountRef: p.reconnectAttemptCountRef,
      rejoinInFlightRef: p.rejoinInFlightRef,
      setRoomRecoveryState: p.setRoomRecoveryState,
      setRoomRecoveryMessage: p.setRoomRecoveryMessage,
      setIsRecoveringConnection: p.setIsRecoveringConnection,
    });
  }, []);

  const dispatchRecovery = useCallback(
    (event: RecoveryEvent): RecoveryMachineSnapshot | null => {
      const machine = recoveryMachineRef.current;
      if (!machine) return null;
      const snapshot = machine.dispatch(event);
      syncMachineToLegacy();
      return snapshot;
    },
    [syncMachineToLegacy],
  );

  const executeRecoveryRoomJoin = useCallback(
    async (roomCode: string) => {
      const p = latestRef.current;
      const socket = p.socketRef.current;
      if (!socket?.connected) {
        dispatchRecovery({ type: 'TRANSPORT_FAIL', reason: 'socket_not_connected' });
        return;
      }

      const rejoinIdentity = p.roomIdentityRef.current ?? {
        username: p.authProfileRef.current?.username ?? 'Guest',
        userId: p.multiplayerIdentityUserIdRef.current,
        authToken: p.authAccessTokenRef.current,
      };

      try {
        console.warn('[rejoin] attempting room:join after recovery', {
          code: roomCode,
          attempt: p.reconnectAttemptCountRef.current,
        });
        const resp = await p.emitWithAck<RoomAckResponse>(socket, 'room:join', roomCode, rejoinIdentity);

        if (resp?.ok) {
          console.warn('[rejoin] room:join success', {
            roomCode: resp.roomCode,
            you: resp.you,
          });
          const wasRecovery = recoveryMachineRef.current?.getSnapshot().state === 'joining';
          p.applyJoinedRoomResponse(resp);
          const terminalTournamentJoin =
            Boolean(resp?.tournamentMatch?.matchId) &&
            Boolean((resp?.state as { gameOver?: boolean } | null | undefined)?.gameOver);
          if (terminalTournamentJoin) {
            dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
            dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode: null });
            dispatchRecovery({ type: 'ROOM_JOIN_OK' });
            return;
          }
          dispatchRecovery({ type: 'ROOM_JOIN_OK' });
          if (wasRecovery) {
            p.showToast('Reconnected to room.', 1200);
          } else {
            p.setAppMode('multiplayer');
          }
          return;
        }

        const errorText = String(resp?.error ?? 'not_ok');
        if (isTerminalJoinError(errorText)) {
          dispatchRecovery({ type: 'ROOM_JOIN_TERMINAL', error: errorText });
          return;
        }
        dispatchRecovery({ type: 'ROOM_JOIN_TRANSIENT', error: errorText });
      } catch (error) {
        dispatchRecovery({
          type: 'TRANSPORT_FAIL',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [dispatchRecovery],
  );

  const executeRecoveryResync = useCallback(
    async (_roomCode: string) => {
      const success = await latestRef.current.fetchGameState('recovery_machine');
      if (success) {
        dispatchRecovery({ type: 'RESYNC_OK' });
      } else {
        dispatchRecovery({ type: 'RESYNC_FAIL' });
      }
    },
    [dispatchRecovery],
  );

  useEffect(() => {
    handleRecoveryEffectRef.current = (effect: RecoveryEffect) => {
      const p = latestRef.current;
      switch (effect.type) {
        case 'connect':
          establishSocketRef.current();
          break;
        case 'room_join':
          void executeRecoveryRoomJoin(effect.roomCode);
          break;
        case 'resync':
          void executeRecoveryResync(effect.roomCode);
          break;
        case 'clear_terminal_room':
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(p.lastRoomStorageKey);
          }
          break;
        case 'cancel_schedule':
          p.reconnectAttemptTimerRef.current = null;
          break;
        default:
          break;
      }
    };
  }, [executeRecoveryResync, executeRecoveryRoomJoin]);

  useEffect(() => {
    if (!recoveryMachineRef.current) {
      recoveryMachineRef.current = createRecoveryMachine({
        onEffect: (effect) => handleRecoveryEffectRef.current(effect),
      });
    }
  }, []);

  useEffect(() => {
    const recoveryDispatchBridgeRef = params.recoveryDispatchRef;
    if (recoveryDispatchBridgeRef) {
      recoveryDispatchBridgeRef.current = dispatchRecovery;
    }
  }, [dispatchRecovery]);

  useEffect(() => {
    const machine = recoveryMachineRef.current;
    return () => {
      machine?.dispose();
      latestRef.current.clearReconnectAttemptTimer();
    };
  }, []);

  const trySavedRoomAutoJoin = useCallback(
    async (socket: Socket) => {
      const p = latestRef.current;
      if (p.preventAutoRejoinRef.current || p.autoJoinAttemptedRef.current) return;
      const savedCode = p.normalizeRoomCode(
        (typeof window !== 'undefined' && window.localStorage.getItem(p.lastRoomStorageKey)) || '',
      );
      if (!savedCode || p.joinedRoomRef.current) return;
      p.autoJoinAttemptedRef.current = true;
      try {
        const resp = await p.emitWithAck<RoomAckResponse>(socket, 'room:join', savedCode, {
          username: p.authProfileUsername ?? 'Guest',
          userId: p.multiplayerIdentityUserIdRef.current,
          authToken: p.authAccessTokenRef.current,
        });
        if (!resp?.ok) {
          const errorText = String(resp?.error ?? '').toLowerCase();
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(p.lastRoomStorageKey);
          }
          if (errorText.includes('completed')) {
            dispatchRecovery({ type: 'SET_POLICY', policy: 'disabled' });
          }
          p.showToast('Saved room is no longer available.', 2000);
          return;
        }
        p.applyJoinedRoomResponse(resp);
        p.showToast('Rejoined room.', 1200);
      } catch (error) {
        p.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
      }
    },
    [dispatchRecovery],
  );

  const establishSocket = useCallback(() => {
    const p = latestRef.current;
    if (p.socket?.connected) return;
    if (p.socket && !p.socket.connected && p.socket.active) return;
    if (p.isConnecting) return;
    p.intentionalDisconnectRef.current = false;
    p.setError('');
    p.setIsConnecting(true);
    if (p.socket && !p.socket.connected) {
      const oldSocket = p.socket as SocketWithPing;
      if (oldSocket.__mpPingTimer) clearInterval(oldSocket.__mpPingTimer);
      oldSocket.removeAllListeners();
      oldSocket.io.removeAllListeners();
      oldSocket.disconnect();
    }

    const s = io(p.serverUrl, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    s.onAny((event, ...args) => traceSocketEvent(String(event), args.length <= 1 ? args[0] : args));

    const recoverState = () => {
      const roomCode = latestRef.current.joinedRoomRef.current;
      if (!roomCode) return;
      if (recoveryMachineRef.current?.getSnapshot().state === 'idle') {
        dispatchRecovery({ type: 'RESYNC_NEEDED', roomCode });
      }
    };

    const pingSocket = s as SocketWithPing;
    pingSocket.__mpPingTimer = setInterval(() => {
      if (!s.connected) return;
      const sentAt = performance.now();
      s.emit('mp:ping', sentAt, () => {
        if (
          import.meta.env.DEV &&
          typeof window !== 'undefined' &&
          window.localStorage.getItem('mp_debug') === '1'
        ) {
          console.info('[mp-ping]', `${Math.round(performance.now() - sentAt)}ms`);
        }
      });
    }, 5000);

    s.on(
      'connect',
      wrapSocketHandler('connect', async () => {
        const current = latestRef.current;
        if (current.intentionalDisconnectRef.current) return;
        current.setIsConnected(true);
        current.setIsConnecting(false);
        current.setServerWaking(false);

        const userId = current.authUserRef.current?.id;
        const username =
          current.authProfileRef.current?.username ??
          current.authUserRef.current?.email?.split('@')[0] ??
          'player';
        if (userId) {
          void current.emitWithAck<RoomAckResponse>(s, 'presence:identify', {
            userId,
            username,
            authToken: current.authAccessTokenRef.current,
          }).catch((error) => {
            if (import.meta.env.DEV) {
              console.log('[presence] identify failed', error instanceof Error ? error.message : error);
            }
          });
        }

        if (current.pendingCreateOnConnectRef.current) {
          current.pendingCreateOnConnectRef.current = false;
          void current.emitCreateRoom(s).catch((error) => {
            const message = error instanceof Error ? error.message : 'Action failed';
            current.setError(message);
            current.showToast(message, 2000);
          });
          return;
        }

        dispatchRecovery({ type: 'SOCKET_CONNECTED' });

        if (recoveryMachineRef.current?.getSnapshot().state === 'idle') {
          await trySavedRoomAutoJoin(s);
        }
      }, { recoverOnError: recoverState }),
    );

    s.on(
      'disconnect',
      wrapSocketHandler('disconnect', (reason) => {
        const current = latestRef.current;
        const roomBeforeDisconnect = current.joinedRoomRef.current;
        const isRecoverableSession =
          Boolean(roomBeforeDisconnect) && !current.intentionalDisconnectRef.current;

        current.setIsConnected(false);
        current.setIsConnecting(false);
        current.setError('');
        current.setActionError('');
        current.setRematchRequested(false);
        current.setRematchReadyIds([]);
        current.setOpponentDragging(false);
        current.draggingStateRef.current = false;

        if (isRecoverableSession && roomBeforeDisconnect) {
          current.clearTransientRoomUi();
          console.warn('[socket] disconnected mid-game, recovery dispatched', {
            reason,
            roomCode: roomBeforeDisconnect,
          });
          dispatchRecovery({ type: 'SOCKET_LOST', roomCode: roomBeforeDisconnect });
          return;
        }

        current.setJoinedRoom(null);
        current.setState(null);
        current.setLegalMoves([]);
        current.setCanDraw(false);
        current.setTournamentId(null);
        current.setTournamentState(null);
        current.setTournamentActiveRoom(null);
        syncMachineToLegacy();
      }),
    );

    s.on(
      'tournament:lobby:update',
      wrapSocketHandler('tournament:lobby:update', (data: TournamentLobbyUpdatePayload) => {
        const lobbyCode = typeof data?.lobbyCode === 'string' ? data.lobbyCode : null;
        const players = Array.isArray(data?.players) ? data.players : null;
        if (!players) return;
        const inferredHostSocketId =
          typeof data?.hostSocketId === 'string'
            ? data.hostSocketId
            : typeof players?.[0]?.socketId === 'string'
              ? players[0].socketId
              : null;
        latestRef.current.setTournamentState((prev: LegacyTournamentState | null) => ({
          ...(prev ?? {}),
          status: 'lobby',
          lobbyCode: lobbyCode ?? (prev?.lobbyCode ?? null),
          players,
          hostSocketId: inferredHostSocketId ?? prev?.hostSocketId ?? null,
        }));
      }),
    );

    s.on(
      'tournament:state',
      wrapSocketHandler('tournament:state', (data: LegacyTournamentState) => {
        const current = latestRef.current;
        current.setTournamentState(data);
        if (typeof data?.id === 'string') current.setTournamentId(data.id);
        current.setTournamentActiveRoom(typeof data?.activeRoomCode === 'string' ? data.activeRoomCode : null);
      }),
    );

    s.on(
      'tournament:match:assigned',
      wrapSocketHandler('tournament:match:assigned', (data: TournamentMatchAssignedPayload) => {
        const current = latestRef.current;
        if (typeof data?.roomCode === 'string') current.setTournamentActiveRoom(data.roomCode);
        if (data?.roomCode && (data?.a === s.id || data?.b === s.id)) {
          const code = String(data.roomCode).trim().toUpperCase();
          current.setJoinedRoom(code);
          current.setRoomCode(code);
          current.setAppMode('multiplayer');
        }
      }),
    );

    s.on('room:chat', wrapSocketHandler('room:chat', (msg: RoomChatEvent) => {
      latestRef.current.appendRoomReactionRef.current(msg);
    }));

    s.on('room:emote', wrapSocketHandler('room:emote', (evt: RoomEmoteEvent) => {
      latestRef.current.appendRoomReactionRef.current(evt);
    }));

    s.on(
      'hand:ended',
      wrapSocketHandler('hand:ended', (payload: HandEndedPayload) => {
        const current = latestRef.current;
        const currentState = current.stateRef.current;
        const myId = current.youRef.current;
        const myRemaining = currentState?.players[myId]?.hand ?? [];
        const yourRemainingTiles = payload.yourRemainingTiles ?? myRemaining;
        const opponentRemainingTiles = payload.opponentRemainingTiles ?? [];
        const blocked = yourRemainingTiles.length > 0 && opponentRemainingTiles.length > 0;
        if (blocked) playBlockedSound(current.isMutedRef.current);
        const stateNow = current.stateRef.current;
        const target = stateNow?.config?.winningScore ?? 60;
        const oppId = stateNow?.playerIds.find((pid) => pid !== myId) ?? null;
        const myAward = payload.pointsAwarded?.you ?? 0;
        const oppAward = payload.pointsAwarded?.opponent ?? 0;
        const myPostScore = (stateNow?.players?.[myId]?.score ?? 0) + myAward;
        const oppPostScore = oppId ? (stateNow?.players?.[oppId]?.score ?? 0) + oppAward : oppAward;
        const matchWillBeOver = myPostScore >= target || oppPostScore >= target;
        if (!matchWillBeOver) {
          const handWinnerId = payload.handWinnerId ?? payload.winnerId ?? null;
          const iWonHand = Boolean(handWinnerId && handWinnerId === myId);
          if (iWonHand) playHandWinSound(current.isMutedRef.current);
          else playHandLoseSound(current.isMutedRef.current);
        }
        current.handRevealShownRef.current = payload.handNumber;
        current.handRevealTimerRef.current = window.setTimeout(() => {
          current.handRevealTimerRef.current = null;
          latestRef.current.setHandReveal({ ...payload, yourRemainingTiles });
        }, 1400);
      }),
    );

    s.on(
      'game:rematch:status',
      wrapSocketHandler('game:rematch:status', (payload: GameRematchStatusPayload) => {
        const readyPlayerIds = Array.isArray(payload?.readyPlayerIds)
          ? payload.readyPlayerIds.filter((id: unknown): id is string => typeof id === 'string')
          : [];
        latestRef.current.setRematchReadyIds(readyPlayerIds);
        latestRef.current.setRematchRequested(readyPlayerIds.includes(latestRef.current.youRef.current));
      }),
    );

    s.on(
      'game:rematch:started',
      wrapSocketHandler('game:rematch:started', () => {
        const current = latestRef.current;
        if (current.handRevealTimerRef.current !== null) {
          clearTimeout(current.handRevealTimerRef.current);
          current.handRevealTimerRef.current = null;
        }
        current.setHandReveal(null);
        current.handRevealShownRef.current = null;
        current.rematchAwaitingStateRef.current = true;
        current.setRematchRequested(false);
        current.setRematchReadyIds([]);
        current.showToast('Rematch started.', 1200);
      }, { recoverOnError: recoverState }),
    );

    s.on(
      'player:dragging',
      wrapSocketHandler('player:dragging', (payload: { playerId?: string; dragging?: boolean }) => {
        if (!payload?.playerId || payload.playerId === latestRef.current.youRef.current) return;
        latestRef.current.setOpponentDragging(Boolean(payload.dragging));
      }),
    );

    s.on(
      'room:session:superseded',
      wrapSocketHandler('room:session:superseded', () => {
        const current = latestRef.current;
        if (current.intentionalDisconnectRef.current) return;
        const roomCode = current.joinedRoomRef.current;
        if (!roomCode) return;
        current.showToast('Session moved to this device. Syncing…', 1600);
        dispatchRecovery({ type: 'SESSION_SUPERSEDED', roomCode });
      }),
    );

    s.on(
      'connect_error',
      wrapSocketHandler('connect_error', () => {
        const current = latestRef.current;
        current.setIsConnecting(false);
        const machineState = recoveryMachineRef.current?.getSnapshot().state;
        if (machineState === 'connecting' || machineState === 'joining') {
          dispatchRecovery({ type: 'TRANSPORT_FAIL', reason: 'connect_error' });
          return;
        }
        current.setServerWaking(true);
        current.setError('');
      }),
    );

    s.on(
      'reconnect_failed',
      wrapSocketHandler('reconnect_failed', () => {
        const current = latestRef.current;
        current.setIsConnecting(false);
        const machineState = recoveryMachineRef.current?.getSnapshot().state;
        if (machineState === 'connecting' || machineState === 'joining') {
          dispatchRecovery({ type: 'TRANSPORT_FAIL', reason: 'reconnect_failed' });
        }
      }),
    );

    s.on(
      'server:shutdown',
      wrapSocketHandler('server:shutdown', (payload: { reason?: string } | undefined) => {
        latestRef.current.showToast(
          'Server is updating. You may need to rejoin your match from the lobby.',
          4000,
        );
        if (import.meta.env.DEV) {
          console.warn('[socket] server:shutdown', payload);
        }
      }),
    );

    p.setSocket(s);
  }, [dispatchRecovery, syncMachineToLegacy, trySavedRoomAutoJoin]);

  useLayoutEffect(() => {
    establishSocketRef.current = establishSocket;
  }, [establishSocket]);

  const connect = useCallback(() => {
    establishSocketRef.current();
  }, []);

  useEffect(() => {
    return () => {
      const p = latestRef.current;
      p.intentionalDisconnectRef.current = true;
      recoveryMachineRef.current?.dispose();
      p.clearReconnectAttemptTimer();
      const sock = p.socketRef.current as SocketWithPing | null;
      if (sock) {
        if (sock.__mpPingTimer) clearInterval(sock.__mpPingTimer);
        sock.removeAllListeners();
        sock.io.removeAllListeners();
        sock.disconnect();
        p.socketRef.current = null;
      }
    };
  }, []);

  const retryRoomRecovery = useCallback(() => {
    const p = latestRef.current;
    if (!p.joinedRoomRef.current) return;
    p.intentionalDisconnectRef.current = false;
    dispatchRecovery({ type: 'SET_TARGET_ROOM', roomCode: p.joinedRoomRef.current });
    dispatchRecovery({ type: 'USER_RETRY' });
    p.setError('');
    p.setActionError('');
  }, [dispatchRecovery]);

  const disconnect = useCallback((reason: string = 'user requested') => {
    const p = latestRef.current;
    console.warn('[nav] redirect home', {
      reason,
      appMode: p.appMode,
      joinedRoom: p.joinedRoomRef.current,
      gameOver: p.stateRef.current?.gameOver ?? null,
      handOver: p.stateRef.current?.handOver ?? null,
    });
    p.intentionalDisconnectRef.current = true;
    dispatchRecovery({ type: 'USER_LEAVE' });
    p.autoJoinAttemptedRef.current = false;
    p.setAppMode('home');
    const socket = p.socketRef.current;
    const activeRoomCode = p.normalizeRoomCode(p.joinedRoomRef.current);
    const midActiveMatch = Boolean(p.stateRef.current && !p.stateRef.current.gameOver);

    void (async () => {
      if (socket?.connected && activeRoomCode) {
        if (midActiveMatch) {
          try {
            await emitRoomAbandonMatch(socket, {
              roomCode: activeRoomCode,
              tournamentMatchId: null,
            });
          } catch (abandonErr) {
            console.warn('[nav] abandon failed, falling back to room:leave', abandonErr);
            emitRoomLeave(socket, activeRoomCode);
          }
        } else {
          emitRoomLeave(socket, activeRoomCode);
        }
      }
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
        if (p.socketRef.current === socket) p.socketRef.current = null;
      }
    })();

    if (socket && p.socketRef.current === socket) p.socketRef.current = null;
    p.setSocket(null);
    p.setJoinedRoom(null);
    p.setState(null);
    p.setLegalMoves([]);
    p.setCanDraw(false);
    p.setError('');
    p.setActionError('');
    p.setYou('');
    p.setSelectedTile(null);
    p.setIsConnected(false);
    p.setIsConnecting(false);
    p.setPlayers([]);
    p.setHandReveal(null);
    p.setRematchRequested(false);
    p.setRematchReadyIds([]);
    p.setOpponentDragging(false);
    p.draggingStateRef.current = false;
    p.setPendingUiAction(null);
    p.handRevealShownRef.current = null;
    p.setAppMode('home');
    p.autoConnectAttemptedRef.current = false;
  }, [dispatchRecovery]);

  useEffect(() => {
    latestRef.current.connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const p = latestRef.current;
    if (p.appMode !== 'multiplayer' && p.appMode !== 'tournament') return;
    if (p.autoConnectAttemptedRef.current) return;
    if (!p.serverUrl) return;
    p.intentionalDisconnectRef.current = false;
    p.autoConnectAttemptedRef.current = true;
    connect();
  }, [connectionState.appMode, config.serverUrl, connect]);

  useEffect(() => {
    const p = latestRef.current;
    if (p.appMode !== 'tournament') return;
    if (p.socket) return;
    p.intentionalDisconnectRef.current = false;
    connect();
  }, [connectionState.appMode, connectionState.socket, connect]);

  useEffect(() => {
    const p = latestRef.current;
    if (!p.authUserId) return;
    if (!p.serverUrl || p.socket || p.isConnecting) return;
    if (p.intentionalDisconnectRef.current) return;
    connect();
  }, [
    connectionState.authUserId,
    config.serverUrl,
    connectionState.socket,
    connectionState.isConnecting,
    connect,
  ]);

  return {
    connect,
    retryRoomRecovery,
    disconnect,
    recoveryDispatch: dispatchRecovery,
  };
}
