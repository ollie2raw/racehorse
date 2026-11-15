/**
 * MP_HAND_BOUNDARY_FAST (default OFF): the hand:ready ready marks no longer wait for a database write before they are
 * acknowledged.
 *
 * Off (and for any scheduled-tournament room, always): each ready mark is mutated, flushed to the database and proven
 * durable inside the room's gameplay lock before the ack, so the second player's hand:ready costs three sequential
 * writes: the first player's mark still in flight under the lock, its own mark, then the new hand.
 *
 * On: a ready mark only takes the normal debounced persist (the same one every committed mutation takes) and the ack
 * returns at once. The new-hand write is unchanged: the new hand is mutated, written, proven durable and only then
 * broadcast, and because it is a whole-room snapshot it carries the marks with it. So the second player waits for one
 * write, not three.
 *
 * What the flag gives up: the FIRST player's ready mark is acknowledged before it is durable. If the process is killed
 * in the debounce + write window (~75 ms + one write) the restarted room has no mark for that player, who must send
 * hand:ready again (the server ignores duplicates). The second player's ack, which carries the hand start, is always
 * durable.
 *
 * Read per call, so flipping the env var needs only a restart, like the other flags.
 */
import type { Room } from '../rooms';

export function isHandBoundaryFastFlagOn(): boolean {
  return process.env.MP_HAND_BOUNDARY_FAST === 'true';
}

/** Scheduled-tournament rooms keep the awaited marks whatever the flag says. */
export function usesFastHandBoundary(
  room: Pick<Room, 'scheduledTournamentId' | 'scheduledTournamentMatchId'>,
): boolean {
  if (!isHandBoundaryFastFlagOn()) return false;
  return !room.scheduledTournamentId && !room.scheduledTournamentMatchId;
}
