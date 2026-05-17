// Types for the scheduled-tournament system. Kept separate from the legacy
// lobby-based round-robin tournament in server/src/tournament/.

export type ScheduledTournamentStatus =
  | 'upcoming'
  | 'registration_open'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export type ScheduledTournamentRow = {
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
};

export type RegistrationStatus =
  | 'registered'
  | 'withdrawn'
  | 'eliminated'
  | 'active'
  | 'winner';

export type RegistrationRow = {
  id: string;
  tournament_id: string;
  user_id: string;
  registered_at: string;
  seed: number | null;
  placement: number | null;
  status: RegistrationStatus;
};

export type MatchStatus =
  | 'waiting'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'bye';

export type MatchRow = {
  id: string;
  tournament_id: string;
  round: 1 | 2 | 3;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  room_code: string | null;
  status: MatchStatus;
  ready_at: string | null;
  ready_deadline_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  player1_joined_at: string | null;
  player2_joined_at: string | null;
  winner_source: 'game_over' | 'no_show' | 'forfeit' | null;
  status_reason: string | null;
  forfeit_user_id: string | null;
  no_show_user_id: string | null;
  bot_tier: 'standard' | 'elite' | 'master' | null;
  player1_score: number | null;
  player2_score: number | null;
};

export type SeededPlayer = {
  userId: string;
  username: string;
  rating: number;
  isBot?: boolean;
  botTier?: 'standard' | 'elite' | 'master';
};

export type BracketView = {
  tournament: ScheduledTournamentRow;
  registrations: Array<RegistrationRow & {
    username: string | null;
    rating: number | null;
  }>;
  matches: MatchRow[];
};
