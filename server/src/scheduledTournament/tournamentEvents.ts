/**
 * Routing for tournament socket events (Phase 3B.1).
 *
 * Audience by tournament kind:
 *  - Live Event (`kind = 'live'`): communal lifecycle events (registration
 *    open / updated, bracket generated, match updated, completed, cancelled)
 *    stay public — every hub shows the same scheduled event.
 *  - Fritz Cup (`kind = 'fritz_cup'`): private to its owner. Its id, bracket,
 *    matches and results are only ever pushed to the owner's sockets.
 * Participant events (match_ready, match_completed, round_completed) go to the
 * named users only, whatever the kind (emitToUserIds).
 *
 * The audience comes from the tournament row. When it cannot be read the event
 * is not sent at all (fail closed: a client recovers through its next REST
 * refresh, never through another user's push).
 *
 * Every payload gains `kind` and `serverNow`.
 */
import type { Server } from 'socket.io';
import { childLogger } from '../logger';
import { withServerNow } from './serverNow';
import type { ScheduledTournamentRow } from './types';

const log = childLogger('tournament:events');

const BOT_PREFIX = 'bot:fritz:';

/** Socket identity is `socket.data.userId` (set by presence identify / room attach after token verification). */
function socketUserId(sock: { data?: unknown }): string | undefined {
  const userId = (sock.data as { userId?: unknown } | undefined)?.userId;
  return typeof userId === 'string' && userId ? userId : undefined;
}

/** Emit to every connected socket of these (human) users. Bots and empty ids are ignored. */
export function emitToUserIds(io: Server, userIds: Array<string | null | undefined>, event: string, payload: unknown): void {
  const targets = new Set(userIds.filter((userId): userId is string => Boolean(userId) && !userId!.startsWith(BOT_PREFIX)));
  if (targets.size === 0) return;
  for (const sock of io.sockets.sockets.values()) {
    const userId = socketUserId(sock);
    if (!userId || !targets.has(userId)) continue;
    sock.emit(event, payload);
  }
}

export type TournamentAudience = Pick<ScheduledTournamentRow, 'id' | 'kind' | 'owner_user_id'>;

/** Who may receive a tournament-level event. */
export function tournamentAudience(tournament: TournamentAudience): { public: true } | { userIds: string[] } {
  if ((tournament.kind ?? 'live') === 'fritz_cup') {
    return { userIds: tournament.owner_user_id ? [tournament.owner_user_id] : [] };
  }
  return { public: true };
}

/**
 * Emit a tournament-level event to its audience. `tournament` is the row, or
 * its id plus a reader (one read; the event is dropped if it fails).
 */
export async function emitTournamentEvent(
  io: Server,
  tournament: TournamentAudience | { id: string; read: (id: string) => Promise<TournamentAudience | null> },
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  let row: TournamentAudience | null;
  if ('read' in tournament) {
    try {
      row = await tournament.read(tournament.id);
    } catch (err) {
      log.warn({ err, tournamentId: tournament.id, event }, 'tournament event not sent: tournament unreadable');
      return;
    }
  } else {
    row = tournament;
  }
  if (!row) {
    log.warn({ tournamentId: tournament.id, event }, 'tournament event not sent: tournament not found');
    return;
  }
  const body = withServerNow({ ...payload, tournamentId: row.id, kind: row.kind ?? 'live' });
  const audience = tournamentAudience(row);
  if ('public' in audience) io.emit(event, body);
  else emitToUserIds(io, audience.userIds, event, body);
}
