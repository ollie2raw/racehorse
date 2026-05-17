import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { RoomChatEvent, RoomEmoteEvent } from '../components/RoomReactions';
import { traceSocketEvent } from '../debug/socketTrace';
import { playBlockedSound, playHandLoseSound, playHandWinSound } from '../utils/sound';
import type { GameState, Move, Tile } from '../types';
import { wrapSocketHandler } from './socketGuards';

type SocketWithPing = Socket & { __mpPingTimer?: ReturnType<typeof setInterval> };

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
    | 'learn'
    | 'friends'
    | 'stats'
    | 'ratingHistory'
    | 'singlePlayerHub'
    | 'tournament'
    | 'leaderboard'
    | 'profile'
    | 'feed';
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
  fetchGameState: (reason: string) => Promise<boolean>;
  resetClientGameSession: () => void;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
};

export function useMultiplayerConnection(params: UseMultiplayerConnectionParams) {
  const latestRef = useRef(params);
  latestRef.current = params;

  const scheduleReconnectAttempt = useCallback(
    (
      current: UseMultiplayerConnectionParams,
      message: string,
      details: Record<string, unknown> = {},
    ) => {
      if (
        current.intentionalDisconnectRef.current ||
        current.preventAutoRejoinRef.current ||
        !current.reconnectShouldJoinRef.current
      ) {
        return false;
      }
      const nextAttempt = current.reconnectAttemptCountRef.current + 1;
      current.reconnectAttemptCountRef.current = nextAttempt;
      current.setIsRecoveringConnection(true);
      current.setRoomRecoveryState('reconnecting');
      current.setRoomRecoveryMessage(message);
      current.clearReconnectAttemptTimer();
      const delayMs = Math.min(10_000, 1500 + Math.min(nextAttempt, 8) * 750);
      console.warn('[socket] room reconnect retry scheduled', {
        attempt: nextAttempt,
        delayMs,
        roomCode: current.reconnectRoomCodeRef.current,
        ...details,
      });
      current.reconnectAttemptTimerRef.current = setTimeout(() => {
        current.connectRef.current?.();
      }, delayMs);
      return true;
    },
    [],
  );

  const connect = useCallback(() => {
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
      void latestRef.current.fetchGameState('handler_error');
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
      current.clearReconnectAttemptTimer();
      // Note: reconnectAttemptCountRef is NOT reset here. 
      // It is only reset upon successful room:join to preserve backoff across reconnect cycles.
      current.setIsRecoveringConnection(false);
      current.setRoomRecoveryState(current.joinedRoomRef.current ? 'resyncing' : 'idle');
      current.setRoomRecoveryMessage(current.joinedRoomRef.current ? 'Syncing room state…' : '');
      current.setIsConnected(true);
      current.setIsConnecting(false);
      current.setServerWaking(false);

      const userId = current.authUserRef.current?.id;
      const username =
        current.authProfileRef.current?.username ??
        current.authUserRef.current?.email?.split('@')[0] ??
        'player';
      if (userId) {
        void current.emitWithAck<any>(s, 'presence:identify', {
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

      // Consolidated Join/Recovery Path
      // Prioritize recovery if we have an explicit signal or a previously joined room.
      const isRecoveryAttempt = current.reconnectShouldJoinRef.current || !!current.joinedRoomRef.current;
      const roomToJoin = current.normalizeRoomCode(
        current.reconnectRoomCodeRef.current ?? current.joinedRoomRef.current ?? current.roomCode
      );

      if (roomToJoin && !current.preventAutoRejoinRef.current && !current.rejoinInFlightRef.current) {
        current.rejoinInFlightRef.current = true;
        try {
          console.warn('[rejoin] attempting room:join after connect', { 
            code: roomToJoin, 
            isRecovery: isRecoveryAttempt,
            attempt: current.reconnectAttemptCountRef.current
          });
          
          const rejoinIdentity = current.roomIdentityRef.current ?? {
            username: current.authProfileRef.current?.username ?? 'Guest',
            userId: current.multiplayerIdentityUserIdRef.current,
            authToken: current.authAccessTokenRef.current,
          };
          
          const resp = await current.emitWithAck<any>(s, 'room:join', roomToJoin, rejoinIdentity);

          if (resp?.ok) {
            console.warn('[rejoin] room:join success', {
              roomCode: resp.roomCode,
              you: resp.you,
            });
            current.reconnectAttemptCountRef.current = 0; // Success! Reset backoff.
            current.applyJoinedRoomResponse(resp);
            const terminalTournamentJoin =
              Boolean(resp?.tournamentMatch?.matchId) &&
              Boolean((resp?.state as { gameOver?: boolean } | null | undefined)?.gameOver);
            current.reconnectShouldJoinRef.current = false;
            current.reconnectRoomCodeRef.current = terminalTournamentJoin ? null : resp.roomCode;
            current.setIsRecoveringConnection(false);
            current.setRoomRecoveryState('idle');
            current.setRoomRecoveryMessage('');
            if (terminalTournamentJoin) {
              current.preventAutoRejoinRef.current = true;
              if (typeof window !== 'undefined') {
                window.localStorage.removeItem(current.lastRoomStorageKey);
              }
              return;
            }
            if (isRecoveryAttempt) {
              current.showToast('Reconnected to room.', 1200);
            } else {
              current.setAppMode('multiplayer');
            }
            return;
          }
          
          // Failed with response
          const errorText = String(resp?.error ?? '').toLowerCase();
          if (errorText.includes('abandoned') || errorText.includes('completed')) {
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(current.lastRoomStorageKey);
            }
            current.preventAutoRejoinRef.current = true;
            current.reconnectShouldJoinRef.current = false;
            current.reconnectRoomCodeRef.current = null;
            current.setIsRecoveringConnection(false);
            current.setRoomRecoveryState('failed');
            current.setRoomRecoveryMessage('Match is no longer available.');
          } else if (errorText.includes('not found')) {
            if (isRecoveryAttempt && typeof window !== 'undefined') {
              window.localStorage.removeItem(current.lastRoomStorageKey);
            }
            current.setIsRecoveringConnection(false);
            current.setRoomRecoveryState('failed');
            current.setRoomRecoveryMessage('Room no longer exists. Return to home.');
          } else if (isRecoveryAttempt) {
            scheduleReconnectAttempt(current, 'Room reconnect rejected. Retrying…', {
              code: roomToJoin,
              error: resp?.error ?? 'not_ok',
            });
          }
        } catch (error) {
          if (isRecoveryAttempt) {
            scheduleReconnectAttempt(current, 'Room reconnect timed out. Retrying…', {
              code: roomToJoin,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          current.rejoinInFlightRef.current = false;
        }
        
        // If this was an explicit recovery attempt, we stop here (either failed-permanently or scheduled retry).
        // If it was just an auto-join from URL that failed, we fall through to try saved room.
        if (isRecoveryAttempt) return;
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
            userId: current.multiplayerIdentityUserIdRef.current,
            authToken: current.authAccessTokenRef.current,
          });
          if (!resp?.ok) {
            const errorText = String(resp?.error ?? '').toLowerCase();
            if (typeof window !== 'undefined') {
              window.localStorage.removeItem(current.lastRoomStorageKey);
            }
            if (errorText.includes('completed')) {
              current.preventAutoRejoinRef.current = true;
            }
            current.showToast('Saved room is no longer available.', 2000);
            return;
          }
          current.reconnectAttemptCountRef.current = 0; // Success!
          current.applyJoinedRoomResponse(resp);
          current.showToast('Rejoined room.', 1200);
        } catch (error) {
          current.showToast(error instanceof Error ? error.message : 'Action failed', 2000);
        }
      })();
      }, { recoverOnError: recoverState }),
    );

    s.on(
      'disconnect',
      wrapSocketHandler('disconnect', (reason) => {
      const current = latestRef.current;
      const roomBeforeDisconnect = current.joinedRoomRef.current;
      // Recover any time we have a room to return to — including the game-over /
      // rematch screen — so players can reconnect and still initiate a rematch.
      // Intentional disconnects and explicit leave actions are still protected by
      // the intentionalDisconnectRef and preventAutoRejoinRef guards below.
      const isRecoverableSession = Boolean(roomBeforeDisconnect);
      const shouldAttemptReconnect =
        isRecoverableSession &&
        !current.preventAutoRejoinRef.current &&
        !current.intentionalDisconnectRef.current;

      if (isRecoverableSession && !current.preventAutoRejoinRef.current && !current.intentionalDisconnectRef.current) {
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
        console.warn('[socket] disconnected mid-game, reconnect scheduled', {
          reason,
          roomCode: roomBeforeDisconnect,
        });
        scheduleReconnectAttempt(current, 'Connection lost. Reconnecting to room…', { reason });
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
      }),
    );

    s.on(
      'tournament:lobby:update',
      wrapSocketHandler('tournament:lobby:update', (data: any) => {
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
      }),
    );

    s.on(
      'tournament:state',
      wrapSocketHandler('tournament:state', (data: any) => {
      const current = latestRef.current;
      current.setTournamentState(data);
      if (typeof data?.id === 'string') current.setTournamentId(data.id);
      current.setTournamentActiveRoom(typeof data?.activeRoomCode === 'string' ? data.activeRoomCode : null);
      }),
    );

    s.on(
      'tournament:match:assigned',
      wrapSocketHandler('tournament:match:assigned', (data: any) => {
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

    s.on(
      'room:chat',
      wrapSocketHandler('room:chat', (msg: RoomChatEvent) => {
      latestRef.current.setRoomReactions((prev) => {
        const next = prev.concat(msg);
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
      }),
    );

    s.on(
      'room:emote',
      wrapSocketHandler('room:emote', (evt: RoomEmoteEvent) => {
      latestRef.current.setRoomReactions((prev) => {
        const next = prev.concat(evt);
        return next.length > 50 ? next.slice(next.length - 50) : next;
      });
      }),
    );

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
      if (blocked) {
        playBlockedSound(current.isMutedRef.current);
      }
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
        if (iWonHand) {
          playHandWinSound(current.isMutedRef.current);
        } else {
          playHandLoseSound(current.isMutedRef.current);
        }
      }
      current.handRevealShownRef.current = payload.handNumber;
      current.handRevealTimerRef.current = window.setTimeout(() => {
        current.handRevealTimerRef.current = null;
        latestRef.current.setHandReveal({
          ...payload,
          yourRemainingTiles,
        });
      }, 1400);
      }),
    );

    s.on(
      'game:rematch:status',
      wrapSocketHandler('game:rematch:status', (payload: any) => {
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
      if (current.intentionalDisconnectRef.current || current.preventAutoRejoinRef.current) return;
      const roomCode = current.joinedRoomRef.current;
      if (!roomCode) return;
      current.reconnectRoomCodeRef.current = roomCode;
      current.reconnectShouldJoinRef.current = true;
      current.showToast('Session moved to this device. Syncing…', 1600);
      current.connectRef.current?.();
      }),
    );

    const onIoReconnect = wrapSocketHandler('io:reconnect', () => {
      const current = latestRef.current;
      if (
        current.intentionalDisconnectRef.current ||
        current.preventAutoRejoinRef.current ||
        !current.joinedRoomRef.current
      ) {
        return;
      }
      current.reconnectRoomCodeRef.current = current.joinedRoomRef.current;
      current.reconnectShouldJoinRef.current = true;
    });
    s.io.on('reconnect', onIoReconnect);

    s.on(
      'connect_error',
      wrapSocketHandler('connect_error', () => {
      const current = latestRef.current;
      current.setIsConnecting(false);
      const shouldRetryReconnect =
        current.reconnectShouldJoinRef.current &&
        !current.intentionalDisconnectRef.current &&
        !current.preventAutoRejoinRef.current;
      if (shouldRetryReconnect) {
        scheduleReconnectAttempt(current, 'Connection unstable. Retrying…');
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
      if (
        current.reconnectShouldJoinRef.current &&
        !current.intentionalDisconnectRef.current &&
        !current.preventAutoRejoinRef.current
      ) {
        scheduleReconnectAttempt(current, 'Reconnect exhausted. Trying fresh connection…', {
          source: 'reconnect_failed',
        });
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
  }, [scheduleReconnectAttempt]);

  useEffect(() => {
    return () => {
      const p = latestRef.current;
      p.intentionalDisconnectRef.current = true;
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
