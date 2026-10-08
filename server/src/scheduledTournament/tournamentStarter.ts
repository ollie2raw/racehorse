import { createHash } from 'node:crypto';
import type { Room } from '../rooms';
import { getRoomRoster } from '../multiplayer/roomSession';
import { alertTournamentAnomaly } from './tournamentAlerts';
import type { MatchRow } from './types';

/**
 * Who starts hand 1 of a tournament match. Tournament rooms skip the
 * interactive pre-game draw (it stalled every human-vs-Fritz match: Fritz
 * never picks), so the server makes the same fair choice the draw makes.
 *
 * One bit of SHA-256(`tournament_id:match_id`) picks player1 (0) or player2
 * (1). Both ids are database-generated UUIDs (gen_random_uuid() defaults; the
 * bracket RPC inserts match rows without ids), so no player can choose or
 * steer them. The bit is independent of seed, attach order and whether a seat
 * is Fritz, and it is a pure function of the match row: every dispatch,
 * redispatch or restart computes the same answer, nothing is stored. Later
 * hands keep the engine's usual alternation from this starter.
 */
export function tournamentStarterUserId(
  match: Pick<MatchRow, 'id' | 'tournament_id' | 'player1_id' | 'player2_id'>,
): string | null {
  if (!match.player1_id || !match.player2_id) return null;
  const bit = createHash('sha256').update(`${match.tournament_id}:${match.id}`).digest()[0] & 1;
  return bit === 0 ? match.player1_id : match.player2_id;
}

/** Thrown when a tournament room's starter cannot be resolved to one of its seats. */
export const TOURNAMENT_STARTER_UNRESOLVED = 'tournament_starter_unresolved';

/**
 * The engine seat id of the room's tournament starter, for startGame's
 * `startingPlayerId`. A Fritz seat's id is its tournament id; a human seat is
 * found by its roster user id. Undefined for a non-tournament room (its own
 * start rules apply).
 *
 * Fails closed for a tournament room (`scheduledTournamentMatchId` set): if
 * the starter is missing (dispatch sets it on every unstarted room, so this
 * should not happen) or names no current seat, it alerts and throws
 * TOURNAMENT_STARTER_UNRESOLVED, so no game is dealt. It never falls back to
 * seat 0 or picks another player: the match stays ready, and the normal
 * start-retry lifecycle (redispatch re-derives the starter; then
 * `start_failed_after_retry_higher_seed_advanced`) decides it.
 */
export function tournamentStartingSeatId(room: Room): string | undefined {
  if (!room.scheduledTournamentMatchId) return undefined;
  const starter = room.scheduledTournamentStarterUserId;
  const seatId = !starter
    ? undefined
    : room.players.includes(starter)
      ? starter
      : getRoomRoster(room.code).find((p) => p.userId === starter && room.players.includes(p.id))?.id;
  if (!seatId) {
    alertTournamentAnomaly(
      TOURNAMENT_STARTER_UNRESOLVED,
      { tournamentId: room.scheduledTournamentId, matchId: room.scheduledTournamentMatchId, roomCode: room.code },
      { reason: starter ? 'starter_not_seated' : 'starter_missing', seatCount: room.players.length },
    );
    throw new Error(TOURNAMENT_STARTER_UNRESOLVED);
  }
  return seatId;
}
