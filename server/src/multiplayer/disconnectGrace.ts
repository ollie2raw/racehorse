import type { Server, Socket } from 'socket.io';
import {
  act,
  captureRoomGameplaySnapshot,
  getRoom,
  rollbackRoomGameplayCommit,
  type RoomGameplaySnapshot,
} from '../rooms';
import { canDraw, getLegalMoves } from '../game/engine';
import { childLogger } from '../logger';
import type { RoomPlayer } from './roomSession';
import { evaluateRoomDurabilityOperation } from './roomDurabilityPolicy';
import {
  flushScheduledLiveRoomPersistence,
  getLiveRoomDurabilityState,
  isLiveRoomDurablyRecoverable,
} from './roomLivePersistence';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';

const log = childLogger('disconnect-grace');

export const DISCONNECT_GRACE_MS = 30_000;
/** Retry spacing after a durability-blocked or flush-failed auto-act. */
export const DISCONNECT_DURABILITY_RETRY_MS = 10_000;
/** Max durability retries after the initial grace expiry (6 × 10s = 60s). Then pause. */
export const DISCONNECT_DURABILITY_MAX_RETRIES = 6;

/** Seat B banner while durability retries are still scheduled (Path 1 and Path 2). */
export const DISCONNECT_STALL_RETRY_MESSAGE =
  "Opponent still disconnected. Auto-move couldn't be saved — waiting for server recovery…";

/** Seat B banner after retry ceiling — match paused, no forfeit, no more auto-act timers. */
export const DISCONNECT_STALL_PAUSED_MESSAGE =
  "We're having technical issues saving this match. The game is paused — hang tight.";

type GraceEntry = {
  timer: ReturnType<typeof setTimeout>;
  playerId: string;
  durabilityRetryCount: number;
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

export function listActiveDisconnectGraceSeats(roomCode: string): string[] {
  const prefix = `${normalizeRoomCode(roomCode)}:`;
  const seats: string[] = [];
  for (const key of graceTimersByRoomSeat.keys()) {
    if (!key.startsWith(prefix)) continue;
    seats.push(key.slice(prefix.length));
  }
  return seats.sort();
}

/** Test-only reset between vitest cases. */
export function resetDisconnectGraceForTests(): void {
  for (const entry of graceTimersByRoomSeat.values()) {
    clearTimeout(entry.timer);
  }
  graceTimersByRoomSeat.clear();
  resolveSeatSocket = () => null;
}

function emitDisconnectStall(
  io: Server,
  roomCode: string,
  playerSeatId: string,
  phase: 'retry' | 'paused',
  message: string,
): void {
  io.to(roomCode).emit('player:disconnect_stall', {
    playerId: playerSeatId,
    phase,
    message,
  });
}

function scheduleDisconnectGraceTimer(
  roomCode: string,
  playerSeatId: string,
  io: Server,
  broadcast: (roomCode: string) => void,
  delayMs: number,
  durabilityRetryCount: number,
): void {
  const code = normalizeRoomCode(roomCode);
  clearDisconnectGraceForSeat(code, playerSeatId);
  const timer = setTimeout(() => {
    void handleDisconnectGraceExpired(code, playerSeatId, io, broadcast, durabilityRetryCount);
  }, delayMs);
  graceTimersByRoomSeat.set(graceKey(code, playerSeatId), {
    timer,
    playerId: playerSeatId,
    durabilityRetryCount,
  });
}

function handleDurabilityStall(
  roomCode: string,
  disconnectedPlayerSeatId: string,
  io: Server,
  broadcast: (roomCode: string) => void,
  durabilityRetryCount: number,
  failureCode: 'room_persistence_failed' | 'room_degraded' | 'room_failed',
  extra?: Record<string, unknown>,
): void {
  const nextRetry = durabilityRetryCount + 1;
  if (nextRetry > DISCONNECT_DURABILITY_MAX_RETRIES) {
    emitMpAuthorityFunnel('private_disconnect_auto_act_paused', {
      roomCode,
      seatId: disconnectedPlayerSeatId,
      failureCode,
      extra: {
        durabilityRetryCount,
        ...extra,
      },
    });
    emitDisconnectStall(
      io,
      roomCode,
      disconnectedPlayerSeatId,
      'paused',
      DISCONNECT_STALL_PAUSED_MESSAGE,
    );
    log.warn(
      { roomCode, disconnectedPlayerSeatId, durabilityRetryCount, failureCode, ...extra },
      'disconnect auto-act paused after durability retry ceiling',
    );
    return;
  }

  emitMpAuthorityFunnel('private_disconnect_auto_act_deferred', {
    roomCode,
    seatId: disconnectedPlayerSeatId,
    failureCode,
    extra: {
      durabilityRetryCount: nextRetry,
      maxRetries: DISCONNECT_DURABILITY_MAX_RETRIES,
      retryMs: DISCONNECT_DURABILITY_RETRY_MS,
      ...extra,
    },
  });
  emitDisconnectStall(
    io,
    roomCode,
    disconnectedPlayerSeatId,
    'retry',
    DISCONNECT_STALL_RETRY_MESSAGE,
  );
  scheduleDisconnectGraceTimer(
    roomCode,
    disconnectedPlayerSeatId,
    io,
    broadcast,
    DISCONNECT_DURABILITY_RETRY_MS,
    nextRetry,
  );
  log.warn(
    {
      roomCode,
      disconnectedPlayerSeatId,
      durabilityRetryCount: nextRetry,
      failureCode,
      ...extra,
    },
    'disconnect auto-act deferred; scheduled durability retry',
  );
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

  io.to(roomCode).emit('player:disconnected', {
    playerId: playerSeatId,
    graceMs: DISCONNECT_GRACE_MS,
  });

  scheduleDisconnectGraceTimer(roomCode, playerSeatId, io, broadcast, DISCONNECT_GRACE_MS, 0);
}

export function onPlayerSocketRejoined(roomCode: string, io: Server, playerSeatId: string): void {
  const hadGrace = clearDisconnectGraceForSeat(roomCode, playerSeatId);
  try {
    const room = getRoom(roomCode);
    if (room.disconnectExpiries) {
      room.disconnectExpiries[playerSeatId] = 0;
    }
  } catch {
    // room already gone — the grace clear above is the only thing that mattered
  }
  if (hadGrace) {
    io.to(roomCode).emit('player:reconnected', { playerId: playerSeatId });
  }
}

async function handleDisconnectGraceExpired(
  roomCode: string,
  disconnectedPlayerSeatId: string,
  io: Server,
  broadcast: (roomCode: string) => void,
  durabilityRetryCount: number,
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

    const durabilityDecision = evaluateRoomDurabilityOperation(room, 'gameplay_action');
    if (!durabilityDecision.allowed) {
      handleDurabilityStall(
        code,
        disconnectedPlayerSeatId,
        io,
        broadcast,
        durabilityRetryCount,
        durabilityDecision.error === 'room_degraded' ? 'room_degraded' : 'room_persistence_failed',
        { phase: 'pre_act', reason: durabilityDecision.reason },
      );
      return;
    }

    const legalMoves = getLegalMoves(room.state, disconnectedPlayerSeatId);
    const canPass = legalMoves.some((move) => move.type === 'pass');
    const canDrawNow = canDraw(room.state, disconnectedPlayerSeatId);

    const snapshot: RoomGameplaySnapshot | null = captureRoomGameplaySnapshot(room);
    if (!snapshot) return;

    if (canPass) {
      await act(code, disconnectedPlayerSeatId, { type: 'PASS' }, io, broadcast);
    } else if (canDrawNow) {
      await act(code, disconnectedPlayerSeatId, { type: 'DRAW' }, io, broadcast);
    } else {
      log.warn(
        {
          roomCode: code,
          disconnectedPlayerSeatId,
          legalMoveTypes: legalMoves.map((m) => m.type),
        },
        'no legal auto-action for disconnected turn',
      );
      return;
    }

    await flushScheduledLiveRoomPersistence(code);
    const durability = getLiveRoomDurabilityState(room);
    const committed = isLiveRoomDurablyRecoverable(room);
    if (!committed) {
      rollbackRoomGameplayCommit(room, snapshot);
      handleDurabilityStall(
        code,
        disconnectedPlayerSeatId,
        io,
        broadcast,
        durabilityRetryCount,
        durability.status === 'degraded' ? 'room_degraded' : 'room_persistence_failed',
        {
          phase: 'post_flush',
          durabilityStatus: durability.status,
          sequence: room.state?.sequence ?? null,
        },
      );
      return;
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
      const abandoningPlayer: RoomPlayer = roster.find((p) => p.id === disconnectedPlayerSeatId) ?? {
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
      } as unknown as Socket;

      await applyActiveMatchForfeit(io, mockSocket, code, abandoningPlayer, 'disconnect_timeout');
      broadcast(code);
      return;
    }

    io.to(code).emit('player:reconnect_timeout', { playerId: disconnectedPlayerSeatId });
    broadcast(code);
  } catch (error) {
    log.error({ err: error, roomCode: code, disconnectedPlayerSeatId }, 'grace expiry failed');
    try {
      handleDurabilityStall(
        code,
        disconnectedPlayerSeatId,
        io,
        broadcast,
        durabilityRetryCount,
        'room_persistence_failed',
        {
          phase: 'exception',
          error: error instanceof Error ? error.message : String(error),
        },
      );
    } catch (stallError) {
      log.error(
        { err: stallError, roomCode: code, disconnectedPlayerSeatId },
        'disconnect stall emit failed after grace expiry error',
      );
    }
  }
}
