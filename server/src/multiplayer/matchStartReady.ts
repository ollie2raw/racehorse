import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import type { Room } from '../rooms';
import { withRoomGameplayLock } from './roomGameplayLock';
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

/**
 * Shared private / matchmaking / tournament match-start gate.
 * Holds the room gameplay lock for the ready-check + deal so concurrent
 * start signals cannot both pass "not yet started" and double-deal (M3).
 */
export async function tryStartMatchIfReady(
  roomCode: string,
  io: Server,
  deps: MatchStartDeps,
): Promise<{ started: boolean; waitingFor?: string[] }> {
  return withRoomGameplayLock(roomCode, async () => {
    const room = rooms.getRoom(roomCode);
    if (room.state) {
      // Already started (including coalesced concurrent waiter).
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

    const startedRoom = await rooms.initiatePregameDrawOrStartUnlocked(roomCode, io);
    room.matchStartReady.clear();
    deps.broadcastStateUpdate(startedRoom.code);
    emitMpAuthorityFunnel('private_match_started', {
      roomCode: startedRoom.code,
      sourceType: resolveMpAuthoritySourceType(startedRoom),
    });
    return { started: true };
  });
}
