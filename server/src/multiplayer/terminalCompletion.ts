import type { Room } from '../rooms';
import { isTournamentRoomCode } from '../scheduledTournament/tournamentRoomCode';
import { isAnyTournamentRoom } from './roomKind';

/**
 * Terminal-completion durability contract (R1).
 *
 * A room that has durably become terminal (`game_over`, or `abandoned` by a rated
 * forfeit) must never be a dead end: until its completion (match record, ranked
 * rows, Ghost/Fritz writes) has been durably logged, the `room_live_sessions` row
 * itself is the replay source. `room_shell.completionPending` is the durable flag
 * a restart-time sweep keys on; `room_shell.matchLogged` is the existing marker
 * that flips once completion is logged.
 *
 * Scheduled/legacy tournament rooms are deliberately out of scope: tournaments
 * stay OFF and own their completion through the bracket engine.
 */

export type ForfeitReason = 'manual' | 'disconnect_timeout' | 'missed_turns';

const ACCOUNT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Guest seat identities are stable reconnect keys, not account ids. */
export function accountIdOrNull(id: string | null | undefined): string | null {
  return typeof id === 'string' && ACCOUNT_ID_RE.test(id) ? id : null;
}

export function isForfeitReason(value: unknown): value is ForfeitReason {
  return value === 'manual' || value === 'disconnect_timeout' || value === 'missed_turns';
}

export function isTournamentLikeRoom(room: Room): boolean {
  return (
    isAnyTournamentRoom(room) ||
    Boolean(room.scheduledTournamentId) ||
    isTournamentRoomCode(room.code)
  );
}

type SeatIdentity = { seatId: string; userId: string | null };

/** Both seats are signed-in accounts: the only forfeits that produce rated rows. */
export function isRatedForfeitRoom(room: Room, roster: readonly SeatIdentity[]): boolean {
  if (isTournamentLikeRoom(room)) return false;
  if (room.players.length !== 2) return false;
  return room.players.every((seatId) =>
    accountIdOrNull(roster.find((entry) => entry.seatId === seatId)?.userId ?? null),
  );
}

/**
 * Does this room, in its current state, owe a durable completion that is not yet
 * logged? Derived (never stored in memory) so every snapshot is self-describing.
 */
export function roomOwesTerminalCompletion(room: Room, roster: readonly SeatIdentity[]): boolean {
  if (room.matchLogged) return false;
  if (isTournamentLikeRoom(room)) return false;
  if (room.abandonedAt) {
    return room.abandonedReason === 'forfeit' && isRatedForfeitRoom(room, roster);
  }
  const state = room.state;
  return Boolean(state?.gameOver) && Array.isArray(state?.playerIds) && state!.playerIds.length === 2;
}
