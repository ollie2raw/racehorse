import type { Server } from 'socket.io';
import { act, getRoom } from '../rooms';
import { canDraw, getLegalMoves } from '../game/engine';

export const DISCONNECT_GRACE_MS = 30_000;

type GraceEntry = {
  timer: ReturnType<typeof setTimeout>;
  playerId: string;
};

const graceTimersByRoomSeat = new Map<string, GraceEntry>();

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

function graceKey(roomCode: string, playerSeatId: string): string {
  return `${normalizeRoomCode(roomCode)}:${playerSeatId}`;
}

type SeatSocketResolver = (roomCode: string, playerSeatId: string) => string | null;

let resolveSeatSocket: SeatSocketResolver = () => null;

export function configureDisconnectGraceSeatResolver(resolver: SeatSocketResolver): void {
  resolveSeatSocket = resolver;
}

export function clearDisconnectGrace(roomCode: string): void {
  const code = normalizeRoomCode(roomCode);
  for (const [key, entry] of graceTimersByRoomSeat) {
    if (!key.startsWith(`${code}:`)) continue;
    clearTimeout(entry.timer);
    graceTimersByRoomSeat.delete(key);
  }
}

function clearDisconnectGraceForSeat(roomCode: string, playerSeatId: string): boolean {
  const key = graceKey(roomCode, playerSeatId);
  const entry = graceTimersByRoomSeat.get(key);
  if (!entry) return false;
  clearTimeout(entry.timer);
  graceTimersByRoomSeat.delete(key);
  return true;
}

export function hasActiveDisconnectGrace(roomCode: string): boolean {
  const code = normalizeRoomCode(roomCode);
  for (const key of graceTimersByRoomSeat.keys()) {
    if (key.startsWith(`${code}:`)) return true;
  }
  return false;
}

export function getActiveDisconnectGracePlayerId(roomCode: string): string | null {
  const code = normalizeRoomCode(roomCode);
  for (const [key, entry] of graceTimersByRoomSeat) {
    if (key.startsWith(`${code}:`)) return entry.playerId;
  }
  return null;
}

export function hasActiveDisconnectGraceForSeat(roomCode: string, playerSeatId: string): boolean {
  return graceTimersByRoomSeat.has(graceKey(roomCode, playerSeatId));
}

/** Test-only reset between vitest cases. */
export function resetDisconnectGraceForTests(): void {
  for (const entry of graceTimersByRoomSeat.values()) {
    clearTimeout(entry.timer);
  }
  graceTimersByRoomSeat.clear();
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

  clearDisconnectGraceForSeat(roomCode, playerSeatId);

  io.to(roomCode).emit('player:disconnected', {
    playerId: playerSeatId,
    graceMs: DISCONNECT_GRACE_MS,
  });

  const timer = setTimeout(() => {
    void handleDisconnectGraceExpired(roomCode, playerSeatId, io, broadcast);
  }, DISCONNECT_GRACE_MS);

  graceTimersByRoomSeat.set(graceKey(roomCode, playerSeatId), { timer, playerId: playerSeatId });
}

export function onPlayerSocketRejoined(roomCode: string, io: Server, playerSeatId: string): void {
  const hadGrace = clearDisconnectGraceForSeat(roomCode, playerSeatId);
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
  graceTimersByRoomSeat.delete(graceKey(code, disconnectedPlayerSeatId));
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

      await applyActiveMatchForfeit(io, mockSocket, code, abandoningPlayer, 'disconnect_timeout');
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
