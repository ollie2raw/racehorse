import type { RoomAckResponse, RoomJoinIdentity } from './roomTransport';

export type MatchmakingJoinSocket = {
  connected?: boolean;
  emit: (event: string, ...args: unknown[]) => void;
};

export type MatchmakingRoomJoinAttemptParams = {
  socket: MatchmakingJoinSocket | null;
  roomCode: string;
  currentJoinedRoom: string | null;
  normalizeRoomCode?: (value: unknown) => string;
};

export type MatchmakingRoomJoinEmitParams = {
  socket: MatchmakingJoinSocket;
  roomCode: string;
  identity: RoomJoinIdentity;
};

export type MatchmakingRoomJoinAckHandlers = {
  applyJoinedRoomResponse: (resp: RoomAckResponse) => void;
  showToast: (message: string, duration?: number) => void;
};

function defaultNormalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function canAttemptMatchmakingRoomJoin(params: MatchmakingRoomJoinAttemptParams): boolean {
  const normalize = params.normalizeRoomCode ?? defaultNormalizeRoomCode;
  const roomCode = normalize(params.roomCode);
  const activeSocket = params.socket;
  if (!activeSocket?.connected) {
    return false;
  }
  if (normalize(params.currentJoinedRoom) === roomCode) {
    return false;
  }
  return true;
}

export function emitMatchmakingRoomJoin(params: MatchmakingRoomJoinEmitParams): Promise<RoomAckResponse> {
  const roomCode = params.roomCode.trim().toUpperCase();
  return new Promise((resolve) => {
    params.socket.emit('room:join', roomCode, params.identity, (resp: RoomAckResponse) => {
      resolve(resp ?? {});
    });
  });
}

export function handleMatchmakingRoomJoinAck(
  resp: RoomAckResponse,
  handlers: MatchmakingRoomJoinAckHandlers,
): void {
  if (!resp?.ok) {
    handlers.showToast(resp?.error ?? 'Could not join matched room.', 2500);
    return;
  }
  handlers.applyJoinedRoomResponse(resp);
}