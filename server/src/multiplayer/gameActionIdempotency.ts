export type GameActionAck = {
  ok: boolean;
  sequence?: number | null;
  forcedDraw?: {
    drewCount: number;
    stoppedReason: string;
    drawChainId: number | null;
  };
  error?: string;
  duplicate?: boolean;
};

type CacheEntry = {
  ack: GameActionAck;
  expiresAt: number;
};

const ACTION_IDEMPOTENCY_TTL_MS = 5 * 60_000;
const MAX_ENTRIES_PER_ROOM = 128;

const cacheByRoomCode = new Map<string, Map<string, CacheEntry>>();
const inFlightByKey = new Map<string, Promise<GameActionAck>>();

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

export function normalizeGameActionRequestId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return null;
  return trimmed;
}

function cacheKeyFor(playerSeatId: string, requestId: string): string {
  return `${playerSeatId}:${requestId}`;
}

function inFlightKeyFor(roomCode: string, playerSeatId: string, requestId: string): string {
  return `${normalizeRoomCode(roomCode)}:${cacheKeyFor(playerSeatId, requestId)}`;
}

function getRoomCache(roomCode: string): Map<string, CacheEntry> {
  const code = normalizeRoomCode(roomCode);
  let roomCache = cacheByRoomCode.get(code);
  if (!roomCache) {
    roomCache = new Map();
    cacheByRoomCode.set(code, roomCache);
  }
  return roomCache;
}

function pruneExpiredEntries(roomCode: string, now = Date.now()): void {
  const code = normalizeRoomCode(roomCode);
  const roomCache = cacheByRoomCode.get(code);
  if (!roomCache) return;

  for (const [key, entry] of roomCache.entries()) {
    if (entry.expiresAt <= now) {
      roomCache.delete(key);
    }
  }
  if (roomCache.size === 0) {
    cacheByRoomCode.delete(code);
  }
}

function enforceRoomCacheLimit(roomCode: string): void {
  const roomCache = getRoomCache(roomCode);
  while (roomCache.size > MAX_ENTRIES_PER_ROOM) {
    const oldestKey = roomCache.keys().next().value;
    if (!oldestKey) break;
    roomCache.delete(oldestKey);
  }
}

function readCachedAck(
  roomCode: string,
  playerSeatId: string,
  requestId: string,
): GameActionAck | null {
  pruneExpiredEntries(roomCode);
  const roomCache = cacheByRoomCode.get(normalizeRoomCode(roomCode));
  if (!roomCache) return null;
  const entry = roomCache.get(cacheKeyFor(playerSeatId, requestId));
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return { ...entry.ack, duplicate: true };
}

function storeSuccessfulAck(
  roomCode: string,
  playerSeatId: string,
  requestId: string,
  ack: GameActionAck,
): void {
  if (!ack.ok) return;
  const roomCache = getRoomCache(roomCode);
  roomCache.set(cacheKeyFor(playerSeatId, requestId), {
    ack: {
      ok: ack.ok,
      sequence: ack.sequence ?? null,
      ...(ack.forcedDraw ? { forcedDraw: ack.forcedDraw } : {}),
    },
    expiresAt: Date.now() + ACTION_IDEMPOTENCY_TTL_MS,
  });
  enforceRoomCacheLimit(roomCode);
}

/**
 * Server-authoritative idempotency for retried `game:action` submissions.
 * Only successful mutations are cached; failures are not replay-blocked.
 */
export async function withGameActionIdempotency(
  roomCode: string,
  playerSeatId: string,
  requestId: unknown,
  execute: () => Promise<GameActionAck>,
): Promise<GameActionAck> {
  const normalizedRequestId = normalizeGameActionRequestId(requestId);
  if (!normalizedRequestId) {
    return execute();
  }

  const cached = readCachedAck(roomCode, playerSeatId, normalizedRequestId);
  if (cached) return cached;

  const inflightKey = inFlightKeyFor(roomCode, playerSeatId, normalizedRequestId);
  const existing = inFlightByKey.get(inflightKey);
  if (existing) {
    const ack = await existing;
    return ack.ok ? { ...ack, duplicate: true } : ack;
  }

  const inflight = (async () => {
    const result = await execute();
    if (result.ok) {
      storeSuccessfulAck(roomCode, playerSeatId, normalizedRequestId, result);
    }
    return result;
  })().finally(() => {
    inFlightByKey.delete(inflightKey);
  });

  inFlightByKey.set(inflightKey, inflight);
  return inflight;
}

export function clearGameActionIdempotencyForRoom(roomCode: string): void {
  const code = normalizeRoomCode(roomCode);
  cacheByRoomCode.delete(code);
  for (const key of inFlightByKey.keys()) {
    if (key.startsWith(`${code}:`)) {
      inFlightByKey.delete(key);
    }
  }
}

export function getGameActionIdempotencyCacheSize(roomCode: string): number {
  pruneExpiredEntries(roomCode);
  return cacheByRoomCode.get(normalizeRoomCode(roomCode))?.size ?? 0;
}

/** Test-only reset between vitest cases. */
export function resetGameActionIdempotencyForTests(): void {
  cacheByRoomCode.clear();
  inFlightByKey.clear();
}

export const GAME_ACTION_IDEMPOTENCY_TTL_MS = ACTION_IDEMPOTENCY_TTL_MS;