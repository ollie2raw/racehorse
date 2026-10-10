/**
 * Derivations from /my (Phase 3C). /my is the client's authoritative
 * multi-tournament state; the singular /me view (`tournamentPhase`,
 * `activeTournamentId`, `assignedMatch`, `countdown`) is derived here for the
 * existing consumers that still read it (Home momentum, the bracket screen
 * and its terminal detection), following the server's buildTournamentMeState
 * phase rules. Choice of the one tournament the legacy view describes: the
 * one with the playable match, else one in progress, else the soonest
 * upcoming registration, else the most recently finished.
 */
import type {
  MyTournament,
  TournamentAssignedMatch,
  TournamentAssignedPlayable,
  TournamentCountdownKind,
  TournamentUserPhase,
} from './types';

export type TournamentLegacyView = {
  tournamentPhase: TournamentUserPhase | null;
  activeTournamentId: string | null;
  assignedMatch: TournamentAssignedMatch | null;
  countdown: { kind: TournamentCountdownKind; at: string } | null;
};

const EMPTY: TournamentLegacyView = { tournamentPhase: null, activeTournamentId: null, assignedMatch: null, countdown: null };

const isHeld = (t: MyTournament) => ['registered', 'active', 'winner'].includes(t.myRegistration.status);
const byStart = (a: MyTournament, b: MyTournament) => Date.parse(a.scheduled_start) - Date.parse(b.scheduled_start);

export function chooseLegacyTournament(
  tournaments: readonly MyTournament[],
  playable: TournamentAssignedPlayable | null,
): MyTournament | null {
  if (playable) {
    const withMatch = tournaments.find((t) => t.id === playable.tournamentId);
    if (withMatch) return withMatch;
  }
  const inProgress = tournaments.filter((t) => t.status === 'in_progress' && isHeld(t)).sort(byStart);
  if (inProgress[0]) return inProgress[0];
  const upcoming = tournaments
    .filter((t) => (t.status === 'registration_open' || t.status === 'upcoming') && t.myRegistration.status === 'registered')
    .sort(byStart);
  if (upcoming[0]) return upcoming[0];
  const finished = tournaments.filter((t) => t.status === 'completed' || t.status === 'cancelled').sort(byStart);
  return finished.at(-1) ?? null;
}

export function deriveTournamentLegacyView(
  tournaments: readonly MyTournament[],
  playable: TournamentAssignedPlayable | null,
  nowMs: number,
): TournamentLegacyView {
  const t = chooseLegacyTournament(tournaments, playable);
  if (!t) return EMPTY;
  const reg = t.myRegistration;
  const closeMs = Date.parse(t.registration_close_at);
  const startMs = Date.parse(t.scheduled_start);
  if (reg.status === 'eliminated') return { ...EMPTY, tournamentPhase: 'eliminated', activeTournamentId: t.id };
  if (t.status === 'completed' || reg.status === 'winner') return { ...EMPTY, tournamentPhase: 'completed', activeTournamentId: t.id };
  if (t.status === 'cancelled') return { ...EMPTY, tournamentPhase: 'completed' };

  const match = playable && playable.tournamentId === t.id ? playable : null;
  const assignedMatch: TournamentAssignedMatch | null = match
    ? {
        matchId: match.matchId,
        tournamentId: t.id,
        round: match.round,
        matchNumber: match.matchNumber,
        opponentId: match.opponentId,
        opponentUsername: match.opponentUsername,
        roomCode: match.roomCode,
        matchStatus: match.matchStatus,
        scheduledStart: t.scheduled_start,
        matchStartsAt: nowMs >= startMs ? t.scheduled_start : null,
        readyDeadlineAt: match.readyDeadlineAt,
      }
    : null;

  if (t.status === 'registration_open' && nowMs < closeMs) {
    return { tournamentPhase: 'registered', activeTournamentId: t.id, assignedMatch, countdown: { kind: 'registration_close', at: t.registration_close_at } };
  }
  if (t.status === 'in_progress' && nowMs >= closeMs && nowMs < startMs) {
    return { tournamentPhase: 'bracket_lobby', activeTournamentId: t.id, assignedMatch, countdown: { kind: 'scheduled_start', at: t.scheduled_start } };
  }
  if (match) {
    return {
      tournamentPhase: match.matchStatus === 'in_progress' ? 'in_match' : 'match_ready',
      activeTournamentId: t.id,
      assignedMatch,
      countdown: match.readyDeadlineAt ? { kind: 'ready_deadline', at: match.readyDeadlineAt } : null,
    };
  }
  if (t.status === 'registration_open' || t.status === 'upcoming') {
    return { tournamentPhase: 'registered', activeTournamentId: t.id, assignedMatch: null, countdown: { kind: 'registration_close', at: t.registration_close_at } };
  }
  return {
    tournamentPhase: 'bracket_lobby',
    activeTournamentId: t.id,
    assignedMatch: null,
    countdown: nowMs < startMs ? { kind: 'scheduled_start', at: t.scheduled_start } : null,
  };
}
