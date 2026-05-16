import type { Server } from 'socket.io';
import { act, getRoom } from '../rooms';
import { canDraw, getLegalMoves } from '../game/engine';

const DISCONNECT_GRACE_MS = 30_000;

type GraceEntry = {
  timer: ReturnType<typeof setTimeout>;
  playerId: string;
};

const graceTimersByRoom = new Map<string, GraceEntry>();

type SeatSocketResolver = (roomCode: string, playerSeatId: string) => string | null;

let resolveSeatSocket: SeatSocketResolver = () => null;

export function configureDisconnectGraceSeatResolver(resolver: SeatSocketResolver): void {
  resolveSeatSocket = resolver;
}

export function clearDisconnectGrace(roomCode: string): void {
  const entry = graceTimersByRoom.get(roomCode);
  if (!entry) return;
  clearTimeout(entry.timer);
  graceTimersByRoom.delete(roomCode);
}

export function onActivePlayerSocketDisconnect(
  roomCode: string,
  playerSeatId: string,
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
  if (!room.players.includes(playerSeatId)) return;

  clearDisconnectGrace(roomCode);

  io.to(roomCode).emit('player:disconnected', {
    playerId: playerSeatId,
    graceMs: DISCONNECT_GRACE_MS,
  });

  const timer = setTimeout(() => {
    void handleDisconnectGraceExpired(roomCode, playerSeatId, io, broadcast);
  }, DISCONNECT_GRACE_MS);

  graceTimersByRoom.set(roomCode, { timer, playerId: playerSeatId });
}

export function onPlayerSocketRejoined(roomCode: string, io: Server, playerSeatId: string): void {
  const hadGrace = graceTimersByRoom.has(roomCode);
  clearDisconnectGrace(roomCode);
  if (hadGrace) {
    io.to(roomCode).emit('player:reconnected', { playerId: playerSeatId });
  }
}

async function handleDisconnectGraceExpired(
  roomCode: string,
  disconnectedPlayerSeatId: string,
  io: Server,
  broadcast: (roomCode: string) => void,
): Promise<void> {
  graceTimersByRoom.delete(roomCode);
  try {
    const room = getRoom(roomCode);
    if (!room.state || room.state.gameOver || room.state.handOver) return;

    const currentId = room.state.playerIds[room.state.currentPlayerIndex];
    if (currentId !== disconnectedPlayerSeatId) return;

    const connectionId = resolveSeatSocket(roomCode, disconnectedPlayerSeatId);
    const stillConnected = connectionId
      ? io.sockets.sockets.get(connectionId)?.connected
      : false;
    if (stillConnected) return;

    const legalMoves = getLegalMoves(room.state, disconnectedPlayerSeatId);
    const canPass = legalMoves.some((move) => move.type === 'pass');
    const canDrawNow = canDraw(room.state, disconnectedPlayerSeatId);

    if (canPass) {
      await act(roomCode, disconnectedPlayerSeatId, { type: 'PASS' }, io, broadcast);
    } else if (canDrawNow) {
      await act(roomCode, disconnectedPlayerSeatId, { type: 'DRAW' }, io, broadcast);
    } else {
      console.warn('[disconnect-grace] no legal auto-action for disconnected turn', {
        roomCode,
        disconnectedPlayerSeatId,
        legalMoveTypes: legalMoves.map((m) => m.type),
      });
    }

    io.to(roomCode).emit('player:reconnect_timeout', { playerId: disconnectedPlayerSeatId });
    broadcast(roomCode);
  } catch (error) {
    console.error('[disconnect-grace] grace expiry failed', {
      roomCode,
      disconnectedPlayerSeatId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
