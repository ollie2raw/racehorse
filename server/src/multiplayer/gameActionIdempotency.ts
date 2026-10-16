import { createHash } from 'node:crypto';
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
  /** hand:ready / game:start lifecycle fields */
  started?: boolean;
  ignored?: boolean;
  handNumber?: number | null;
  waitMs?: number;
  waitingFor?: string[];
  /** Machine-readable rejection category (see classifyCommandError). */
  code?: string;
  /** Internal: payload fingerprint bound to the request id. Never sent to clients. */
  fp?: string;
  /** Internal: the command was valid but changed nothing; do not spend a receipt on it. */
  noop?: boolean;
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
const inFlightFingerprints = new Map<string, string>();

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

/** Ack for a request id reused with a different payload. Fails closed; no mutation is attempted. */
export const REQUEST_ID_CONFLICT_ERROR = 'request_id_conflict';

/**
 * Stable digest of what a command asks for (never of the request id). A request id names exactly one
 * command: reusing it with a different payload is a client bug or a forgery, not a retry.
 */
export function fingerprintGameCommand(kind: string, payload: unknown): string {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const move = p.move && typeof p.move === 'object' ? (p.move as Record<string, unknown>) : {};
  const tile = move.tile && typeof move.tile === 'object' ? (move.tile as Record<string, unknown>) : {};
  const canonical = JSON.stringify([
    kind,
    typeof p.type === 'string' ? p.type : null,
    typeof tile.high === 'number' ? tile.high : null,
    typeof tile.low === 'number' ? tile.low : null,
    typeof move.position === 'string' ? move.position : null,
    typeof p.handNumber === 'number' ? p.handNumber : null,
  ]);
  return createHash('sha256').update(canonical).digest('base64url').slice(0, 22);
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

function stripInternal(ack: GameActionAck): GameActionAck {
  const { fp: _fp, noop: _noop, ...rest } = ack;
  return rest;
}

function storeCachedAck(
  roomCode: string,
  playerSeatId: string,
  requestId: string,
  ack: GameActionAck,
): void {
  // Only durable successes are replay-blocked. Uncertain means rollback —
  // the actor must be able to re-execute the same requestId on retry.
  if (!ack.ok) return;
  const roomCache = getRoomCache(roomCode);
  roomCache.set(cacheKeyFor(playerSeatId, requestId), {
    ack: {
      ok: ack.ok,
      sequence: ack.sequence ?? null,
      ...(ack.forcedDraw ? { forcedDraw: ack.forcedDraw } : {}),
      ...(ack.error ? { error: ack.error } : {}),
      ...(typeof ack.started === 'boolean' ? { started: ack.started } : {}),
      ...(typeof ack.ignored === 'boolean' ? { ignored: ack.ignored } : {}),
      ...(ack.handNumber !== undefined ? { handNumber: ack.handNumber } : {}),
      ...(typeof ack.waitMs === 'number' ? { waitMs: ack.waitMs } : {}),
      ...(ack.fp ? { fp: ack.fp } : {}),
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
        ...(entry.ack.fp ? { fp: entry.ack.fp } : {}),
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
    // Skip legacy uncertain receipts — they must not block post-rollback retries.
    if (!ack.ok) continue;

    const key = cacheKeyFor(entry.playerSeatId, entry.requestId);
    const existing = roomCache.get(key);
    if (existing && existing.expiresAt >= entry.expiresAt) continue;

    roomCache.set(key, {
      ack: {
        ok: ack.ok,
        sequence: typeof ack.sequence === 'number' ? ack.sequence : null,
        ...(ack.forcedDraw ? { forcedDraw: ack.forcedDraw } : {}),
        ...(typeof ack.error === 'string' ? { error: ack.error } : {}),
        ...(typeof ack.fp === 'string' && ack.fp.length <= 64 ? { fp: ack.fp } : {}),
      },
      expiresAt: entry.expiresAt,
    });
    restored += 1;
  }
  enforceRoomCacheLimit(roomCode);
  return restored;
}

export type WithGameActionIdempotencyOptions = {
  /**
   * Gate for the dedicated `room_command_receipts` table write. When supplied,
   * the receipt row is persisted only once this resolves `true` — i.e. only
   * after the move is durable in `room_live_sessions`. This preserves the
   * invariant that the receipt table never leads the room snapshot: if the
   * snapshot write for this move is lost to a restart, no receipt exists to
   * block the client's retry, so the lost move is correctly re-applied.
   * Absent → the receipt is persisted immediately (callers whose `execute()`
   * only returns after the move is already durable, e.g. `hand:ready`).
   */
  deferReceiptPersistUntilDurable?: () => Promise<boolean>;
  /** Digest of the command payload (see fingerprintGameCommand). Enables request-id conflict detection. */
  fingerprint?: string;
  /** Match the receipt belongs to (stored with the durable receipt row). */
  matchId?: string | null;
};

/**
 * Server-authoritative idempotency for retried `game:action` submissions.
 * Only durable successes are cached/persisted. Uncertain (rolled-back) and
 * plain failures are not replay-blocked so the actor can retry.
 */
export async function withGameActionIdempotency(
  roomCode: string,
  playerSeatId: string,
  requestId: unknown,
  execute: () => Promise<GameActionAck>,
  options: WithGameActionIdempotencyOptions = {},
): Promise<GameActionAck> {
  const normalizedRequestId = normalizeGameActionRequestId(requestId);
  if (!normalizedRequestId) {
    return execute();
  }

  const conflict = (): GameActionAck => ({ ok: false, error: REQUEST_ID_CONFLICT_ERROR });
  const cached = readCachedAck(roomCode, playerSeatId, normalizedRequestId);
  if (cached) {
    // Receipts written before fingerprints existed carry none and keep their old (id-only) behavior.
    if (cached.fp && options.fingerprint && cached.fp !== options.fingerprint) return conflict();
    return stripInternal(cached);
  }

  const inflightKey = inFlightKeyFor(roomCode, playerSeatId, normalizedRequestId);
  const existing = inFlightByKey.get(inflightKey);
  if (existing) {
    if (inFlightFingerprints.get(inflightKey) !== options.fingerprint && options.fingerprint) return conflict();
    const ack = await existing;
    return ack.ok ? { ...stripInternal(ack), duplicate: true } : stripInternal(ack);
  }

  const inflight = (async () => {
    const executed = await execute();
    const result: GameActionAck = options.fingerprint && executed.ok ? { ...executed, fp: options.fingerprint } : executed;
    if (result.ok && !result.noop) {
      storeCachedAck(roomCode, playerSeatId, normalizedRequestId, result);
      const expiresAtMs = Date.now() + ACTION_IDEMPOTENCY_TTL_MS;
      const writeReceipt = () =>
        void persistRoomCommandReceipt({
          roomCode,
          playerSeatId,
          requestId: normalizedRequestId,
          matchId: options.matchId ?? null,
          ack: {
            ok: true,
            sequence: result.sequence ?? null,
            ...(result.forcedDraw ? { forcedDraw: result.forcedDraw } : {}),
            ...(result.error ? { error: result.error } : {}),
            ...(result.fp ? { fp: result.fp } : {}),
          },
          expiresAtMs,
        });
      if (options.deferReceiptPersistUntilDurable) {
        void options
          .deferReceiptPersistUntilDurable()
          .then((durable) => {
            if (durable) writeReceipt();
          })
          .catch(() => {
            /* snapshot persist failed — no receipt, retry re-executes */
          });
      } else {
        writeReceipt();
      }
    }
    return result;
  })().finally(() => {
    inFlightByKey.delete(inflightKey);
    inFlightFingerprints.delete(inflightKey);
  });

  if (options.fingerprint) inFlightFingerprints.set(inflightKey, options.fingerprint);
  inFlightByKey.set(inflightKey, inflight);
  return inflight.then(stripInternal);
}

/**
 * Receipt lookup without executing: lets a handler answer a retry of an already-applied command with
 * its ORIGINAL result even when the room has since moved on (game over, next hand, rematch).
 * Returns a conflict ack when the id was used for a different payload.
 */
export function lookupGameActionReceipt(
  roomCode: string,
  playerSeatId: string,
  requestId: string,
  fingerprint?: string,
): GameActionAck | null {
  const cached = readCachedAck(roomCode, playerSeatId, requestId);
  if (!cached) return null;
  if (cached.fp && fingerprint && cached.fp !== fingerprint) return { ok: false, error: REQUEST_ID_CONFLICT_ERROR };
  return stripInternal(cached);
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
  inFlightFingerprints.clear();
}

export const GAME_ACTION_IDEMPOTENCY_TTL_MS = ACTION_IDEMPOTENCY_TTL_MS;
