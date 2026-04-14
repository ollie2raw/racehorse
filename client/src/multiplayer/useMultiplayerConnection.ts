import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RoomChatEvent, RoomEmoteEvent } from '../components/RoomReactions';
import { traceSocketEvent } from '../debug/socketTrace';
import { playBlockedSound, playHandLoseSound, playHandWinSound } from '../utils/sound';
import type { GameState, Move, Tile } from '../types';

type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

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

type UseMultiplayerConnectionParams = {
  emitWithAck: <TResp>(
    socket: { emit: (...args: any[]) => void },
    event: string,
    ...argsWithoutAck: any[]
  ) => Promise<TResp>;
  normalizeRoomCode: (value: unknown) => string;
  lastRoomStorageKey: string;
  serverUrl: string;
  socket: Socket | null;
  isConnecting: boolean;
  isConnected: boolean;
  roomRecoveryState: RoomRecoveryState;
  appMode:
    | 'home'
    | 'multiplayer'
    | 'noBrainer'
    | 'botSetup'
    | 'bot'
    | 'ghostSetup'
    | 'ghost'
    | 'daily'
    | 'dailyFritz'
    | 'league'
    | 'learn'
    | 'ratingHistory'
    | 'singlePlayerHub'
    | 'tournament';
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
  joinedRoomRef: MutableRefObject<string | null>;
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
  setTournamentState: Dispatch<SetStateAction<any>>;
  setTournamentActiveRoom: Dispatch<SetStateAction<string | null>>;
  setRoomCode: Dispatch<SetStateAction<string>>;
  setAppMode: Dispatch<SetStateAction<UseMultiplayerConnectionParams['appMode']>>;
  setRoomReactions: Dispatch<SetStateAction<Array<RoomChatEvent | RoomEmoteEvent>>>;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  setPlayers: Dispatch<SetStateAction<any[]>>;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setPendingUiAction: Dispatch<
    SetStateAction<null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'>
  >;
  showToast: (message: string, duration?: number) => void;
  applyJoinedRoomResponse: (resp: any) => void;
  emitCreateRoom: (targetSocket: Socket) => Promise<any>;
  clearReconnectAttemptTimer: () => void;
  clearTransientRoomUi: () => void;
};

export function useMultiplayerConnection(params: UseMultiplayerConnectionParams) {
  const latestRef = useRef(params);
  latestRef.current = params;

  const connect = useCallback(() => {
    const p = latestRef.current;
    if (p.isConnecting || p.socket?.connected) return;
    p.intentionalDisconnectRef.current = false;
    p.setError('');
    p.setIsConnecting(true);
    if (p.socket && !p.socket.connected) {
      p.socket.removeAllListeners();
      p.socket.disconnect();
    }

    const s = io(p.serverUrl, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: false,
      reconnectionAttempts: 0,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    s.onAny((event, ...args) => traceSocketEvent(String(event), args.length <= 1 ? args[0] : args));
    if (import.meta.env.DEV) {
      s.on('connect', () => console.log('[socket] connect', s.id));
      s.on('disconnect', (reason) => console.log('[socket] disconnect', reason));
      s.on('connect_error', (error) => console.log('[socket] connect_error', error?.message));
    }

    s.on('connect', async () => {
      const current = latestRef.current;
      if (current.intentionalDisconnectRef.current) return;
      current.clearReconnectAttemptTimer();
      current.reconnectAttemptCountRef.current = 0;
      current.setIsRecoveringConnection(false);
      current.setRoomRecoveryState(current.joinedRoomRef.current ? 'resyncing' : 'idle');
      current.setRoomRecoveryMessage(current.joinedRoomRef.current ? 'Syncing room state…' : '');
      current.setIsConnected(true);
      current.setYou(s.id ?? '');
      current.setIsConnecting(false);
      current.setServerWaking(false);

      const userId = current.authUserRef.current?.id;
      const username =
        current.authProfileRef.current?.username ??
        current.authUserRef.current?.email?.split('@')[0] ??
        'player';
      if (userId) {
        try {
          await current.emitWithAck<any>(s, 'presence:identify', { userId, username });
        } catch (error) {
          if (import.meta.env.DEV) {
            console.log('[presence] identify failed', error instanceof Error ? error.message : error);
          }
        }
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

      if (!current.preventAutoRejoinRef.current) {
        const code = current.normalizeRoomCode(current.joinedRoomRef.current ?? current.roomCode);
        if (code && !current.rejoinInFlightRef.current) {
          current.rejoinInFlightRef.current = true;
          try {
            const resp = await current.emitWithAck<any>(s, 'room:join', code, {
              username: current.authProfileRef.current?.username ?? 'Guest',
              userId: current.authUserRef.current?.id ?? null,
            });
            if (resp?.ok) {
              current.applyJoinedRoomResponse(resp);
              current.reconnectShouldJoinRef.current = false;
              current.reconnectRoomCodeRef.current = resp.roomCode;
              current.setIsRecoveringConnection(false);
              current.setRoomRecoveryState('idle');
              current.setRoomRecoveryMessage('');
              return;
            }
            if (import.meta.env.DEV) {
              console.log('[rejoin] room:join not ok', { code, resp });
            }
            current.setRoomRecoveryState('failed');
            current.setRoomRecoveryMessage('Room no longer exists. Return to home.');
          } catch (error) {
            if (import.meta.env.DEV) {
              console.log('[rejoin] room:join failed', error instanceof Error ? error.message : error);
            }
            current.setRoomRecoveryState('failed');
            current.setRoomRecoveryMessage('Could not reach room. Return to home.');
          } finally {
            current.rejoinInFlightRef.current = false;
          }
        }
      }

      if (current.inviteJoinInFlightRef.current) return;
      const reconnectCode = current.normalizeRoomCode(
        current.reconnectRoomCodeRef.current ?? current.joinedRoomRef.current ?? '',
      );
      if (current.reconnectShouldJoinRef.current && reconnectCode && !current.preventAutoRejoinRef.current) {
        try {
          const resp = await current.emitWithAck<any>(s, 'room:join', reconnectCode, {
            username: current.authProfileRef.current?.username ?? 'Guest',
            userId: current.authUserRef.current?.id ?? null,
          });
          if (!resp?.ok) {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(current.lastRoomStorageKey);
            }
            current.setRoomRecoveryState('failed');
            current.setRoomRecoveryMessage('Room no longer exists. Return to home.');
            return;
          }
          current.applyJoinedRoomResponse(resp);
          current.setAppMode('multiplayer');
          current.reconnectShouldJoinRef.current = false;
          current.reconnectRoomCodeRef.current = resp.roomCode;
          current.setIsRecoveringConnection(false);
          current.setRoomRecoveryState('idle');
          current.setRoomRecoveryMessage('');
          current.showToast('Reconnected to room.', 1200);
        } catch (error) {
          current.setRoomRecoveryState('failed');
          current.setRoomRecoveryMessage('Could not restore room state. Retry reconnect.');
          current.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
        }
        return;
      }

      if (current.preventAutoRejoinRef.current || current.autoJoinAttemptedRef.current) return;
      const savedCode = current.normalizeRoomCode(
        (typeof window !== 'undefined' && window.localStorage.getItem(current.lastRoomStorageKey)) || '',
      );
      if (!savedCode || current.joinedRoomRef.current) return;
      current.autoJoinAttemptedRef.current = true;
      void (async () => {
        try {
          const resp = await current.emitWithAck<any>(s, 'room:join', savedCode, {
            username: current.authProfileUsername ?? 'Guest',
            userId: current.authUserId ?? null,
          });
          if (!resp?.ok) {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(current.lastRoomStorageKey);
            }
            current.showToast('Saved room is no longer available.', 2000);
            return;
          }
          current.applyJoinedRoomResponse(resp);
          current.showToast('Rejoined room.', 1200);
        } catch (error) {
          current.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
        }
      })();
    });

    s.on('disconnect', (reason) => {
      const current = latestRef.current;
      const roomBeforeDisconnect = current.joinedRoomRef.current;
      const stateBeforeDisconnect = current.stateRef.current;
      const isRecoverableSession = !stateBeforeDisconnect || !stateBeforeDisconnect.gameOver;
      const shouldAttemptReconnect =
        Boolean(roomBeforeDisconnect) &&
        isRecoverableSession &&
        !current.preventAutoRejoinRef.current &&
        !current.intentionalDisconnectRef.current;

      if (roomBeforeDisconnect && isRecoverableSession && !current.preventAutoRejoinRef.current && !current.intentionalDisconnectRef.current) {
        current.reconnectRoomCodeRef.current = roomBeforeDisconnect;
        current.reconnectShouldJoinRef.current = true;
      }

      current.setIsConnected(false);
      current.setIsConnecting(false);
      current.setError('');
      current.setActionError('');
      current.setRematchRequested(false);
      current.setRematchReadyIds([]);
      current.setOpponentDragging(false);
      current.draggingStateRef.current = false;

      if (shouldAttemptReconnect) {
        current.setIsRecoveringConnection(true);
        current.setRoomRecoveryState('reconnecting');
        current.setRoomRecoveryMessage('Connection lost. Reconnecting to room…');
        current.clearTransientRoomUi();
        const nextAttempt = current.reconnectAttemptCountRef.current + 1;
        current.reconnectAttemptCountRef.current = nextAttempt;
        console.warn('[socket] disconnected mid-game, reconnect scheduled', {
          attempt: nextAttempt,
          maxAttempts: 8,
          reason,
          roomCode: roomBeforeDisconnect,
        });
        current.clearReconnectAttemptTimer();
        current.reconnectAttemptTimerRef.current = setTimeout(() => {
          current.connectRef.current?.();
        }, 2000);
        return;
      }

      current.setIsRecoveringConnection(false);
      current.setRoomRecoveryState('idle');
      current.setRoomRecoveryMessage('');
      current.setJoinedRoom(null);
      current.setState(null);
      current.setLegalMoves([]);
      current.setCanDraw(false);
      current.setTournamentId(null);
      current.setTournamentState(null);
      current.setTournamentActiveRoom(null);
    });

    s.on('tournament:lobby:update', (data: any) => {
      const lobbyCode = typeof data?.lobbyCode === 'string' ? data.lobbyCode : null;
      const players = Array.isArray(data?.players) ? data.players : null;
      if (!players) return;
      const inferredHostSocketId =
        typeof data?.hostSocketId === 'string'
          ? data.hostSocketId
          : typeof players?.[0]?.socketId === 'string'
          ? players[0].socketId
          : null;
      latestRef.current.setTournamentState((prev: any) => ({
        ...(prev ?? {}),
        status: 'lobby',
        lobbyCode: lobbyCode ?? (prev?.lobbyCode ?? null),
        players,
        hostSocketId: inferredHostSocketId ?? prev?.hostSocketId ?? null,
      }));
    });

    s.on('tournament:state', (data: any) => {
      const current = latestRef.current;
      current.setTournamentState(data);
      if (typeof data?.id === 'string') current.setTournamentId(data.id);
      current.setTournamentActiveRoom(typeof data?.activeRoomCode === 'string' ? data.activeRoomCode : null);
    });

    s.on('tournament:match:assigned', (data: any) => {
      const current = latestRef.current;
      if (typeof data?.roomCode === 'string') current.setTournamentActiveRoom(data.roomCode);
      if (data?.roomCode && (data?.a === s.id || data?.b === s.id)) {
        const code = String(data.roomCode).trim().toUpperCase();
        current.setJoinedRoom(code);
        current.setRoomCode(code);
        current.setAppMode('multiplayer');
      }
    });

    s.on('room:chat', (msg: RoomChatEvent) => {
      latestRef.current.setRoomReactions((prev) => {
        const next = prev.concat(msg);
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
    });

    s.on('room:emote', (evt: RoomEmoteEvent) => {
      latestRef.current.setRoomReactions((prev) => {
        const next = prev.concat(evt);
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
    });

    s.on('hand:ended', (payload: HandEndedPayload) => {
      const current = latestRef.current;
      const currentState = current.stateRef.current;
      const myRemaining = currentState?.players[s.id ?? '']?.hand ?? [];
      const yourRemainingTiles = payload.yourRemainingTiles ?? myRemaining;
      const opponentRemainingTiles = payload.opponentRemainingTiles ?? [];
      const blocked = yourRemainingTiles.length > 0 && opponentRemainingTiles.length > 0;
      if (blocked) {
        playBlockedSound(current.isMutedRef.current);
      }
      const stateNow = current.stateRef.current;
      const target = stateNow?.config?.winningScore ?? 60;
      const myId = s.id ?? '';
      const oppId = stateNow?.playerIds.find((pid) => pid !== myId) ?? null;
      const myAward = payload.pointsAwarded?.you ?? 0;
      const oppAward = payload.pointsAwarded?.opponent ?? 0;
      const myPostScore = (stateNow?.players?.[myId]?.score ?? 0) + myAward;
      const oppPostScore = oppId ? (stateNow?.players?.[oppId]?.score ?? 0) + oppAward : oppAward;
      const matchWillBeOver = myPostScore >= target || oppPostScore >= target;
      if (!matchWillBeOver) {
        const handWinnerId = payload.handWinnerId ?? payload.winnerId ?? null;
        const iWonHand = Boolean(handWinnerId && handWinnerId === myId);
        if (iWonHand) {
          playHandWinSound(current.isMutedRef.current);
        } else {
          playHandLoseSound(current.isMutedRef.current);
        }
      }
      current.handRevealShownRef.current = payload.handNumber;
      window.setTimeout(() => {
        latestRef.current.setHandReveal({
          ...payload,
          yourRemainingTiles,
        });
      }, 1400);
    });

    s.on('game:rematch:status', (payload: any) => {
      const readyPlayerIds = Array.isArray(payload?.readyPlayerIds)
        ? payload.readyPlayerIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      latestRef.current.setRematchReadyIds(readyPlayerIds);
      latestRef.current.setRematchRequested(readyPlayerIds.includes(s.id ?? ''));
    });

    s.on('game:rematch:started', () => {
      latestRef.current.setRematchRequested(false);
      latestRef.current.setRematchReadyIds([]);
      latestRef.current.showToast('Rematch started.', 1200);
    });

    s.on('player:dragging', (payload: { playerId?: string; dragging?: boolean }) => {
      if (!payload?.playerId || payload.playerId === s.id) return;
      latestRef.current.setOpponentDragging(Boolean(payload.dragging));
    });

    s.on('connect_error', () => {
      const current = latestRef.current;
      current.setIsConnecting(false);
      const shouldRetryReconnect =
        current.reconnectShouldJoinRef.current &&
        !current.intentionalDisconnectRef.current &&
        !current.preventAutoRejoinRef.current;
      if (shouldRetryReconnect) {
        const nextAttempt = current.reconnectAttemptCountRef.current + 1;
        current.reconnectAttemptCountRef.current = nextAttempt;
        if (nextAttempt <= 8) {
          current.setIsRecoveringConnection(true);
          current.setRoomRecoveryState('reconnecting');
          current.setRoomRecoveryMessage('Connection unstable. Retrying…');
          console.warn('[socket] reconnect attempt failed, retrying', {
            attempt: nextAttempt,
            maxAttempts: 8,
            roomCode: current.reconnectRoomCodeRef.current,
          });
          current.clearReconnectAttemptTimer();
          current.reconnectAttemptTimerRef.current = setTimeout(() => {
            current.connectRef.current?.();
          }, 2000);
          return;
        }
        console.warn('[socket] reconnect attempt failed, entering slow retry mode', {
          attempts: nextAttempt,
          roomCode: current.reconnectRoomCodeRef.current,
        });
        current.setIsRecoveringConnection(false);
        current.setRoomRecoveryState('failed');
        current.setRoomRecoveryMessage('Reconnect failed. Retry to restore the room.');
        current.setError('');
        current.clearReconnectAttemptTimer();
        return;
      }
      current.setServerWaking(true);
      current.setError('');
    });

    p.setSocket(s);
  }, []);

  const retryRoomRecovery = useCallback(() => {
    const p = latestRef.current;
    if (!p.joinedRoomRef.current) return;
    p.intentionalDisconnectRef.current = false;
    p.reconnectRoomCodeRef.current = p.joinedRoomRef.current;
    p.reconnectShouldJoinRef.current = true;
    p.reconnectAttemptCountRef.current = 0;
    p.clearReconnectAttemptTimer();
    p.setError('');
    p.setActionError('');
    p.setIsRecoveringConnection(true);
    p.setRoomRecoveryState('reconnecting');
    p.setRoomRecoveryMessage('Retrying room connection…');
    p.connectRef.current?.();
  }, []);

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
    p.reconnectRoomCodeRef.current = null;
    p.reconnectShouldJoinRef.current = false;
    p.clearReconnectAttemptTimer();
    p.reconnectAttemptCountRef.current = 0;
    p.setIsRecoveringConnection(false);
    p.setRoomRecoveryState('idle');
    p.setRoomRecoveryMessage('');
    p.preventAutoRejoinRef.current = true;
    p.autoJoinAttemptedRef.current = false;
    p.setAppMode('home');
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(p.lastRoomStorageKey);
    }
    const socket = p.socketRef.current;
    if (socket) {
      const activeRoomCode = p.normalizeRoomCode(p.joinedRoomRef.current);
      if (socket.connected && activeRoomCode) {
        socket.emit('room:leave', activeRoomCode);
      }
      socket.removeAllListeners();
      socket.disconnect();
      p.socketRef.current = null;
    }
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
  }, []);

  useEffect(() => {
    latestRef.current.connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    const p = latestRef.current;
    if (p.isConnected) return;
    if (p.intentionalDisconnectRef.current) return;
    if (!p.joinedRoomRef.current) return;
    if (p.stateRef.current?.gameOver) return;
    if (p.roomRecoveryState === 'failed') return;

    const timer = setTimeout(() => {
      const current = latestRef.current;
      if (!current.intentionalDisconnectRef.current && current.joinedRoomRef.current) {
        current.connectRef.current?.();
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [params.isConnected, params.roomRecoveryState]);

  useEffect(() => {
    const p = latestRef.current;
    if (p.appMode !== 'multiplayer' && p.appMode !== 'tournament') return;
    if (p.autoConnectAttemptedRef.current) return;
    if (!p.serverUrl) return;
    p.intentionalDisconnectRef.current = false;
    p.autoConnectAttemptedRef.current = true;
    connect();
  }, [params.appMode, params.serverUrl, connect]);

  useEffect(() => {
    const p = latestRef.current;
    if (p.appMode !== 'tournament') return;
    if (p.socket) return;
    p.intentionalDisconnectRef.current = false;
    connect();
  }, [params.appMode, params.socket, connect]);

  useEffect(() => {
    const p = latestRef.current;
    if (!p.authUserId) return;
    if (!p.serverUrl || p.socket || p.isConnecting) return;
    if (p.intentionalDisconnectRef.current) return;
    connect();
  }, [params.authUserId, params.serverUrl, params.socket, params.isConnecting, connect]);

  return {
    connect,
    retryRoomRecovery,
    disconnect,
  };
}
