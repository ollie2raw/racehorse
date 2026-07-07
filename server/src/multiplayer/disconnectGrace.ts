import type { Server } from 'socket.io';
import { act, getRoom } from '../rooms';
import { canDraw, getLegalMoves } from '../game/engine';

export const DISCONNECT_GRACE_MS = 30_000;

type GraceEntry = {
  timer: ReturnType<typeof setTimeout>;
  playerId: string;
};

const graceTimersByRoom = new Map<string, GraceEntry>();

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

type SeatSocketResolver = (roomCode: string, playerSeatId: string) => string | null;

let resolveSeatSocket: SeatSocketResolver = () => null;

export function configureDisconnectGraceSeatResolver(resolver: SeatSocketResolver): void {
  resolveSeatSocket = resolver;
}

export function clearDisconnectGrace(roomCode: string): void {
  const code = normalizeRoomCode(roomCode);
  const entry = graceTimersByRoom.get(code);
  if (!entry) return;
  clearTimeout(entry.timer);
  graceTimersByRoom.delete(code);
}

export function hasActiveDisconnectGrace(roomCode: string): boolean {
  return graceTimersByRoom.has(normalizeRoomCode(roomCode));
}

export function getActiveDisconnectGracePlayerId(roomCode: string): string | null {
  return graceTimersByRoom.get(normalizeRoomCode(roomCode))?.playerId ?? null;
}

/** Test-only reset between vitest cases. */
export function resetDisconnectGraceForTests(): void {
  for (const entry of graceTimersByRoom.values()) {
    clearTimeout(entry.timer);
  }
  graceTimersByRoom.clear();
  resolveSeatSocket = () => null;
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

  graceTimersByRoom.set(normalizeRoomCode(roomCode), { timer, playerId: playerSeatId });
}

export function onPlayerSocketRejoined(roomCode: string, io: Server, playerSeatId: string): void {
  const hadGrace = graceTimersByRoom.has(normalizeRoomCode(roomCode));
  clearDisconnectGrace(roomCode);
  try {
    const room = getRoom(roomCode);
    if (room.disconnectExpiries) {
      room.disconnectExpiries[playerSeatId] = 0;
    }
  } catch {}
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
  const code = normalizeRoomCode(roomCode);
  graceTimersByRoom.delete(code);
  try {
    const room = getRoom(code);
    if (!room.state || room.state.gameOver || room.state.handOver) return;

    const currentId = room.state.playerIds[room.state.currentPlayerIndex];
    if (currentId !== disconnectedPlayerSeatId) return;

    const connectionId = resolveSeatSocket(code, disconnectedPlayerSeatId);
    const stillConnected = connectionId
      ? io.sockets.sockets.get(connectionId)?.connected
      : false;
    if (stillConnected) return;

    const legalMoves = getLegalMoves(room.state, disconnectedPlayerSeatId);
    const canPass = legalMoves.some((move) => move.type === 'pass');
    const canDrawNow = canDraw(room.state, disconnectedPlayerSeatId);

    if (canPass) {
      await act(code, disconnectedPlayerSeatId, { type: 'PASS' }, io, broadcast);
    } else if (canDrawNow) {
      await act(code, disconnectedPlayerSeatId, { type: 'DRAW' }, io, broadcast);
    } else {
      console.warn('[disconnect-grace] no legal auto-action for disconnected turn', {
        roomCode: code,
        disconnectedPlayerSeatId,
        legalMoveTypes: legalMoves.map((m) => m.type),
      });
    }

    if (!room.disconnectExpiries) {
      room.disconnectExpiries = {};
    }
    const currentCount = (room.disconnectExpiries[disconnectedPlayerSeatId] || 0) + 1;
    room.disconnectExpiries[disconnectedPlayerSeatId] = currentCount;

    if (currentCount >= 2) {
      const { getRoomRoster, getRoomPlayersWithFallback } = await import('./roomSession');
      const { applyActiveMatchForfeit } = await import('./roomForfeit');

      const rosterCached = getRoomRoster(code);
      const roster =
        rosterCached.length > 0 ? rosterCached : getRoomPlayersWithFallback(code, room.players);
      const abandoningPlayer = roster.find((p: any) => p.id === disconnectedPlayerSeatId) ?? {
        id: disconnectedPlayerSeatId,
        socketId: '',
        username: 'Opponent',
        userId: null,
      };

      const mockSocket = {
        id: abandoningPlayer.socketId || '',
        data: {
          userId: abandoningPlayer.userId,
          username: abandoningPlayer.username,
        },
      } as any;

      await applyActiveMatchForfeit(io, mockSocket, code, abandoningPlayer);
      broadcast(code);
      return;
    }

    io.to(code).emit('player:reconnect_timeout', { playerId: disconnectedPlayerSeatId });
    broadcast(code);
  } catch (error) {
    console.error('[disconnect-grace] grace expiry failed', {
      roomCode: code,
      disconnectedPlayerSeatId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
