import {
  deleteRoomCommandReceiptsForRoom,
  persistRoomCommandReceipt,
} from './roomCommandReceiptStore';

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
  uncertain?: boolean;
};

export type PersistedGameActionReceipt = {
  playerSeatId: string;
  requestId: string;
  ack: Omit<GameActionAck, 'duplicate'>;
  expiresAt: number;
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

function storeCachedAck(
  roomCode: string,
  playerSeatId: string,
  requestId: string,
  ack: GameActionAck,
): void {
  if (!ack.ok && !ack.uncertain) return;
  const roomCache = getRoomCache(roomCode);
  roomCache.set(cacheKeyFor(playerSeatId, requestId), {
    ack: {
      ok: ack.ok,
      sequence: ack.sequence ?? null,
      ...(ack.forcedDraw ? { forcedDraw: ack.forcedDraw } : {}),
      ...(ack.error ? { error: ack.error } : {}),
      ...(ack.uncertain ? { uncertain: ack.uncertain } : {}),
    },
    expiresAt: Date.now() + ACTION_IDEMPOTENCY_TTL_MS,
  });
  enforceRoomCacheLimit(roomCode);
}

/**
 * Snapshot in-memory receipts for durable live-session persistence.
 * Survives process restart when rehydrated from `room_shell.actionReceipts`.
 */
export function snapshotGameActionReceiptsForRoom(
  roomCode: string,
  now = Date.now(),
): PersistedGameActionReceipt[] {
  pruneExpiredEntries(roomCode, now);
  const roomCache = cacheByRoomCode.get(normalizeRoomCode(roomCode));
  if (!roomCache || roomCache.size === 0) return [];

  const receipts: PersistedGameActionReceipt[] = [];
  for (const [key, entry] of roomCache.entries()) {
    if (entry.expiresAt <= now) continue;
    const separator = key.indexOf(':');
    if (separator <= 0) continue;
    const playerSeatId = key.slice(0, separator);
    const requestId = key.slice(separator + 1);
    if (!playerSeatId || !requestId) continue;
    receipts.push({
      playerSeatId,
      requestId,
      ack: {
        ok: entry.ack.ok,
        sequence: entry.ack.sequence ?? null,
        ...(entry.ack.forcedDraw ? { forcedDraw: entry.ack.forcedDraw } : {}),
        ...(entry.ack.error ? { error: entry.ack.error } : {}),
        ...(entry.ack.uncertain ? { uncertain: entry.ack.uncertain } : {}),
      },
      expiresAt: entry.expiresAt,
    });
  }
  return receipts;
}

/**
 * Restore receipts after live-session hydration / process restart.
 * Does not clear newer in-memory entries for the same room.
 */
export function hydrateGameActionReceiptsForRoom(
  roomCode: string,
  receipts: unknown,
  now = Date.now(),
): number {
  if (!Array.isArray(receipts) || receipts.length === 0) return 0;
  const roomCache = getRoomCache(roomCode);
  let restored = 0;
  for (const raw of receipts) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<PersistedGameActionReceipt>;
    if (typeof entry.playerSeatId !== 'string' || !entry.playerSeatId.trim()) continue;
    if (typeof entry.requestId !== 'string' || !entry.requestId.trim()) continue;
    if (typeof entry.expiresAt !== 'number' || !Number.isFinite(entry.expiresAt)) continue;
    if (entry.expiresAt <= now) continue;
    if (!entry.ack || typeof entry.ack !== 'object') continue;
    const ack = entry.ack as GameActionAck;
    if (typeof ack.ok !== 'boolean') continue;
    if (!ack.ok && !ack.uncertain) continue;

    const key = cacheKeyFor(entry.playerSeatId, entry.requestId);
    const existing = roomCache.get(key);
    if (existing && existing.expiresAt >= entry.expiresAt) continue;

    roomCache.set(key, {
      ack: {
        ok: ack.ok,
        sequence: typeof ack.sequence === 'number' ? ack.sequence : null,
        ...(ack.forcedDraw ? { forcedDraw: ack.forcedDraw } : {}),
        ...(typeof ack.error === 'string' ? { error: ack.error } : {}),
        ...(ack.uncertain ? { uncertain: true } : {}),
      },
      expiresAt: entry.expiresAt,
    });
    restored += 1;
  }
  enforceRoomCacheLimit(roomCode);
  return restored;
}

/**
 * Server-authoritative idempotency for retried `game:action` submissions.
 * Successful and uncertain mutations are cached; plain failures are not replay-blocked.
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
    if (result.ok || result.uncertain) {
      storeCachedAck(roomCode, playerSeatId, normalizedRequestId, result);
      const expiresAtMs = Date.now() + ACTION_IDEMPOTENCY_TTL_MS;
      void persistRoomCommandReceipt({
        roomCode,
        playerSeatId,
        requestId: normalizedRequestId,
        ack: {
          ok: result.ok,
          sequence: result.sequence ?? null,
          ...(result.forcedDraw ? { forcedDraw: result.forcedDraw } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(result.uncertain ? { uncertain: result.uncertain } : {}),
        },
        expiresAtMs,
      });
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
  void deleteRoomCommandReceiptsForRoom(code);
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
