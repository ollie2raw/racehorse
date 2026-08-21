import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { createReservedRoom, peekRoom, type Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { markMatchmakingReservation } from './reservedRoomCleanup';

const log = childLogger('matchmaking:hydration');

export type MatchmakingRoomShellHydrationResult =
  | { kind: 'skipped' }
  | { kind: 'already_in_memory'; room: Room }
  | { kind: 'shell_only'; room: Room; matchmakingMatchId: string }
  | { kind: 'not_found' }
  /** M4: the requester is not one of the two players this match was created for. */
  | { kind: 'forbidden'; matchmakingMatchId: string }
  | { kind: 'persistence_unavailable'; error: string };

export type LegacyMatchmakingRoomShellHydrationResult =
  | 'skipped'
  | 'already'
  | 'hydrated'
  | 'miss';

export function normalizeMatchmakingRoomShellHydrationResult(
  result:
    | MatchmakingRoomShellHydrationResult
    | LegacyMatchmakingRoomShellHydrationResult,
  roomCode?: string,
): MatchmakingRoomShellHydrationResult {
  if (typeof result !== 'string') {
    return result;
  }
  switch (result) {
    case 'skipped':
      return { kind: 'skipped' };
    case 'already': {
      const existing = roomCode ? peekRoom(roomCode.trim().toUpperCase()) : undefined;
      if (existing) {
        return { kind: 'already_in_memory', room: existing };
      }
      return { kind: 'not_found' };
    }
    case 'hydrated': {
      const existing = roomCode ? peekRoom(roomCode.trim().toUpperCase()) : undefined;
      if (existing?.matchmakingMatchId) {
        return {
          kind: 'shell_only',
          room: existing,
          matchmakingMatchId: existing.matchmakingMatchId,
        };
      }
      return { kind: 'not_found' };
    }
    case 'miss':
    default:
      return { kind: 'not_found' };
  }
}

/**
 * After Render/deploy the in-memory Map is empty but matchmaking still has an
 * `in_progress` row. Recreate a reserved room shell so players can re-seat;
 * game state is not restored (would require separate persisted snapshots).
 *
 * M4: hydration is a seating path into a live ranked match, so the requester
 * must be one of the two players the match was created for. A stranger who
 * knows or guesses an MM code gets `forbidden` and no shell is created.
 */
export async function tryHydrateMatchmakingRoomShell(
  roomCode: string,
  requesterUserId?: string | null,
): Promise<MatchmakingRoomShellHydrationResult> {
  const code = roomCode.trim().toUpperCase();
  if (!code.startsWith('MM')) return { kind: 'skipped' };
  const existing = peekRoom(code);
  if (existing) return { kind: 'already_in_memory', room: existing };
  try {
    const rows = await supabaseFetch<
      Array<{ id: string; player_a_id?: string | null; player_b_id?: string | null }>
    >(
      `/rest/v1/matchmaking_matches?room_code=eq.${encodeURIComponent(code)}&status=eq.in_progress&select=id,player_a_id,player_b_id&limit=1`,
    );
    const row = rows[0];
    const id = typeof row?.id === 'string' ? row.id : null;
    if (!id) return { kind: 'not_found' };
    const participants = [row?.player_a_id, row?.player_b_id].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const requester = typeof requesterUserId === 'string' ? requesterUserId.trim() : '';
    if (participants.length > 0 && (!requester || !participants.includes(requester))) {
      log.warn(
        { roomCode: code, matchmakingMatchId: id, requesterUserId: requester || null },
        'matchmaking shell hydrate rejected: not a match participant',
      );
      return { kind: 'forbidden', matchmakingMatchId: id };
    }
    const room = createReservedRoom(code, { winningScore: 60 });
    room.matchmakingMatchId = id;
    if (participants.length > 0) {
      room.matchmakingParticipantUserIds = participants;
    }
    markMatchmakingReservation(code);
    log.info({ roomCode: code, matchmakingMatchId: id }, 'matchmaking shell restored');
    return { kind: 'shell_only', room, matchmakingMatchId: id };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'failed');
    return {
      kind: 'persistence_unavailable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Matchmaking: allow the second client up to this long after both seats fill before attempting deal. */
export const MATCHMAKING_JOIN_SYNC_MAX_MS = 5000;

/**
 * `'ready'`  — every engine seat socket is in the socket.io room; a deal now
 *              reaches both clients.
 * `'timeout'`— the window elapsed with a seat still unsynced. Callers must not
 *              start the match (M6).
 * `void`     — legacy stubs that predate this result; treated as ready.
 */
export type MatchmakingSocketSyncResult = 'ready' | 'timeout';

/**
 * Ensures both engine seat sockets have executed `socket.join(roomCode)` so the
 * subsequent `broadcastStateUpdate` reliably reaches everyone.
 *
 * The seat->socket mapping is re-resolved on every poll when `resolveSeatSocketIds`
 * is supplied: a client that drops and reconnects inside the window comes back
 * with a *new* socket id, and checking the original snapshot forever would
 * guarantee a timeout for a player who is in fact present (M6).
 */
export async function waitUntilMatchmakingRoomSocketsReady(
  io: Server,
  roomCode: string,
  engineSeatSocketIds: string[],
  resolveSeatSocketIds?: () => string[],
): Promise<MatchmakingSocketSyncResult> {
  if (engineSeatSocketIds.length < 2) return 'ready';
  const deadline = Date.now() + MATCHMAKING_JOIN_SYNC_MAX_MS;
  let current = engineSeatSocketIds;
  while (Date.now() < deadline) {
    const members = io.sockets.adapter.rooms.get(roomCode);
    if (members && current.length >= 2 && current.every((id) => members.has(id))) return 'ready';
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    if (resolveSeatSocketIds) {
      const refreshed = resolveSeatSocketIds();
      if (refreshed.length >= 2) current = refreshed;
    }
  }
  const members = io.sockets.adapter.rooms.get(roomCode);
  if (members && current.length >= 2 && current.every((id) => members.has(id))) return 'ready';
  log.warn(
    { roomCode, engineSeatSocketIds: current, windowMs: MATCHMAKING_JOIN_SYNC_MAX_MS },
    'matchmaking socket sync window elapsed with a seat unsynced',
  );
  return 'timeout';
}
