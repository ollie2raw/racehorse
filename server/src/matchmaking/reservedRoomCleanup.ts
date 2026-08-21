import { childLogger } from '../logger';
import { deleteRoom, peekRoom } from '../rooms';
import { clearRoomMetadata } from '../multiplayer/roomSession';
import { recordMatchEnd } from './persistence';
import { clearMatchedPair } from './matchedPairRegistry';

const log = childLogger('matchmaking:reservation');

/**
 * How long a matchmaking reservation may sit with nobody seated before it is
 * reaped (M5). Matches the room-session reconnect grace (5 min) so a player
 * who takes the full reconnect window to come back still finds their shell.
 */
export const MATCHMAKING_RESERVATION_GRACE_MS = 5 * 60_000;

const RESERVATION_SWEEP_INTERVAL_MS = 60_000;

/** roomCode -> reservation timestamp (ms). Only rooms nobody has seated into. */
const reservationsByRoomCode = new Map<string, number>();

let sweepTimer: ReturnType<typeof setInterval> | null = null;

function normalize(roomCode: string): string {
  return String(roomCode ?? '').trim().toUpperCase();
}

/**
 * Start tracking a reserved matchmaking room. Called when `handleMatched`
 * reserves a room and when a shell is re-hydrated after restart — the two
 * places an empty MM room can come into existence.
 */
export function markMatchmakingReservation(roomCode: string, nowMs = Date.now()): void {
  const code = normalize(roomCode);
  if (!code) return;
  reservationsByRoomCode.set(code, nowMs);
}

/**
 * Stop tracking a reservation. Called by the M1 abort path right after it
 * deletes the partial room, so the sweeper can never act on a code that a
 * later match reuses.
 */
export function clearMatchmakingReservation(roomCode: string): void {
  const code = normalize(roomCode);
  if (!code) return;
  reservationsByRoomCode.delete(code);
}

export function getTrackedMatchmakingReservationsForTests(): string[] {
  return [...reservationsByRoomCode.keys()];
}

/**
 * Reap reserved matchmaking rooms that nobody ever seated into.
 *
 * Hand-off rules (these are what keep this from racing the M1 abort path):
 * - room already gone (M1 abort deleted it, or normal cleanup did): just drop
 *   the tracking entry — never a second `deleteRoom`.
 * - room occupied (a seat filled, or a game exists): drop the tracking entry
 *   and let the normal room lifecycle (`evaluateRoomLifecycle` /
 *   `scheduleRoomCleanup`) own it from here.
 * - still empty past the grace window: tear it down.
 *
 * Returns the codes torn down (used by tests/ops logging).
 */
export function sweepMatchmakingReservations(nowMs = Date.now()): string[] {
  const reaped: string[] = [];
  for (const [code, reservedAt] of [...reservationsByRoomCode.entries()]) {
    const room = peekRoom(code);
    if (!room) {
      reservationsByRoomCode.delete(code);
      continue;
    }
    const occupied = room.players.length > 0 || room.state !== null;
    if (occupied) {
      reservationsByRoomCode.delete(code);
      continue;
    }
    if (nowMs - reservedAt < MATCHMAKING_RESERVATION_GRACE_MS) continue;
    reservationsByRoomCode.delete(code);
    const matchmakingMatchId = room.matchmakingMatchId;
    deleteRoom(code);
    clearRoomMetadata(code);
    clearMatchedPair(code);
    if (matchmakingMatchId) {
      // Close the row too, or the next `MM<code>` join would hydrate a shell for
      // a match nobody is playing (and the `in_progress` row leaks forever).
      void recordMatchEnd({
        matchId: matchmakingMatchId,
        status: 'abandoned',
        winnerId: null,
        playerARatingChange: null,
        playerBRatingChange: null,
      });
    }
    reaped.push(code);
    log.info(
      { roomCode: code, ageMs: nowMs - reservedAt },
      'reaped empty matchmaking room reservation',
    );
  }
  return reaped;
}

export function startMatchmakingReservationSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    try {
      sweepMatchmakingReservations();
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'reservation sweep failed');
    }
  }, RESERVATION_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

/** Test-only: stop the sweeper and forget every tracked reservation. */
export function resetMatchmakingReservationsForTests(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  reservationsByRoomCode.clear();
}
