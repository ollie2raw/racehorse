import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GameState } from '../types';
import { logger } from '../utils/logger';
import { hasHandIdentityMismatch } from './handIdentity';
import type { RecoveryEvent } from './recoveryMachine';
import { dispatchSocketEvent } from './socketEventBus';
import type { RoomEventMeta, RoomPlayer } from './protocol';
import type { RoomAckResponse } from './roomTransport';
import { selectJoinedRoomCode } from './session/sessionStateMachine';
import type { SessionEvent, SessionSnapshot } from './session/sessionTypes';

export type JoinAckSnapshotResult = {
  ok: boolean;
  nextState: GameState | null;
};

export type JoinAckCoordinatorDispatch = (event: RecoveryEvent) => void;

export type ProcessJoinAckParams = {
  resp: RoomAckResponse;
  normalizeRoomCode: (value: unknown) => string;
  dispatchRecovery: JoinAckCoordinatorDispatch;
  applySnapshot: (resp: RoomAckResponse) => JoinAckSnapshotResult;
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setJoinedRoom: (roomCode: string | null) => void;
  setRoomCode: (code: string) => void;
  setYou: (you: string) => void;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  sessionRef: MutableRefObject<SessionSnapshot>;
  dispatchSession: (event: SessionEvent) => void;
  joinedRoomResponseRef: MutableRefObject<RoomAckResponse | null>;
  youRef: MutableRefObject<string>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
  roomIdentity: {
    username: string;
    userId: string | null;
    authToken: string | null;
  };
  onTerminalJoinHandled?: (
    resp: RoomAckResponse,
    nextState: GameState | null,
  ) => 'terminal_handled' | void;
  trySchedulePlayerReady?: () => void;
  flushJoinedRoom?: (apply: () => void) => void;
};

export type ProcessJoinAckResult = {
  accepted: boolean;
  roomCode: string | null;
  resolvedYou: string;
  nextState: GameState | null;
  seated: boolean;
};

function isMalformedJoinAck(
  resp: RoomAckResponse,
  normalizeRoomCode: (value: unknown) => string,
): boolean {
  if (!resp || resp.ok === false) return true;
  return !normalizeRoomCode(resp.roomCode);
}

/**
 * Pure join-ack coordinator (Phase D). Single authority for room:join ack handling.
 * Does not call fetchGameState or interact with resync cooldown / RESYNC_OK.
 */
export function processJoinAck(params: ProcessJoinAckParams): ProcessJoinAckResult {
  const { resp, normalizeRoomCode, dispatchRecovery } = params;

  if (isMalformedJoinAck(resp, normalizeRoomCode)) {
    return { accepted: false, roomCode: null, resolvedYou: '', nextState: null, seated: false };
  }

  params.joinedRoomResponseRef.current = resp;
  params.applyRoomEventMeta(resp.eventMeta as RoomEventMeta | null | undefined);

  if (!params.roomIdentityRef.current) {
    params.roomIdentityRef.current = { ...params.roomIdentity };
  }

  const resolvedYou = typeof resp.you === 'string' && resp.you ? resp.you : '';
  if (resolvedYou) {
    params.setYou(resolvedYou);
    params.youRef.current = resolvedYou;
  }

  const roomCode = normalizeRoomCode(resp.roomCode);
  const applyJoinedRoom = () => {
    params.setJoinedRoom(roomCode);
    params.setRoomCode(roomCode);
  };
  if (params.flushJoinedRoom) {
    params.flushJoinedRoom(applyJoinedRoom);
  } else {
    applyJoinedRoom();
  }

  const { ok, nextState } = params.applySnapshot(resp);
  if (!ok && resp.state != null) {
    logger.warn('join', 'room:join handshake state failed projection validation — resync scheduled', {
      roomCode,
    });
    const resyncRoom = normalizeRoomCode(
      resp.roomCode ?? selectJoinedRoomCode(params.sessionRef.current),
    );
    if (resyncRoom) {
      dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: resyncRoom } });
    }
  }

  const normalized = params.normalizeRoomPlayers(resp.players);
  params.roomPlayersRef.current = normalized;
  params.setPlayers(normalized);
  dispatchRecovery({ type: 'ROOM_JOIN_OK' });

  if (params.onTerminalJoinHandled?.(resp, nextState) === 'terminal_handled') {
    return {
      accepted: true,
      roomCode,
      resolvedYou,
      nextState,
      seated: false,
    };
  }

  const roster = params.normalizeRoomPlayers(resp.players);
  const seated =
    Boolean(resolvedYou) &&
    (roster.some((p) => p.id === resolvedYou) ||
      (Array.isArray(nextState?.playerIds) && nextState.playerIds.includes(resolvedYou)));
  params.dispatchSession({
    type: 'ROOM_JOIN_OK',
    roomCode,
    youId: resolvedYou,
    seated,
    matchStarted: resp.matchStarted === true,
  });

  if (hasHandIdentityMismatch(nextState, resolvedYou)) {
    const resyncRoom = normalizeRoomCode(
      resp.roomCode ?? selectJoinedRoomCode(params.sessionRef.current),
    );
    if (resyncRoom) {
      dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode: resyncRoom } });
    }
  } else if (seated && resp.matchStarted !== true) {
    console.log('[DEBUG-READY] calling trySchedulePlayerReady', { seated, matchStarted: resp.matchStarted, resolvedYou });
    params.trySchedulePlayerReady?.();
  } else {
    console.log('[DEBUG-READY] SKIPPED trySchedulePlayerReady', { seated, matchStarted: resp.matchStarted, resolvedYou });
  }

  return {
    accepted: true,
    roomCode,
    resolvedYou,
    nextState,
    seated,
  };
}