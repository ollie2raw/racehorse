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

/**
 * The engine seat id of the room's tournament starter, for startGame's
 * `startingPlayerId`. A Fritz seat's id is its tournament id; a human seat is
 * found by its roster user id. Undefined for a non-tournament room. A
 * tournament room whose seats do not include the starter is corrupt (its
 * result could not be recorded either): alerted, and the engine default is
 * left to start the game rather than stalling it.
 */
export function tournamentStartingSeatId(room: Room): string | undefined {
  const starter = room.scheduledTournamentStarterUserId;
  if (!starter) return undefined;
  const seatId = room.players.includes(starter)
    ? starter
    : getRoomRoster(room.code).find((p) => p.userId === starter && room.players.includes(p.id))?.id;
  if (!seatId) {
    alertTournamentAnomaly(
      'tournament_starter_unresolved',
      { tournamentId: room.scheduledTournamentId, matchId: room.scheduledTournamentMatchId, roomCode: room.code },
      { starter, seats: [...room.players] },
    );
  }
  return seatId;
}
