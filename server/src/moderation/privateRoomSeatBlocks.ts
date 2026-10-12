import { roomKind } from '../multiplayer/roomKind';
import { blockStatus } from './blockStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RoomLike = Parameters<typeof roomKind>[0];
type SeatLike = { userId: string | null };

/**
 * Whether a NEW seat in a private room must be refused because of a block
 * between the joiner and someone already seated.
 *
 * Called from the attach path at the exact point a fresh seat would be
 * allocated — after the room is loaded or restored from persistence, and only
 * when the joiner has neither a seat nor a reconnect hold. So:
 *  - a room restored after a restart is checked like any other;
 *  - restoring an existing, authorised seat (reconnect, resync, second tab)
 *    never reaches here, so a moderation outage can't strand a player.
 *
 * Fail closed: if block state can't be read, the new seat is refused too.
 * Only private rooms: Quick Match never pairs across a block, and tournament
 * seats are assigned by the bracket (see the tournament launch gate).
 * Guests have no account to block and are never refused.
 */
export async function shouldRefuseNewPrivateSeat(
  room: RoomLike,
  seated: readonly SeatLike[],
  joinerUserId: string | null | undefined,
): Promise<boolean> {
  if (roomKind(room) !== 'private') return false;
  if (!joinerUserId || !UUID_RE.test(joinerUserId)) return false;
  for (const seat of seated) {
    if (!seat.userId || seat.userId === joinerUserId || !UUID_RE.test(seat.userId)) continue;
    if ((await blockStatus(joinerUserId, seat.userId, 'room:join')) !== 'clear') return true;
  }
  return false;
}
