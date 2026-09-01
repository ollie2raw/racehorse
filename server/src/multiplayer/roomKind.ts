import type { Room } from '../rooms';

/**
 * The one place that answers "what kind of room is this?".
 *
 * Before this existed the question was re-derived ad hoc in ~4 places with
 * predicates that disagreed — `Boolean(cfg.tournamentId)` (legacy league only),
 * `scheduledTournamentMatchId || cfg.tournamentId` (both), `scheduledTournamentMatchId`
 * alone (missed legacy). See HARDENING_PLAN.md T-12.
 *
 * Two distinct tournament systems exist:
 *   - `scheduled_tournament` — the 8-player bracket system
 *     (`room.scheduledTournamentMatchId`).
 *   - `legacy_league` — the older ad-hoc league behind `ENABLE_LEGACY_TOURNAMENTS`
 *     (`room.config.tournamentId`).
 * They take different game-over paths and must not be conflated.
 */
export type RoomKind =
  | 'private'
  | 'matchmaking'
  | 'scheduled_tournament'
  | 'legacy_league';

type RoomKindInput = {
  scheduledTournamentMatchId?: string | null;
  matchmakingMatchId?: string | null;
  config?: { tournamentId?: string | null } | null;
};

export function roomKind(room: RoomKindInput | Room): RoomKind {
  const r = room as RoomKindInput;
  if (r.scheduledTournamentMatchId) return 'scheduled_tournament';
  if (r.config?.tournamentId) return 'legacy_league';
  if (r.matchmakingMatchId) return 'matchmaking';
  return 'private';
}

export const isScheduledTournamentRoom = (room: RoomKindInput | Room): boolean =>
  roomKind(room) === 'scheduled_tournament';

export const isLegacyLeagueRoom = (room: RoomKindInput | Room): boolean =>
  roomKind(room) === 'legacy_league';

/** True for either tournament system. Use for cross-cutting concerns (telemetry, rematch block). */
export const isAnyTournamentRoom = (room: RoomKindInput | Room): boolean => {
  const kind = roomKind(room);
  return kind === 'scheduled_tournament' || kind === 'legacy_league';
};
