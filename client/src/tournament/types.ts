// Mirrors of server/src/scheduledTournament/types.ts (client subset, renamed for readability).

export type ScheduledTournamentStatus =
  | 'upcoming'
  | 'registration_open'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type ScheduledTournament = {
  id: string;
  scheduled_start: string;
  registration_open_at: string;
  registration_close_at: string;
  status: ScheduledTournamentStatus;
  format: string;
  win_target: number;
  max_players: number;
  winner_id: string | null;
  created_at: string;
  registered_count?: number;
};

export type RegistrationStatus =
  | 'registered'
  | 'withdrawn'
  | 'eliminated'
  | 'active'
  | 'winner';

export type Registration = {
  id: string;
  tournament_id: string;
  user_id: string;
  registered_at: string;
  seed: number | null;
  placement: number | null;
  status: RegistrationStatus;
  username?: string | null;
  rating?: number | null;
};

export type MatchStatus =
  | 'waiting'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'bye';

export type TournamentMatch = {
  id: string;
  tournament_id: string;
  round: 1 | 2 | 3;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  room_code: string | null;
  status: MatchStatus;
  bot_tier?: 'standard' | 'elite' | 'master' | null;
  started_at: string | null;
  completed_at: string | null;
  player1_score: number | null;
  player2_score: number | null;
};

export type BracketView = {
  tournament: ScheduledTournament;
  registrations: Registration[];
  matches: TournamentMatch[];
};

export type MatchReadyEvent = {
  tournamentId: string;
  matchId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  roomCode: string;
  matchStatus: 'ready' | 'in_progress';
  readyAt: string | null;
  readyDeadlineAt: string | null;
  opponentId: string | null;
  opponentUsername: string | null;
};

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

export type TournamentAssignedMatch = {
  matchId: string;
  tournamentId: string;
  round: 1 | 2 | 3;
  matchNumber: number;
  opponentId: string | null;
  opponentUsername: string | null;
  roomCode: string | null;
  matchStatus: MatchStatus;
  scheduledStart: string;
  matchStartsAt: string | null;
  readyDeadlineAt: string | null;
};

export type TournamentMeResponse = {
  registrations: Registration[];
  activeAssignedMatch: {
    matchId: string;
    tournamentId: string;
    round: 1 | 2 | 3;
    matchNumber: number;
    roomCode: string | null;
    opponentId: string | null;
    opponentUsername: string | null;
    matchStatus: 'ready' | 'in_progress';
    readyDeadlineAt: string | null;
  } | null;
  currentTournamentPhase: TournamentUserPhase | null;
  activeTournamentId: string | null;
  assignedMatch: TournamentAssignedMatch | null;
  countdown: { kind: TournamentCountdownKind; at: string } | null;
};

export type TournamentResultPlacement = {
  userId: string;
  username: string | null;
  rating: number | null;
  placement: number | null;
  placementLabel: string | null;
  seed: number | null;
  status: RegistrationStatus;
};

export type TournamentResultView = {
  tournamentId: string;
  scheduledStart: string;
  format: string;
  winTarget: number;
  championId: string | null;
  championName: string | null;
  placements: TournamentResultPlacement[];
};

export type TournamentHistoryEntry = {
  tournamentId: string;
  scheduledStart: string;
  format: string;
  winTarget: number;
  placement: number | null;
  placementLabel: string | null;
  championId: string | null;
  championName: string | null;
};
