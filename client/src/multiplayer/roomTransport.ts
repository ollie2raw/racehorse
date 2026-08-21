/** Socket.IO emit-with-ack transport for live multiplayer / tournament rooms. */

import type { GameState } from '../types';
import { recordJoinAckTimeout } from './mpTelemetry';
// Single-sourced from @racehorse/game-core's dtoContracts module (also used
// by server/src/rooms.ts's ActionPayload) so the client and server can't
// silently diverge on the MOVE/PASS/DRAW wire shape.
import type { RoomGameActionPayload } from '@racehorse/game-core';

export const SOCKET_ACK_TIMEOUT_MS = 8000;

export type SocketEmitter = {
  emit: (event: string, ...args: unknown[]) => void;
};

export type RoomTerminalJoinPayload = {
  status: 'completed' | 'abandoned';
  matchId: string;
  recoverable: true;
};

export type RoomAckResponse = {
  ok?: boolean;
  error?: string;
  terminal?: RoomTerminalJoinPayload;
  sequence?: number;
  forcedDraw?: { drewCount?: number };
  started?: boolean;
  roomCode?: string;
  you?: string;
  state?: GameState | null;
  players?: unknown[];
  matchStatus?: string;
  tournamentId?: string;
  tournamentMatch?: Record<string, unknown> | null;
  eventMeta?: unknown;
  matchStarted?: boolean;
  matchmakingMatchId?: string | null;
  scheduledTournamentMatchId?: string | null;
} & Record<string, unknown>;

export type RoomJoinIdentity = {
  username: string;
  userId: string | null;
  authToken: string | null;
};

export type RoomCreatePayload = {
  username: string;
  userId: string | null;
  authToken: string | null;
  /** Host-chosen deal size. Server derives deadTileCount. */
  tilesPerPlayer?: 7 | 14;
  /** Race target (e.g. 60). Server clamps to allowed values. */
  winningScore?: number;
};

export type PrivateRoomCreateSettings = {
  dealFormat: 7 | 14;
  winTarget: number;
};

export type RoomAbandonPayload = {
  roomCode: string;
  tournamentMatchId: string | null;
};

export type GameActionPayload = RoomGameActionPayload;

export type TournamentAttachPayload = {
  matchId: string;
};

export type GameRematchAck = {
  ok?: boolean;
  error?: string;
  started?: boolean;
};

/** Idempotency key for hand lifecycle / match-start emits (pairs with server withGameActionIdempotency). */
export function createRoomCommandRequestId(kind: 'game-start' | 'hand-ready'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${kind}-${crypto.randomUUID()}`;
  }
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isMpDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem('mp_debug') === '1';
}

export function emitWithAck<TResp>(
  socket: SocketEmitter,
  event: string,
  ...argsWithoutAck: unknown[]
): Promise<TResp> {
  return new Promise((resolve, reject) => {
    const mpDebug = isMpDebugEnabled();
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (mpDebug) {
      console.log('[mp-action-client] sent', {
        event,
        payload: argsWithoutAck[argsWithoutAck.length - 1],
      });
    }
    const t = window.setTimeout(() => {
      const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const elapsedMs = Number((endedAt - startedAt).toFixed(1));
      recordJoinAckTimeout(event, elapsedMs);
      if (mpDebug) {
        console.warn('[mp-action-client] timeout', {
          event,
          elapsedMs,
        });
      }
      reject(new Error(`${event} timed out after ${SOCKET_ACK_TIMEOUT_MS}ms`));
    }, SOCKET_ACK_TIMEOUT_MS);
    socket.emit(event, ...argsWithoutAck, (resp: TResp) => {
      window.clearTimeout(t);
      if (mpDebug) {
        const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        console.log('[mp-action-client] ack', {
          event,
          elapsedMs: Number((endedAt - startedAt).toFixed(1)),
          response: resp,
        });
      }
      resolve(resp);
    });
  });
}

export function emitRoomCreate(
  socket: SocketEmitter,
  payload: RoomCreatePayload,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'room:create', payload);
}

export function emitRoomJoin(
  socket: SocketEmitter,
  roomCode: string,
  identity: RoomJoinIdentity,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'room:join', roomCode, identity);
}

export function emitRoomSpectate(
  socket: SocketEmitter,
  roomCode: string,
  identity: RoomJoinIdentity,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'room:spectate', roomCode, identity);
}

export function emitRoomLeave(socket: SocketEmitter, roomCode: string): void {
  socket.emit('room:leave', roomCode);
}

export function emitRoomAbandonMatch(
  socket: SocketEmitter,
  payload: RoomAbandonPayload,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'room:abandon_match', payload);
}

export function emitGameStart(socket: SocketEmitter, roomCode: string): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'game:start', roomCode, {
    requestId: createRoomCommandRequestId('game-start'),
  });
}

export function emitGameAction(
  socket: SocketEmitter,
  roomCode: string,
  action: GameActionPayload,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'game:action', roomCode, action);
}

export function emitHandReady(
  socket: SocketEmitter,
  roomCode: string,
  handNumber: number | undefined,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'hand:ready', roomCode, {
    handNumber,
    requestId: createRoomCommandRequestId('hand-ready'),
  });
}

export function emitGameRematch(
  socket: SocketEmitter,
  roomCode: string,
  onAck: (resp: GameRematchAck) => void,
): void {
  socket.emit('game:rematch', roomCode, onAck);
}

export function emitTournamentAttachAssignedMatch(
  socket: SocketEmitter,
  payload: TournamentAttachPayload,
): Promise<RoomAckResponse> {
  return emitWithAck<RoomAckResponse>(socket, 'tournament:attach_assigned_match', payload);
}
