import type { MatchRow } from './types';

// Tournament room-code generator and its recognizer, kept side-by-side so the
// two cannot drift. This module has no runtime imports (only a type) so it can
// be pulled into the participant-authz layer without dragging the persistence /
// engine graph along with it.

/**
 * Room code for a newly dispatched tournament match:
 * `T` + the first 12 hex characters of the match id (48 bits) + `R{round}M{n}`.
 * The match id is a database-generated UUID, so codes do not collide across
 * tournaments the way the original format did (6 hex characters of the
 * tournament id: 24 bits shared by every match of the tournament). The code is
 * stored on the match row at first dispatch and always reused from there, so
 * matches dispatched under the old format keep their old code.
 */
export function makeTournamentRoomCode(match: Pick<MatchRow, 'id' | 'round' | 'match_number'>): string {
  const short = match.id.replace(/-/g, '').slice(0, 12).toUpperCase();
  return `T${short}R${match.round}M${match.match_number}`;
}

/**
 * True for codes shaped like {@link makeTournamentRoomCode} output, in either
 * the current format (12 hex) or the original one (6 hex: rooms dispatched
 * before the format changed still carry it).
 *
 * Used by the room:join ACL to decide whether a code is worth a tournament
 * lookup: a restarted server rehydrates a room shell without
 * `scheduledTournamentMatchId` (it is not persisted), so the in-memory field
 * alone cannot be trusted to identify a tournament room.
 */
export function isTournamentRoomCode(code: string): boolean {
  return /^T(?:[0-9A-F]{6}|[0-9A-F]{12})R[1-3]M[1-4]$/.test(code.trim().toUpperCase());
}
