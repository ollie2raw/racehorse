import type { Registration, ScheduledTournament } from './types';

export type TournamentRecoveryMatch = {
  matchId: string;
  tournamentId: string;
  round: 1 | 2 | 3;
  roomCode: string | null;
  opponentId: string | null;
  opponentUsername: string | null;
  matchStatus: 'ready' | 'in_progress';
  readyDeadlineAt: string | null;
} | null;

export type TournamentHubUiState =
  | 'loading'
  | 'api_error'
  | 'registration_opens_soon'
  | 'registration_open'
  | 'registered_waiting'
  | 'full'
  | 'registration_closed'
  | 'in_progress'
  | 'eliminated'
  | 'completed'
  | 'cancelled';

export type TournamentHubViewModel = {
  state: TournamentHubUiState;
  title: string;
  detail: string;
  canRetry: boolean;
};

type Params = {
  upcoming: ScheduledTournament[];
  registrations: Registration[];
  recoveryMatch: TournamentRecoveryMatch;
  activeBracketStatus: ScheduledTournament['status'] | null;
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  nowMs: number;
};

export function deriveTournamentHubViewModel(params: Params): TournamentHubViewModel {
  if (params.error) {
    return {
      state: 'api_error',
      title: 'Unable to load tournaments',
      detail: params.error,
      canRetry: true,
    };
  }

  if (params.isLoading && !params.hasLoaded) {
    return {
      state: 'loading',
      title: 'Loading tournaments…',
      detail: 'Checking the next scheduled event and your tournament status.',
      canRetry: false,
    };
  }

  if (params.activeBracketStatus === 'cancelled') {
    return {
      state: 'cancelled',
      title: 'Tournament was cancelled',
      detail: 'This event did not start. Check the next scheduled tournament.',
      canRetry: false,
    };
  }

  if (params.activeBracketStatus === 'completed') {
    return {
      state: 'completed',
      title: 'Tournament complete',
      detail: 'The bracket has finished. View the result screen for the champion.',
      canRetry: false,
    };
  }

  if (params.recoveryMatch) {
    return {
      state: 'in_progress',
      title:
        params.recoveryMatch.matchStatus === 'ready'
          ? 'Your match is ready'
          : 'Your match is in progress',
      detail:
        params.recoveryMatch.matchStatus === 'ready'
          ? 'Return to your assigned tournament match.'
          : 'Rejoin your assigned tournament match.',
      canRetry: false,
    };
  }

  const eliminated = params.registrations.find((r) => r.status === 'eliminated');
  if (eliminated) {
    return {
      state: 'eliminated',
      title: 'Eliminated',
      detail: 'You missed your assigned match and were eliminated by no-show. View the bracket or enter the next tournament.',
      canRetry: false,
    };
  }

  const nextTournament = params.upcoming[0] ?? null;
  if (!nextTournament) {
    return {
      state: 'registration_opens_soon',
      title: 'Checking the next tournament',
      detail: 'No scheduled event is visible yet. Pull to refresh and check again shortly.',
      canRetry: true,
    };
  }

  const registeredIds = new Set(
    params.registrations
      .filter((r) => r.status === 'registered' || r.status === 'active' || r.status === 'winner')
      .map((r) => r.tournament_id),
  );
  const isRegistered = registeredIds.has(nextTournament.id);
  const startMs = Date.parse(nextTournament.scheduled_start);
  const count = nextTournament.registered_count ?? 0;
  const isFull = count >= nextTournament.max_players;

  if (nextTournament.status === 'registration_open') {
    if (isRegistered) {
      return {
        state: 'registered_waiting',
        title: "You're in. Waiting for tournament to start.",
        detail: 'Registration is open, but your seat is locked in.',
        canRetry: false,
      };
    }
    if (isFull) {
      return {
        state: 'full',
        title: 'Tournament is full',
        detail: 'All seats for the next event are taken.',
        canRetry: false,
      };
    }
    return {
      state: 'registration_open',
      title: 'Registration is open',
      detail: `${count} / ${nextTournament.max_players} seats claimed.`,
      canRetry: false,
    };
  }

  if (isRegistered && startMs <= params.nowMs) {
    return {
      state: 'registration_closed',
      title: 'Registration closed. Bracket generating.',
      detail: 'Your seat is locked. The bracket is being prepared.',
      canRetry: false,
    };
  }

  if (isRegistered) {
    return {
      state: 'registered_waiting',
      title: "You're in. Waiting for tournament to start.",
      detail: 'Registration has not opened yet, but your active tournament entry is preserved.',
      canRetry: false,
    };
  }

  return {
    state: 'registration_opens_soon',
    title: 'Registration opens soon',
    detail: 'Registration opens 30 minutes before start.',
    canRetry: false,
  };
}
