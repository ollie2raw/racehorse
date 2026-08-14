import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { createReservedRoom, peekRoom, type Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';

const log = childLogger('matchmaking:hydration');

export type MatchmakingRoomShellHydrationResult =
  | { kind: 'skipped' }
  | { kind: 'already_in_memory'; room: Room }
  | { kind: 'shell_only'; room: Room; matchmakingMatchId: string }
  | { kind: 'not_found' }
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
 */
export async function tryHydrateMatchmakingRoomShell(
  roomCode: string,
): Promise<MatchmakingRoomShellHydrationResult> {
  const code = roomCode.trim().toUpperCase();
  if (!code.startsWith('MM')) return { kind: 'skipped' };
  const existing = peekRoom(code);
  if (existing) return { kind: 'already_in_memory', room: existing };
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matchmaking_matches?room_code=eq.${encodeURIComponent(code)}&status=eq.in_progress&select=id&limit=1`,
    );
    const id = typeof rows[0]?.id === 'string' ? rows[0].id : null;
    if (!id) return { kind: 'not_found' };
    const room = createReservedRoom(code, { winningScore: 60 });
    room.matchmakingMatchId = id;
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
 * Ensures both engine seat sockets have executed `socket.join(roomCode)` so the
 * subsequent `broadcastStateUpdate` reliably reaches everyone.
 */
export async function waitUntilMatchmakingRoomSocketsReady(
  io: Server,
  roomCode: string,
  engineSeatSocketIds: string[],
): Promise<void> {
  if (engineSeatSocketIds.length < 2) return;
  const deadline = Date.now() + MATCHMAKING_JOIN_SYNC_MAX_MS;
  while (Date.now() < deadline) {
    const members = io.sockets.adapter.rooms.get(roomCode);
    if (members && engineSeatSocketIds.every((id) => members.has(id))) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}
