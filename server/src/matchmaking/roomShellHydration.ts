import type { Server } from 'socket.io';
import { createReservedRoom, peekRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';

/**
 * After Render/deploy the in-memory Map is empty but matchmaking still has an
 * `in_progress` row. Recreate a reserved room shell so players can re-seat;
 * game state is not restored (would require separate persisted snapshots).
 */
export async function tryHydrateMatchmakingRoomShell(
  roomCode: string,
): Promise<'skipped' | 'already' | 'hydrated' | 'miss'> {
  const code = roomCode.trim().toUpperCase();
  if (!code.startsWith('MM')) return 'skipped';
  if (peekRoom(code)) return 'already';
  try {
    const rows = await supabaseFetch<Array<{ id: string }>>(
      `/rest/v1/matchmaking_matches?room_code=eq.${encodeURIComponent(code)}&status=eq.in_progress&select=id&limit=1`,
    );
    const id = typeof rows[0]?.id === 'string' ? rows[0].id : null;
    if (!id) return 'miss';
    const room = createReservedRoom(code, { winningScore: 60 });
    room.matchmakingMatchId = id;
    console.log('[room:hydrate] matchmaking shell restored', { roomCode: code, matchmakingMatchId: id });
    return 'hydrated';
  } catch (err) {
    console.warn('[room:hydrate] failed', err instanceof Error ? err.message : err);
    return 'miss';
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