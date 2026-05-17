import { humanJoinedAt, isBotUserId } from './matchDispatch';
import { isTournamentPastActiveWindow } from './activeWindow';
import type { MatchRow, RegistrationRow, ScheduledTournamentRow } from './types';

export type TournamentUserPhase =
  | 'registered'
  | 'bracket_lobby'
  | 'match_ready'
  | 'in_match'
  | 'eliminated'
  | 'completed';

export type TournamentCountdownKind =
  | 'registration_close'
  | 'scheduled_start'
  | 'ready_deadline';

export type TournamentAssignedMatchPayload = {
  matchId: string;
  tournamentId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  opponentId: string | null;
  opponentUsername: string | null;
  roomCode: string | null;
  matchStatus: MatchRow['status'];
  scheduledStart: string;
  matchStartsAt: string | null;
  readyDeadlineAt: string | null;
};

export type TournamentMeState = {
  currentTournamentPhase: TournamentUserPhase | null;
  activeTournamentId: string | null;
  assignedMatch: TournamentAssignedMatchPayload | null;
  countdown: { kind: TournamentCountdownKind; at: string } | null;
};

function isLiveRegistration(reg: RegistrationRow): boolean {
  return reg.status === 'registered' || reg.status === 'active' || reg.status === 'winner';
}

function findUserMatch(matches: MatchRow[], userId: string): MatchRow | null {
  return (
    matches.find(
      (m) =>
        (m.player1_id === userId || m.player2_id === userId) &&
        m.status !== 'completed' &&
        m.status !== 'bye' &&
        !m.winner_id &&
        !m.completed_at,
    ) ?? null
  );
}

function opponentForMatch(
  match: MatchRow,
  userId: string,
  opponentUsername: string | null,
): { opponentId: string | null; opponentUsername: string | null } {
  const opponentId = match.player1_id === userId ? match.player2_id : match.player1_id;
  if (!opponentId) return { opponentId: null, opponentUsername: null };
  if (isBotUserId(opponentId)) {
    return { opponentId, opponentUsername: opponentUsername ?? 'Fritz' };
  }
  return { opponentId, opponentUsername };
}

function isMatchDispatchable(match: MatchRow, tournament: ScheduledTournamentRow, nowMs: number): boolean {
  if (tournament.status !== 'in_progress') return false;
  if (Date.parse(tournament.scheduled_start) > nowMs) return false;
  if (match.status !== 'ready' && match.status !== 'in_progress') return false;
  if (!match.room_code?.trim()) return false;
  if (match.completed_at || match.winner_id) return false;
  return true;
}

export function buildTournamentMeState(input: {
  userId: string;
  registrations: RegistrationRow[];
  tournamentsById: Map<string, ScheduledTournamentRow>;
  matchesByTournamentId: Map<string, MatchRow[]>;
  opponentUsernameByUserId: Map<string, string | null>;
  now?: Date;
}): TournamentMeState {
  const nowMs = (input.now ?? new Date()).getTime();
  const liveRegs = input.registrations.filter(isLiveRegistration);

  const candidates = liveRegs
    .map((reg) => {
      const tournament = input.tournamentsById.get(reg.tournament_id) ?? null;
      if (!tournament) return null;
      if (isTournamentPastActiveWindow(tournament, nowMs)) return null;
      const matches = input.matchesByTournamentId.get(reg.tournament_id) ?? [];
      const match = findUserMatch(matches, input.userId);
      return { reg, tournament, match, matches };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => Date.parse(b.tournament.scheduled_start) - Date.parse(a.tournament.scheduled_start));

  const active = candidates[0];
  if (!active) {
    const eliminated = input.registrations.find((reg) => reg.status === 'eliminated');
    if (eliminated) {
      return {
        currentTournamentPhase: 'eliminated',
        activeTournamentId: eliminated.tournament_id,
        assignedMatch: null,
        countdown: null,
      };
    }
    const completed = input.registrations.find((reg) => reg.status === 'winner' || reg.placement != null);
    if (completed) {
      return {
        currentTournamentPhase: 'completed',
        activeTournamentId: completed.tournament_id,
        assignedMatch: null,
        countdown: null,
      };
    }
    return {
      currentTournamentPhase: null,
      activeTournamentId: null,
      assignedMatch: null,
      countdown: null,
    };
  }

  const { reg, tournament, match } = active;
  const closeMs = Date.parse(tournament.registration_close_at);
  const startMs = Date.parse(tournament.scheduled_start);

  if (reg.status === 'eliminated') {
    return {
      currentTournamentPhase: 'eliminated',
      activeTournamentId: tournament.id,
      assignedMatch: null,
      countdown: null,
    };
  }

  if (tournament.status === 'completed' || reg.status === 'winner') {
    return {
      currentTournamentPhase: 'completed',
      activeTournamentId: tournament.id,
      assignedMatch: null,
      countdown: null,
    };
  }

  if (tournament.status === 'cancelled') {
    return {
      currentTournamentPhase: 'completed',
      activeTournamentId: null,
      assignedMatch: null,
      countdown: null,
    };
  }

  const assignedBase = match
    ? (() => {
        const rawOpponentId = match.player1_id === input.userId ? match.player2_id : match.player1_id;
        const { opponentId, opponentUsername } = opponentForMatch(
          match,
          input.userId,
          rawOpponentId ? input.opponentUsernameByUserId.get(rawOpponentId) ?? null : null,
        );
        return {
          matchId: match.id,
          tournamentId: tournament.id,
          round: match.round,
          matchNumber: match.match_number,
          opponentId,
          opponentUsername,
          roomCode: isMatchDispatchable(match, tournament, nowMs) ? match.room_code : null,
          matchStatus: match.status,
          scheduledStart: tournament.scheduled_start,
          matchStartsAt: match.ready_at ?? (nowMs >= startMs ? tournament.scheduled_start : null),
          readyDeadlineAt: isMatchDispatchable(match, tournament, nowMs) ? match.ready_deadline_at : null,
        } satisfies TournamentAssignedMatchPayload;
      })()
    : null;

  if (tournament.status === 'registration_open' && nowMs < closeMs) {
    return {
      currentTournamentPhase: 'registered',
      activeTournamentId: tournament.id,
      assignedMatch: assignedBase,
      countdown: { kind: 'registration_close', at: tournament.registration_close_at },
    };
  }

  if (
    tournament.status === 'in_progress' &&
    nowMs >= closeMs &&
    nowMs < startMs
  ) {
    return {
      currentTournamentPhase: 'bracket_lobby',
      activeTournamentId: tournament.id,
      assignedMatch: assignedBase,
      countdown: { kind: 'scheduled_start', at: tournament.scheduled_start },
    };
  }

  if (match && humanJoinedAt(match, input.userId) && (match.status === 'ready' || match.status === 'in_progress')) {
    return {
      currentTournamentPhase: 'in_match',
      activeTournamentId: tournament.id,
      assignedMatch: assignedBase,
      countdown: match.ready_deadline_at
        ? { kind: 'ready_deadline', at: match.ready_deadline_at }
        : null,
    };
  }

  if (match && isMatchDispatchable(match, tournament, nowMs)) {
    return {
      currentTournamentPhase: 'match_ready',
      activeTournamentId: tournament.id,
      assignedMatch: assignedBase,
      countdown: match.ready_deadline_at
        ? { kind: 'ready_deadline', at: match.ready_deadline_at }
        : { kind: 'scheduled_start', at: tournament.scheduled_start },
    };
  }

  if (tournament.status === 'registration_open' || (nowMs < closeMs && reg.status === 'registered')) {
    return {
      currentTournamentPhase: 'registered',
      activeTournamentId: tournament.id,
      assignedMatch: assignedBase,
      countdown: { kind: 'registration_close', at: tournament.registration_close_at },
    };
  }

  if (nowMs >= closeMs && nowMs < startMs) {
    return {
      currentTournamentPhase: 'bracket_lobby',
      activeTournamentId: tournament.id,
      assignedMatch: assignedBase,
      countdown: { kind: 'scheduled_start', at: tournament.scheduled_start },
    };
  }

  return {
    currentTournamentPhase: reg.status === 'registered' ? 'registered' : 'bracket_lobby',
    activeTournamentId: tournament.id,
    assignedMatch: assignedBase,
    countdown: { kind: 'scheduled_start', at: tournament.scheduled_start },
  };
}
