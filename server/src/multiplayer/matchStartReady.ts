import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import type { Room } from '../rooms';
import { emitMpAuthorityFunnel, resolveMpAuthoritySourceType } from './mpAuthorityTelemetry';

export type MatchStartDeps = {
  broadcastStateUpdate: (roomCode: string) => void;
  onSimMatchStarted?: (room: Room) => void;
};

function requiredStartPlayers(room: Room): string[] {
  return [...room.players];
}

export function markMatchStartReady(roomCode: string, socketId: string): Room {
  const room = rooms.getRoom(roomCode);
  room.matchStartReady.add(socketId);
  return room;
}

export async function tryStartMatchIfReady(
  roomCode: string,
  io: Server,
  deps: MatchStartDeps,
): Promise<{ started: boolean; waitingFor?: string[] }> {
  const room = rooms.getRoom(roomCode);
  if (room.state) {
    return { started: false };
  }

  const required = requiredStartPlayers(room);
  if (required.length < 2) {
    return { started: false, waitingFor: required };
  }

  const missing = required.filter((id) => !room.matchStartReady.has(id));
  if (missing.length > 0) {
    return { started: false, waitingFor: missing };
  }

  const startedRoom = await rooms.initiatePregameDrawOrStart(roomCode, io);
  room.matchStartReady.clear();
  deps.broadcastStateUpdate(startedRoom.code);
  emitMpAuthorityFunnel('private_match_started', {
    roomCode: startedRoom.code,
    sourceType: resolveMpAuthoritySourceType(startedRoom),
  });
  return { started: true };
}
