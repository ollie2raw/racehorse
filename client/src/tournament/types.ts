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
  opponent: string | null;
};
