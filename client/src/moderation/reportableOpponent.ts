import type { RoomPlayer } from '../multiplayer/protocol';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The opponent a signed-in player can report or block from a live match: a
 * real account (uuid user id) in another seat. Guests, bots and the player's
 * own seat are never reportable, and a signed-out viewer can't report anyone.
 */
export function selectReportableOpponent(
  players: readonly RoomPlayer[],
  yourSeatId: string,
  authUserId: string | null | undefined,
): { userId: string; username: string } | null {
  if (!authUserId) return null;
  const opponent = players.find(
    (p) => p.id !== yourSeatId && typeof p.userId === 'string' && UUID_RE.test(p.userId) && p.userId !== authUserId,
  );
  if (!opponent?.userId) return null;
  return { userId: opponent.userId, username: opponent.username || 'Player' };
}
