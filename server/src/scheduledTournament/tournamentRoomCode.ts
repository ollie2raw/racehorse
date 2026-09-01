import type { MatchRow } from './types';

// Tournament room-code generator and its recognizer, kept side-by-side so the
// two cannot drift. This module has no runtime imports (only a type) so it can
// be pulled into the participant-authz layer without dragging the persistence /
// engine graph along with it.

export function makeTournamentRoomCode(match: Pick<MatchRow, 'tournament_id' | 'round' | 'match_number'>): string {
  const short = match.tournament_id.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `T${short}R${match.round}M${match.match_number}`;
}

/**
 * True for codes shaped like {@link makeTournamentRoomCode} output.
 *
 * Used by the room:join ACL to decide whether a code is worth a tournament
 * lookup: a restarted server rehydrates a room shell without
 * `scheduledTournamentMatchId` (it is not persisted), so the in-memory field
 * alone cannot be trusted to identify a tournament room.
 */
export function isTournamentRoomCode(code: string): boolean {
  return /^T[0-9A-F]{6}R[1-3]M[1-4]$/.test(code.trim().toUpperCase());
}
