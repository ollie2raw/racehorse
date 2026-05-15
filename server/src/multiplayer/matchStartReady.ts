import type { Server } from 'socket.io';
import { getRoom, startGame, type Room } from '../rooms';

export type MatchStartDeps = {
  broadcastStateUpdate: (roomCode: string) => void;
  onSimMatchStarted?: (room: Room) => void;
};

function requiredStartPlayers(room: Room): string[] {
  if (room.matchmakingIsSim && room.matchmakingSimSocketId) {
    const humans = room.players.filter((id) => id !== room.matchmakingSimSocketId);
    return [...humans, room.matchmakingSimSocketId];
  }
  return [...room.players];
}

export function markMatchStartReady(roomCode: string, socketId: string): Room {
  const room = getRoom(roomCode);
  room.matchStartReady.add(socketId);
  return room;
}

export async function tryStartMatchIfReady(
  roomCode: string,
  io: Server,
  deps: MatchStartDeps,
): Promise<{ started: boolean; waitingFor?: string[] }> {
  const room = getRoom(roomCode);
  if (room.state) {
    return { started: false };
  }

  const required = requiredStartPlayers(room);
  if (required.length < 2) {
    return { started: false, waitingFor: required };
  }

  // Sim seat is server-controlled — treat as ready once a human has joined it.
  if (room.matchmakingIsSim && room.matchmakingSimSocketId) {
    room.matchStartReady.add(room.matchmakingSimSocketId);
  }

  const missing = required.filter((id) => !room.matchStartReady.has(id));
  if (missing.length > 0) {
    return { started: false, waitingFor: missing };
  }

  const startedRoom = await startGame(roomCode, io);
  room.matchStartReady.clear();
  deps.broadcastStateUpdate(startedRoom.code);
  if (startedRoom.matchmakingIsSim && startedRoom.matchmakingSimSocketId) {
    deps.onSimMatchStarted?.(startedRoom);
  }
  return { started: true };
}
