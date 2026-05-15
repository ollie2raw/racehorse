import type { Server } from 'socket.io';
import { act, getRoom } from '../rooms';
import { canDraw, getLegalMoves } from '../game/engine';

const DISCONNECT_GRACE_MS = 30_000;

type GraceEntry = {
  timer: ReturnType<typeof setTimeout>;
  playerId: string;
};

const graceTimersByRoom = new Map<string, GraceEntry>();

export function clearDisconnectGrace(roomCode: string): void {
  const entry = graceTimersByRoom.get(roomCode);
  if (!entry) return;
  clearTimeout(entry.timer);
  graceTimersByRoom.delete(roomCode);
}

export function onActivePlayerSocketDisconnect(
  roomCode: string,
  socketId: string,
  io: Server,
  broadcast: (roomCode: string) => void,
): void {
  let room;
  try {
    room = getRoom(roomCode);
  } catch {
    return;
  }
  if (!room.state || room.state.gameOver || room.state.handOver) return;
  if (!room.players.includes(socketId)) return;

  clearDisconnectGrace(roomCode);

  io.to(roomCode).emit('player:disconnected', {
    playerId: socketId,
    graceMs: DISCONNECT_GRACE_MS,
  });

  const timer = setTimeout(() => {
    void handleDisconnectGraceExpired(roomCode, socketId, io, broadcast);
  }, DISCONNECT_GRACE_MS);

  graceTimersByRoom.set(roomCode, { timer, playerId: socketId });
}

export function onPlayerSocketRejoined(roomCode: string, io: Server, socketId: string): void {
  const hadGrace = graceTimersByRoom.has(roomCode);
  clearDisconnectGrace(roomCode);
  if (hadGrace) {
    io.to(roomCode).emit('player:reconnected', { playerId: socketId });
  }
}

async function handleDisconnectGraceExpired(
  roomCode: string,
  disconnectedPlayerId: string,
  io: Server,
  broadcast: (roomCode: string) => void,
): Promise<void> {
  graceTimersByRoom.delete(roomCode);
  try {
    const room = getRoom(roomCode);
    if (!room.state || room.state.gameOver || room.state.handOver) return;

    const currentId = room.state.playerIds[room.state.currentPlayerIndex];
    if (currentId !== disconnectedPlayerId) return;

    const stillConnected = io.sockets.sockets.get(disconnectedPlayerId)?.connected;
    if (stillConnected) return;

    const legalMoves = getLegalMoves(room.state, disconnectedPlayerId);
    const canPass = legalMoves.some((move) => move.type === 'pass');
    const canDrawNow = canDraw(room.state, disconnectedPlayerId);

    if (canPass) {
      await act(roomCode, disconnectedPlayerId, { type: 'PASS' }, io, broadcast);
    } else if (canDrawNow) {
      await act(roomCode, disconnectedPlayerId, { type: 'DRAW' }, io, broadcast);
    } else {
      console.warn('[disconnect-grace] no legal auto-action for disconnected turn', {
        roomCode,
        disconnectedPlayerId,
        legalMoveTypes: legalMoves.map((m) => m.type),
      });
    }

    io.to(roomCode).emit('player:reconnect_timeout', { playerId: disconnectedPlayerId });
    broadcast(roomCode);
  } catch (error) {
    console.error('[disconnect-grace] grace expiry failed', {
      roomCode,
      disconnectedPlayerId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
